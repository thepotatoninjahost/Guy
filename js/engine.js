/* ============================================================
   Gunther · GLASS HOUSE CONSOLE — js/engine.js
   THE ROTATION ENGINE.

   Every line carries four ledgers:
     · a sliding 60s window  (rpm / tpm admission)
     · a UTC-day ledger      (rpd / tpd ceiling)
     · a trip state          (exponential backoff on 429s)
     · a 130s token feed     (burn rate, latency context)

   Selection scores every line that can legally accept the next
   request:  headroom * 55 + quality * 9 + freshness * 8,
   minus a fatigue penalty on the line that just served.
   Headroom is the tightest published cap, so a line rotates
   out the instant any single dimension binds.

   When a provider answers 429, the line is tripped on a
   backoff ladder (60s → 5m → 30m → 4h → 24h) and the same
   request is handed, intact, to the next line. A turn may be
   handed off at most twice; after that the console says so.
   ============================================================ */

import { MODELS, byId, estimateTokens } from "./models.js";
import { state, blankLedger, emit, addLog, scheduleSave, minutesToNextHour } from "./state.js";
import { call } from "./transport.js";

export const QUOTA_BACKOFF = [60e3, 5 * 60e3, 30 * 60e3, 4 * 3600e3, 24 * 3600e3];
export const SOFT_BACKOFF = [15e3, 60e3, 5 * 60e3];
const MAX_HANDOFFS = 6; // initial attempt + five rotations — 10 lines deserve a real sweep
const FIRST_WORD_DEFAULT_MS = 25e3; // a line that says nothing for this long is not thinking, it is hanging
function firstWordMs() {
  const d = state.dials && state.dials.firstWordMs;
  return typeof d === "number" && d > 0 ? d : FIRST_WORD_DEFAULT_MS;
}

/* ---------- window math ---------- */

export const dayId = (d = new Date()) => d.toISOString().slice(0, 10);
export const hourId = (d = new Date()) => d.toISOString().slice(0, 13);

function entry(m) {
  if (!state.ledger[m.id]) state.ledger[m.id] = blankLedger();
  return state.ledger[m.id];
}

/** Rollover buckets for a new window, prune the token feed. */
function roll(m, now = new Date()) {
  const e = entry(m);
  if (e.day.w !== dayId(now)) e.day = { w: dayId(now), req: 0, prompt: 0, completion: 0 };
  if (e.hour.w !== hourId(now)) e.hour = { w: hourId(now), req: 0, prompt: 0, completion: 0 };
  const cutoff = now.getTime() - 130e3;
  e.feed = e.feed.filter((x) => x.t >= cutoff);
}

/** Requests + tokens admitted in the sliding 60s window. */
export function sliding(m, now = new Date()) {
  roll(m, now);
  const floor = now.getTime() - 60e3;
  let req = 0;
  let tok = 0;
  for (const x of entry(m).feed) {
    if (x.t >= floor) {
      req += 1;
      tok += x.tok;
    }
  }
  return { req, tok };
}

/**
 * Headroom for one line: the tightest published cap, 0..1.
 * dims is the decomposition (which cap binds, how full it is).
 */
export function headroom(m, now = new Date()) {
  roll(m, now);
  const e = entry(m);
  const s = sliding(m, now);
  const c = m.caps;
  const dims = [];
  if (c.rpm) dims.push({ k: "rpm", cap: c.rpm, used: s.req });
  if (c.tpm) dims.push({ k: "tpm", cap: c.tpm, used: s.tok });
  if (c.rpd) dims.push({ k: "rpd", cap: c.rpd, used: e.day.req });
  if (c.tpd) dims.push({ k: "tpd", cap: c.tpd, used: e.day.tok });
  let ratio = 1;
  for (const d of dims) ratio = Math.min(ratio, 1 - d.used / d.cap);
  return {
    ratio: Math.max(0, Math.min(1, ratio)),
    dims,
    day: e.day,
    hour: e.hour,
    min: s,
    hasKey: Boolean((state.keys[m.id] || "").trim()),
  };
}

export function isTripped(m, now = new Date()) {
  return entry(m).trip.until > now.getTime();
}

export function tripRemaining(m, now = new Date()) {
  const r = entry(m).trip.until - now.getTime();
  return r > 0 ? r : 0;
}

/**
 * Admission test: can this line legally take a request of
 * ~estTok tokens right now?
 */
export function canAccept(m, estTok = 64, now = new Date()) {
  if (!headroom(m, now).hasKey) return false;
  if (isTripped(m, now)) return false;
  const { dims } = headroom(m, now);
  for (const d of dims) {
    if (d.k === "rpm" && d.used + 1 > d.cap) return false;
    if (d.k === "tpm" && d.used + estTok > d.cap) return false;
    if (d.k === "rpd" && d.used + 1 > d.cap) return false;
    if (d.k === "tpd" && d.used + estTok > d.cap) return false;
  }
  return true;
}

export function availableCount(now = new Date()) {
  let n = 0;
  for (const m of MODELS) if (canAccept(m, 64, now)) n += 1;
  return n;
}

/**
 * Pick the line on duty. Pure — it never mutates ledger state.
 * Returns null when every line is keyed-out, tripped, or full.
 */
export function select(estTok = 64, now = new Date()) {
  const d = state.dials;
  if (d.mode === "pin" && d.pin) {
    const p = byId(d.pin);
    if (p && canAccept(p, estTok, now)) return p;
    // pinned line is exhausted — fall through and ride the rotation
  }
  let best = null;
  let bestScore = -Infinity;
  for (const m of MODELS) {
    if (!canAccept(m, estTok, now)) continue;
    const e = entry(m);
    const hr = headroom(m, now).ratio;
    const since = e.lastAt ? now.getTime() - e.lastAt : Infinity;
    // recently proven lines get a small stickiness bonus…
    const freshness = e.lastAt ? Math.exp(-since / (45 * 60e3)) : 0.35;
    // …but the line that just served pays a fatigue tax
    const fatigue = state.engine.lastLine === m.id ? -30 : 0;
    const score = hr * 55 + m.quality * 9 + freshness * 8 + fatigue;
    if (score > bestScore) {
      bestScore = score;
      best = m;
    }
  }
  return best;
}

/* ---------- bookkeeping ---------- */

export function recordSuccess(m, usage, ms) {
  const now = new Date();
  roll(m, now);
  const e = entry(m);
  const t = now.getTime();
  const total = usage.total || usage.prompt + usage.completion;
  e.day.req += 1;
  e.day.prompt += usage.prompt || 0;
  e.day.completion += usage.completion || 0;
  e.hour.req += 1;
  e.hour.prompt += usage.prompt || 0;
  e.hour.completion += usage.completion || 0;
  e.feed.push({ t, tok: Math.max(1, total) });
  e.lastAt = t;
  e.latency.last = ms;
  e.latency.ema = e.latency.ema ? Math.round(e.latency.ema * 0.7 + ms * 0.3) : ms;
  const s = state.ledger.session;
  s.tok += Math.max(1, total);
  s.req += 1;

  // drill mode: release the line right after a clean turn so the
  // very next request rides the rotation — watch it happen
  if (state.dials.mode === "drill") {
    e.trip.n = 0;
    e.trip.until = t + 20e3;
    e.trip.reason = "drill — forced rotation";
    addLog("info", "ENGINE", `LINE ${pad2(m.line)} ${m.name} released (drill) — next turn rotates`);
  }
  emit("ledger");
  scheduleSave();
}

export function recordHandoff() {
  state.ledger.session.handoffs += 1;
  emit("ledger");
}

/** Trip a line. kind: "quota" (hard ladder) or "soft" (short ladder). */
/**
 * A vendor ceiling is an ACCOUNT ceiling: OpenRouter's 50/day, Groq's 1K/day,
 * Gemini's RPD and Cloudflare's neurons all span every line we host from that
 * vendor. When one line answers 429, its siblings are almost certainly done
 * for the window too — trip them together, so the rotation stops burning a
 * handoff per line against the same closed door.
 */
export function tripVendor(m, kind, reason = "") {
  for (const sib of MODELS) if (sib.provider === m.provider) trip(sib, kind, reason);
}

export function trip(m, kind, reason = "") {
  const now = new Date();
  const e = entry(m);
  const hard = kind === "quota";
  e.trip.n = hard ? e.trip.n + 1 : Math.max(1, e.trip.n);
  const delay = hard
    ? QUOTA_BACKOFF[Math.min(e.trip.n - 1, QUOTA_BACKOFF.length - 1)]
    : SOFT_BACKOFF[Math.min(e.trip.n - 1, SOFT_BACKOFF.length - 1)];
  e.trip.until = now.getTime() + delay;
  e.trip.reason = (reason || kind).slice(0, 120);
  addLog("warn", "ENGINE", `LINE ${pad2(m.line)} ${m.name} tripped — ${e.trip.reason} · backoff ${fmtDelay(delay)}`);
  emit("trip", { model: m.id });
  emit("ledger");
  scheduleSave();
}

export function manualTrip(m, note = "manual trip (drill)") {
  trip(m, "quota", note);
}

export function clearTrip(m) {
  entry(m).trip = { n: 0, until: 0, reason: "" };
  emit("ledger");
  scheduleSave();
}

export function markAuthFail(m, note) {
  const e = entry(m);
  e.ping = { ok: false, at: Date.now(), note: String(note).slice(0, 140) };
  addLog("err", "KEY", `LINE ${pad2(m.line)} ${m.name} — key rejected: ${String(note).slice(0, 120)}`);
  emit("ledger");
  scheduleSave();
}

export function storePing(m, ok, note) {
  entry(m).ping = { ok, at: Date.now(), note: String(note).slice(0, 140) };
  emit("ledger");
  scheduleSave();
}

/* ---------- dispatch with seamless handoff ---------- */

function pad2(n) {
  return String(n).padStart(2, "0");
}

export function fmtDelay(ms) {
  const s = Math.max(1, Math.ceil(ms / 1000));
  if (s < 60) return s + "s";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m";
  const h = Math.floor(m / 60);
  return h + "h " + (m % 60) + "m";
}

function describeCeiling() {
  const now = new Date();
  const keyed = MODELS.filter((m) => (state.keys[m.id] || "").trim());
  if (!keyed.length) {
    return "no line keys are stored yet — open BAY 01 · CREDENTIALS on the service slab and add your free-tier keys.";
  }
  const hourIn = Math.max(1, Math.ceil(minutesToNextHour(now)));
  const dayIn = fmtDelay(msToDay(now));
  return (
    "every keyed line is at a published ceiling. Sliding minute-windows clear within ~" +
    hourIn +
    "m; daily ledgers reset at 00:00 UTC (" +
    dayIn +
    "). The POWER LEDGER (BAY 02) shows exactly which cap bound each line."
  );
}

function msToDay(now) {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return next - now.getTime();
}

/**
 * Run one completion through the fleet.
 * opts: { system, messages, estTok, maxTokens, temperature, signal, onDelta, onRotate }
 * Returns { text, usage, ms, model, attempts } or throws NetError/EngineError.
 */
export async function dispatch(opts) {
  const estTok = opts.estTok || estimateTokens(opts.messages.map((x) => x.content).join(" ") + (opts.system || ""));
  let lastErr = null;
  let lastModel = null;

  for (let attempt = 0; attempt < MAX_HANDOFFS; attempt++) {
    const m = select(estTok);
    if (!m) {
      lastErr = { code: "NO_LINES", msg: describeCeiling() };
      break;
    }
    state.engine.lastLine = m.id;
    if (attempt > 0) {
      const from = lastModel;
      if (opts.onRotate) opts.onRotate({ from, to: m, reason: lastErr ? lastErr.code : "rotation" });
      recordHandoff();
      addLog("info", "ENGINE", `HANDOFF LINE ${pad2(from.line)} → LINE ${pad2(m.line)} (${lastErr ? lastErr.code : "rotation"})`);
    }
    if (opts.onStatus) opts.onStatus({ phase: attempt === 0 ? "contact" : "retry", model: m, attempt: attempt + 1, max: MAX_HANDOFFS });

    /* Silence is the enemy: a hostile WebView can black-hole a request for
       minutes with no error to show. We give every line firstWordMs to say
       its FIRST word — then rotate, loudly, while the orphaned attempt
       finishes harmlessly in the background (live=false mutes its deltas). */
    let sawWord = false;
    let live = true;
    const onDelta = opts.onDelta
      ? (tk) => {
          if (!live) return;
          if (!sawWord) {
            sawWord = true;
            if (opts.onStatus) opts.onStatus({ phase: "streaming", model: m });
          }
          opts.onDelta(tk);
        }
      : undefined;

    try {
      const res = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          live = false;
          const e = new Error("line " + pad2(m.line) + " said nothing for " + Math.round(firstWordMs() / 1000) + "s");
          e.code = "TIMEOUT";
          e.note = "no first word in " + Math.round(firstWordMs() / 1000) + "s — hung connection, rotated off";
          reject(e);
        }, firstWordMs());
        call(m, {
          system: opts.system,
          messages: opts.messages,
          maxTokens: opts.maxTokens,
          temperature: opts.temperature,
          signal: opts.signal,
          onDelta,
        }).then(
          (r) => {
            clearTimeout(timer);
            resolve(r);
          },
          (e) => {
            clearTimeout(timer);
            reject(e);
          }
        );
      });
      live = false;
      recordSuccess(m, res.usage, res.ms);
      if (opts.onStatus) opts.onStatus({ phase: "answered", model: m, ms: res.ms, attempts: attempt + 1 });
      return { ...res, model: m, attempts: attempt + 1 };
    } catch (err) {
      live = false;
      if (err && err.code !== "ABORT" && opts.onStatus) {
        opts.onStatus({ phase: "failed", model: m, note: (err.note || err.msg || err.code || "failed").slice ? String(err.note || err.msg || err.code || "failed").slice(0, 140) : "failed" });
      }
      lastErr = err;
      lastModel = m;
      if (err.code === "ABORT") throw err;
      switch (err.code) {
        case "AUTH":
          markAuthFail(m, err.note);
          trip(m, "quota", "key rejected (401/403)");
          break;
        case "MODEL":
          trip(m, "quota", "endpoint retired (404) — patch the id in FLEET");
          break;
        case "QUOTA":
          tripVendor(m, "quota", err.note);
          break;
        case "BADREQ":
          trip(m, "quota", "provider rejected the request — " + err.note);
          break;
        case "TRANSIENT":
        case "TIMEOUT":
        case "NETWORK":
          trip(m, "soft", err.note);
          break;
        default:
          throw err;
      }
    }
  }

  if (lastErr && lastErr.code === "NO_LINES") {
    const e = new Error(lastErr.msg);
    e.code = "NO_LINES";
    throw e;
  }
  const e = new Error(
    "the fleet refused this turn — " + ((lastErr && lastErr.note) || "every line failed").slice(0, 200)
  );
  e.code = "FLEET_DOWN";
  e.cause = lastErr;
  throw e;
}
