/* ============================================================
   Gunther · GLASS HOUSE CONSOLE — js/state.js
   The foundation: keys, dials, the usage ledger, the work log,
   the thread. localStorage when a browser is present, plain
   memory otherwise (which is also how the test rig runs it).
   ============================================================ */

import { MODELS } from "./models.js";

const K = {
  keys: "gunther.keys.v1",
  dials: "gunther.dials.v1",
  ledger: "gunther.ledger.v1",
  log: "gunther.log.v1",
  thread: "gunther.thread.v1",
  lines: "gunther.lines.v1",
  hold: "gunther.hold.v1",
};

/* the GUY-era storage prefix — migrated once, then retired */
const LEGACY_K = {
  keys: "guy.keys.v1",
  dials: "guy.dials.v1",
  ledger: "guy.ledger.v1",
  log: "guy.log.v1",
  thread: "guy.thread.v1",
  lines: "guy.lines.v1",
};

const hasLS = typeof localStorage !== "undefined";

/** One-shot rename migration: carry over anything stored under the
 *  old guy.* prefix so keys and ledgers survive the christening. */
function migrateLegacy() {
  if (!hasLS) return;
  for (const [slot, legacy] of Object.entries(LEGACY_K)) {
    try {
      const fresh = localStorage.getItem(K[slot]);
      const old = localStorage.getItem(legacy);
      if (old != null && fresh == null) localStorage.setItem(K[slot], old);
      if (old != null) localStorage.removeItem(legacy);
    } catch {
      /* storage blocked — nothing to migrate */
    }
  }
}

const store = {
  get(key, fallback) {
    try {
      if (!hasLS) return fallback;
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      if (hasLS) localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage full or blocked — the app keeps running in memory */
    }
  },
};

export const DEFAULT_SYSTEM = [
  "You are Gunther — a precise autonomous coding agent operating a personal glass-house console.",
  "",
  "Conventions:",
  "- Prose is tight. Code is complete: full files or full patches, exact paths, no placeholders, no \"add the rest yourself\".",
  "- Every code sample ships in a fenced block with a language tag.",
  "- When a task is ambiguous, state your single best assumption in one line, then build.",
  "- You may be served by any of ten rotating free-tier model lines. Match your depth to the line on duty and never mention this dispatch detail unless asked.",
].join("\n");

export const DEFAULT_DIALS = {
  mode: "auto", // auto | pin | drill
  pin: null,
  temperature: 0.4,
  maxTokens: 4096,
  system: DEFAULT_SYSTEM,
  uiMode: "chat", // chat | plan
};

export const state = {
  bus: new EventTarget(),
  keys: null,      // { [modelId]: string } — ten slots, one per line
  linePatches: null, // { [modelId]: { model?: string } } — live endpoint overrides
  dials: null,
  ledger: null,    // { [modelId]: ledgerEntry, session: {...} }
  log: [],         // newest last
  thread: [],      // { role, content, at, model?, usage? }
  engine: { lastLine: null },
  hold: [], // letters held while the whole fleet is at ceiling — run the moment a line frees
  busy: false,
};

export function blankLedger() {
  return {
    day: { w: "", req: 0, prompt: 0, completion: 0 },
    hour: { w: "", req: 0, prompt: 0, completion: 0 },
    feed: [], // { t: ms, tok: n } — rolling 60s window + burn rate
    trip: { n: 0, until: 0, reason: "" },
    lastAt: 0,
    latency: { ema: 0, last: 0 },
    ping: { ok: null, at: 0, note: "" },
  };
}

/** Load (or seed) every slice of persisted state. Idempotent. */
export function load() {
  migrateLegacy();
  if (!state.keys) {
    state.keys = store.get(K.keys, {});
    for (const m of MODELS) if (typeof state.keys[m.id] !== "string") state.keys[m.id] = "";
  }
  if (!state.linePatches) state.linePatches = store.get(K.lines, {});
  if (!state.dials) {
    const d = store.get(K.dials, {});
    state.dials = { ...DEFAULT_DIALS, ...d };
  }
  if (!state.ledger) {
    const l = store.get(K.ledger, {});
    state.ledger = {};
    for (const m of MODELS) state.ledger[m.id] = { ...blankLedger(), ...(l[m.id] || {}) };
    state.ledger.session = l.session || { tok: 0, req: 0, handoffs: 0, startedAt: Date.now() };
    state.ledger.hist = Array.isArray(l.hist) ? l.hist.filter((x) => x && x.h).slice(-24) : [];
    // the rolling feed only means anything while it is young
    const cutoff = Date.now() - 130000;
    for (const m of MODELS) {
      const e = state.ledger[m.id];
      if (!Array.isArray(e.feed)) e.feed = [];
      e.feed = e.feed.filter((x) => x.t >= cutoff);
    }
  }
  state.hold = store.get(K.hold, []);
  if (!Array.isArray(state.hold)) state.hold = [];
  state.log = store.get(K.log, []);
  if (!Array.isArray(state.log)) state.log = [];
  state.thread = store.get(K.thread, []);
  if (!Array.isArray(state.thread)) state.thread = [];
}

let saveTimer = 0;
export function saveAll() {
  store.set(K.keys, state.keys);
  store.set(K.dials, state.dials);
  store.set(K.ledger, state.ledger);
  store.set(K.log, state.log.slice(-150));
  store.set(K.thread, state.thread.slice(-40).map((t) => ({ ...t, content: String(t.content || "").slice(0, 60000) })));
  store.set(K.lines, state.linePatches);
  store.set(K.hold, state.hold.slice(-10));
}
export function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveAll, 400);
}

export function emit(type, detail) {
  state.bus.dispatchEvent(new CustomEvent(type, { detail: detail || {} }));
}

export function setBusy(b) {
  if (state.busy === b) return;
  state.busy = b;
  emit("busy", { b });
}

export function addLog(sev, tag, msg) {
  const e = { t: Date.now(), sev, tag, msg: String(msg).slice(0, 300) };
  state.log.push(e);
  if (state.log.length > 300) state.log.splice(0, state.log.length - 300);
  emit("log", { e });
  scheduleSave();
}

/** How many minutes until the next UTC hour (the sliding windows' release). */
export function minutesToNextHour(now = new Date()) {
  return 60 - now.getUTCMinutes() - (now.getUTCSeconds() / 60);
}

/** How many ms until 00:00 UTC (the daily ledger's release). */
export function msToNextUtcDay(now = new Date()) {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return next - now.getTime();
}
