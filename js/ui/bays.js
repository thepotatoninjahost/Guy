/* ============================================================
   Gunther · GLASS HOUSE CONSOLE — js/ui/bays.js
   The Service Slab and its four bays:
     A · CREDENTIALS — ten key slots, ping, sync
     B · POWER LEDGER — the credit tracker
     C · OVERRIDE & DIALS — pin, drill, temp, max tokens, system
     D · WORK LOG — the engine room
   ============================================================ */

import { state, addLog, saveAll, DEFAULT_DIALS } from "../state.js";
import { MODELS, byId, VENDORS } from "../models.js";
import { headroom, isTripped, tripRemaining, manualTrip, clearTrip, storePing, select, availableCount, fmtDelay } from "../engine.js";
import { ping } from "../transport.js";
import { escapeHtml, fmtTok, fmtClock, toast } from "./render.js";
import { CODING_QUALIFICATION, assessAnswer, qualifyAnswers } from "../qualification.js";
import { call } from "../transport.js";

const TITLES = {
  a: ["01", "CREDENTIALS", "one key per vendor lights its whole line group · stored on this device only"],
  b: ["02", "POWER LEDGER", "token credits, window pressure, reset countdowns"],
  c: ["03", "OVERRIDE & DIALS", "pin a line, drill the rotation, tune the agent"],
  d: ["04", "WORK LOG", "every rotation, trip, key test and session event"],
};

let openBayId = null;
let lastBay = "a";
let logFilter = "ALL";

export function initBays() {
  buildKeyRows();
  buildLedgerRows();
  bindBays();
  bindDials();
  bindLog();
  updateAll();
  setInterval(updateAll, 1000);
  state.bus.addEventListener("ledger", updateAll);
  state.bus.addEventListener("dials", updateAll);
  state.bus.addEventListener("log", onLogEvent);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && openBayId) closeSheet();
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      openBay("a");
    }
  });
}

/* ---------- sheet machinery ---------- */

export function openBay(rawId) {
  /* the Service tab and ctrl+K call openBay() with no id — it used to raise
     an EMPTY sheet (no bay matched undefined). Default to the last bay used,
     credentials on first open. */
  const known = ["a", "b", "c", "d"];
  let id = known.includes(rawId)
    ? rawId
    : known.includes(openBayId)
      ? openBayId
      : known.includes(lastBay)
        ? lastBay
        : "a";
  const sheet = document.querySelector(".sheet");
  if (!sheet) return;
  if (openBayId === id) {
    closeSheet();
    return;
  }
  openBayId = id;
  lastBay = id;
  const [num, title, sub] = TITLES[id];
  document.querySelector("[data-sheet-num]").textContent = num;
  document.querySelector("[data-sheet-title]").innerHTML = title + "<small>" + sub + "</small>";
  document.querySelectorAll(".bay").forEach((b) => b.classList.toggle("active", b.dataset.bay === id));
  sheet.classList.add("open");
  document.querySelectorAll(".door").forEach((d) => d.setAttribute("aria-expanded", String(d.dataset.bay === id)));
  if (id === "b") updateLedger();
  if (id === "c") syncDialUi();
  if (id === "d") renderLog();
}

export function closeSheet() {
  openBayId = null;
  const sheet = document.querySelector(".sheet");
  if (sheet) sheet.classList.remove("open");
  document.querySelectorAll(".door").forEach((d) => d.setAttribute("aria-expanded", "false"));
}

function bindBays() {
  document.querySelectorAll(".door[data-bay]").forEach((d) => {
    d.addEventListener("click", () => openBay(d.dataset.bay));
  });
  const close = document.querySelector(".sheet__close");
  if (close) close.addEventListener("click", closeSheet);
}

function updateAll() {
  updateSlabSys();
  updateKeyLeds();
  if (openBayId === "b") updateLedger();
}

function updateSlabSys() {
  const up = availableCount();
  const elUp = document.querySelector("[data-sys-up]");
  if (elUp) elUp.textContent = up + "/10 UP";
  let burn = 0;
  const cutoff = Date.now() - 5 * 60e3;
  for (const m of MODELS) for (const x of state.ledger[m.id].feed) if (x.t >= cutoff) burn += x.tok;
  const elBurn = document.querySelector("[data-sys-burn]");
  if (elBurn) elBurn.textContent = fmtTok(burn / 5) + " tok/min";
}

/* ============================================================
   BAY A · CREDENTIALS
   ============================================================ */

/* Key → vendor recognition. Each vendor's key has a stable public
   prefix; if a paste lands in the wrong row we move it where it lives. */
const KEY_PREFIX = [
  ["AIza", "gemini"],
  ["gsk_", "groq"],
  ["sk-or-", "openrouter"],
];
const GET_KEY_URL = {
  gemini: "https://aistudio.google.com/apikey",
  groq: "https://console.groq.com/keys",
  openrouter: "https://openrouter.ai/settings/keys",
  cloudflare: "https://dash.cloudflare.com/profile/api-tokens",
};
function detectVendor(v) {
  for (const [p, prov] of KEY_PREFIX) if (v.startsWith(p)) return prov;
  if (/^[0-9a-f]{16,48}[/:]/i.test(v)) return "cloudflare"; // <account_id>/<token>
  if (/^cf(at|ut|a)?_/i.test(v)) return "cloudflare"; // Cloudflare API tokens are self-labeled
  return null;
}

/* Mirror state.keys onto every row input (after a sync/backfill). */
function refreshKeyInputs(grid) {
  for (const m of MODELS) {
    const inp = grid.querySelector('.keyrow[data-model="' + m.id + '"] .keyrow__in');
    if (inp) inp.value = state.keys[m.id] || "";
  }
}

/* One-time (per session) kindness: any vendor row that holds a key while
   its siblings sit empty gets the key backfilled across them. */
function backfillVendorKeys() {
  let n = 0;
  for (const prov of Object.keys(VENDORS)) {
    const lines = MODELS.filter((m) => m.provider === prov);
    if (lines.length < 2) continue;
    const donor = lines.find((m) => (state.keys[m.id] || "").trim());
    if (!donor) continue;
    for (const m of lines) {
      if (!(state.keys[m.id] || "").trim()) {
        state.keys[m.id] = state.keys[donor.id];
        n++;
      }
    }
  }
  if (n) {
    saveAll();
    addLog("info", "KEY", "backfill: mirrored vendor keys onto " + n + " sibling line(s)");
  }
  return n;
}

/* The verdict of the last ping, kept visible under the row — a red dot
   without a reason is a support ticket; a red dot with one is an answer. */
function setNote(row, txt, ok) {
  const n = row.querySelector(".keyrow__note");
  if (!n) return;
  n.textContent = txt;
  n.classList.toggle("is-ok", !!ok);
  n.classList.toggle("is-bad", !ok);
}

/* External link: the Capacitor shell routes off-site taps to the system
   browser; plain browsers get a new tab. Never navigate away from the house. */
function openExternal(url) {
  if (typeof window !== "undefined" && window.Capacitor) location.href = url;
  else window.open(url, "_blank", "noopener");
}

const EYE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z"/><circle cx="12" cy="12" r="2.6"/></svg>';

const QUALIFY_SYSTEM = [
  "You are being evaluated as a coding model for Gunther.",
  "Follow the task exactly. Return complete code or a precise technical answer.",
  "Do not use placeholders, omit code, claim tests you did not run, or substitute a general discussion for the requested artifact.",
].join("\n");

async function qualifyModel(m) {
  const answers = {};
  const failures = [];
  for (const test of CODING_QUALIFICATION) {
    try {
      const res = await call(m, {
        system: QUALIFY_SYSTEM,
        messages: [{ role: "user", content: test.prompt }],
        maxTokens: 2400,
        temperature: 0.1,
      });
      answers[test.id] = res.text;
    } catch (error) {
      failures.push(test.id + ": " + (error.note || error.message || error.code || "call failed"));
      answers[test.id] = "";
    }
  }
  const result = qualifyAnswers(answers);
  if (failures.length) {
    result.status = "not-qualified";
    result.results.push({ id: "transport", passed: false, missing: failures, evidence: [] });
  }
  state.ledger[m.id].qualification = { ...result, at: Date.now() };
  addLog(result.status === "qualified" ? "ok" : "warn", "QUALIFY", "LINE " + String(m.line).padStart(2, "0") + " — " + result.status + " " + result.passed + "/" + result.total);
  return result;
}

function buildKeyRows() {
  const grid = document.querySelector("#keygrid");
  if (!grid) return;
  backfillVendorKeys();
  if (!grid.parentElement.querySelector(".keybar")) {
    const bar = document.createElement("div");
    bar.className = "keybar";
    bar.innerHTML =
      '<span class="keybar__label">get a key ↗</span>' +
      Object.keys(VENDORS)
        .map((p) => '<button class="btn btn--sm btn--ghost keybar__chip" type="button" data-getkey="' + p + '">' + p.toUpperCase() + "</button>")
        .join("");
    bar.addEventListener("click", (e) => {
      const p = e.target.closest("[data-getkey]");
      if (p) openExternal(GET_KEY_URL[p.dataset.getkey]);
    });
    grid.parentElement.insertBefore(bar, grid);
  }
  grid.innerHTML = "";
  for (const m of MODELS) {
    const row = document.createElement("div");
    row.className = "keyrow";
    row.dataset.model = m.id;
    row.innerHTML =
      '<span class="keyrow__idx">' + String(m.line).padStart(2, "0") + "</span>" +
      '<span class="keyrow__name">' + escapeHtml(m.name) + "<em>" + escapeHtml(m.provider) + " · " + escapeHtml(m.model) + "</em></span>" +
      '<span class="led led--empty"></span>' +
      '<span class="keyrow__field">' +
        '<input class="keyrow__in" type="password" spellcheck="false" autocomplete="off" placeholder="' + (m.provider === "cloudflare" ? "paste token — account auto-found" : "paste " + m.provider + " key") + '">' +
        '<button class="keyrow__eye" type="button" title="reveal / hide">' + EYE + "</button>" +
      "</span>" +
      '<button class="icobtn keyrow__sync" type="button" title="apply this key to every ' + escapeHtml(m.provider) + ' line">⇌</button>' +
      '<button class="btn btn--ghost keyrow__ping" type="button">PING</button>' +
      '<span class="keyrow__note"></span>';

    const inp = row.querySelector(".keyrow__in");
    inp.value = state.keys[m.id] || "";
    const pg = (state.ledger[m.id] || {}).ping;
    if (pg && pg.at) setNote(row, pg.ok ? "answered — key is live" : pg.note || "ping failed", !!pg.ok);
    const q = (state.ledger[m.id] || {}).qualification;
    if (q && q.at) setNote(row, q.status === "qualified" ? "CODING QUALIFIED — " + q.passed + "/" + q.total : "NOT CODING QUALIFIED — " + q.passed + "/" + q.total, q.status === "qualified");

    let t = 0;
    inp.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const raw = inp.value;
        const v = raw.trim();
        const looks = v ? detectVendor(v) : null;
        let note;
        if (v && looks && looks !== m.provider) {
          // right key, wrong row — park it where it belongs
          for (const o of MODELS) if (o.provider === looks) state.keys[o.id] = v;
          state.keys[m.id] = "";
          inp.value = "";
          refreshKeyInputs(grid);
          const n = MODELS.filter((o) => o.provider === looks).length;
          toast("That reads as a " + looks.toUpperCase() + " key — applied to its " + n + " line(s)", "ok");
          note = "recognised as " + looks + " key, applied vendor-wide";
        } else {
          for (const o of MODELS) if (o.provider === m.provider) {
            state.keys[o.id] = raw;
            const orow = grid.querySelector('.keyrow[data-model="' + o.id + '"]');
            if (orow) setNote(orow, raw.trim() ? "key set — hit PING" : "cleared", null);
          }
          refreshKeyInputs(grid);
          note = v ? "applied to all " + m.provider + " line(s)" : "cleared for " + m.provider;
        }
        saveAll();
        addLog("info", "KEY", "LINE " + String(m.line).padStart(2, "0") + " key edit (" + v.length + " chars) — " + note);
      }, 500);
    });

    row.querySelector(".keyrow__eye").addEventListener("click", () => {
      inp.type = inp.type === "password" ? "text" : "password";
    });

    row.querySelector(".keyrow__sync").addEventListener("click", () => {
      const v = inp.value.trim();
      if (!v) {
        toast("Nothing to sync — paste a " + m.provider + " key first", "warn");
        return;
      }
      let n = 0;
      for (const other of MODELS) {
        if (other.provider === m.provider && other.id !== m.id) {
          state.keys[other.id] = v;
          const orow = grid.querySelector('.keyrow[data-model="' + other.id + '"] .keyrow__in');
          if (orow) orow.value = v;
          n++;
        }
      }
      saveAll();
      addLog("info", "KEY", "key synced to " + n + " sibling " + m.provider + " line(s)");
      toast("Applied to " + n + " sibling line(s)", "ok");
    });

    row.querySelector(".keyrow__ping").addEventListener("click", async () => {
      const btn = row.querySelector(".keyrow__ping");
      const led = row.querySelector(".led");
      btn.disabled = true;
      btn.textContent = "…";
      led.className = "led led--ping";
      row.classList.remove("is-pinged-ok", "is-pinged-bad");
      const r = await ping(m);
      storePing(m, r.ok, r.note);
      setNote(row, r.ok ? "answered — key is live" : r.note, r.ok);
      btn.disabled = false;
      btn.textContent = "PING";
      led.className = "led " + (r.ok ? "led--ok" : "led--bad");
      row.classList.add(r.ok ? "is-pinged-ok" : "is-pinged-bad");
      toast(
        "LINE " + String(m.line).padStart(2, "0") + (r.ok ? " · answered — key is live" : " · " + r.note),
        r.ok ? "ok" : "err"
      );
      addLog(r.ok ? "ok" : "warn", "KEY", "PING LINE " + String(m.line).padStart(2, "0") + " → " + (r.ok ? "answered" : r.note));
    });

    grid.appendChild(row);
  }
  refreshKeyInputs(grid);

  const testAll = document.querySelector("[data-bay-action='testall']");
  if (testAll)
    testAll.addEventListener("click", async () => {
      testAll.disabled = true;
      testAll.textContent = "PINGING ALL…";
      for (const m of MODELS) {
        const row = grid.querySelector('.keyrow[data-model="' + m.id + '"]');
        const led = row.querySelector(".led");
        led.className = "led led--ping";
        const r = await ping(m);
        storePing(m, r.ok, r.note);
        led.className = "led " + (r.ok ? "led--ok" : "led--bad");
        setNote(row, r.ok ? "answered — key is live" : r.note, r.ok);
      }
      testAll.disabled = false;
      testAll.textContent = "PING ALL";
      const okN = MODELS.filter((m) => state.ledger[m.id].ping.ok).length;
      toast(okN + " of 10 lines answered", okN ? "ok" : "warn");
    });

  const qualifyAll = document.querySelector("[data-bay-action='qualifyall']");
  if (qualifyAll)
    qualifyAll.addEventListener("click", async () => {
      qualifyAll.disabled = true;
      qualifyAll.textContent = "QUALIFYING…";
      let done = 0;
      for (const m of MODELS) {
        if (!(state.keys[m.id] || "").trim()) continue;
        const row = grid.querySelector('.keyrow[data-model="' + m.id + '"]');
        const note = row && row.querySelector(".keyrow__note");
        if (note) note.textContent = "coding qualification running…";
        const result = await qualifyModel(m);
        if (note) setNote(row, result.status === "qualified"
          ? "CODING QUALIFIED — " + result.passed + "/" + result.total
          : "NOT CODING QUALIFIED — " + result.passed + "/" + result.total, result.status === "qualified");
        done++;
      }
      qualifyAll.disabled = false;
      qualifyAll.textContent = "QUALIFY CODERS";
      toast(done + " keyed line(s) tested for coding", done ? "ok" : "warn");
    });

  const clearBtn = document.querySelector("[data-bay-action='clearkeys']");
  if (clearBtn)
    clearBtn.addEventListener("click", () => {
      if (!clearBtn.classList.contains("armed")) {
        clearBtn.classList.add("armed");
        clearBtn.textContent = "SURE? ALL 10 SLOTS";
        setTimeout(() => {
          clearBtn.classList.remove("armed");
          clearBtn.textContent = "CLEAR KEYS";
        }, 3200);
        return;
      }
      for (const m of MODELS) state.keys[m.id] = "";
      grid.querySelectorAll(".keyrow__in").forEach((i) => (i.value = ""));
      for (const m of MODELS) state.ledger[m.id].ping = { ok: null, at: 0, note: "" };
      saveAll();
      clearBtn.classList.remove("armed");
      clearBtn.textContent = "CLEAR KEYS";
      addLog("warn", "KEY", "all ten key slots wiped");
      toast("All key slots wiped", "warn");
      updateKeyLeds();
    });
}

function updateKeyLeds() {
  document.querySelectorAll("#keygrid .keyrow").forEach((row) => {
    const m = byId(row.dataset.model);
    if (!m) return;
    const led = row.querySelector(".led");
    const e = state.ledger[m.id];
    if (e.ping && e.ping.at) led.className = "led " + (e.ping.ok ? "led--ok" : "led--bad");
    else led.className = "led led--empty";
  });
}

/* ============================================================
   BAY B · POWER LEDGER
   ============================================================ */

function buildLedgerRows() {
  const wrap = document.querySelector("#ledLines");
  if (!wrap) return;
  wrap.innerHTML = "";
  for (const m of MODELS) {
    const row = document.createElement("div");
    row.className = "led-line";
    row.dataset.model = m.id;
    row.innerHTML =
      '<span class="led-line__idx">' + String(m.line).padStart(2, "0") + "</span>" +
      '<span class="led-line__name">' + escapeHtml(m.name) + "<em>" + escapeHtml(m.model) + "</em></span>" +
      '<span class="led-line__meters">' +
        '<div class="meterrow"><span class="meterrow__lab">MIN</span><div class="meter"><i></i></div></div>' +
        '<div class="meterrow"><span class="meterrow__lab">DAY</span><div class="meter"><i></i></div></div>' +
        '<div class="led-line__trip"></div>' +
      "</span>" +
      '<span class="led-line__nums"></span>';
    wrap.appendChild(row);
  }

  const reset = document.querySelector("[data-bay-action='resetledger']");
  if (reset)
    reset.addEventListener("click", () => {
      if (!reset.classList.contains("armed")) {
        reset.classList.add("armed");
        reset.textContent = "SURE? WIPES ALL METERS";
        setTimeout(() => {
          reset.classList.remove("armed");
          reset.textContent = "RESET LEDGER";
        }, 3200);
        return;
      }
      for (const m of MODELS) {
        const e = state.ledger[m.id];
        e.day = { w: "", req: 0, prompt: 0, completion: 0 };
        e.hour = { w: "", req: 0, prompt: 0, completion: 0 };
        e.feed = [];
        e.trip = { n: 0, until: 0, reason: "" };
      }
      state.ledger.session = { tok: 0, req: 0, handoffs: 0, startedAt: Date.now() };
      saveAll();
      reset.classList.remove("armed");
      reset.textContent = "RESET LEDGER";
      addLog("warn", "ENGINE", "power ledger reset — all meters zeroed, trips cleared");
      toast("Ledger reset", "warn");
      state.bus.dispatchEvent(new CustomEvent("ledger", { detail: {} }));
    });
}

function setLedMeter(el, ratio) {
  if (!el) return;
  const bar = el.querySelector("i");
  if (ratio === null) {
    bar.style.width = "0%";
    bar.style.opacity = "0.25";
    el.classList.remove("is-hot");
    return;
  }
  bar.style.opacity = "1";
  bar.style.width = (ratio * 100).toFixed(1) + "%";
  el.classList.toggle("is-hot", ratio > 0.85);
}

function updateLedger() {
  const now = new Date();
  const wrap = document.querySelector("#ledLines");
  if (!wrap) return;

  let tokToday = 0;
  let reqToday = 0;
  let burn = 0;
  const cutoff = now.getTime() - 5 * 60e3;

  wrap.querySelectorAll(".led-line").forEach((row) => {
    const m = byId(row.dataset.model);
    if (!m) return;
    const e = state.ledger[m.id];
    const hr = headroom(m, now);
    tokToday += e.day.prompt + e.day.completion;
    reqToday += e.day.req;
    for (const x of e.feed) if (x.t >= cutoff) burn += x.tok;

    const dims = hr.dims;
    const minRatio = dims.filter((d) => d.k === "rpm" || d.k === "tpm");
    const dayDims = dims.filter((d) => d.k === "rpd" || d.k === "tpd");
    const minR = minRatio.length ? Math.min(...minRatio.map((d) => 1 - d.used / d.cap)) : null;
    const dayR = dayDims.length ? Math.min(...dayDims.map((d) => 1 - d.used / d.cap)) : null;
    const meters = row.querySelectorAll(".meter");
    setLedMeter(meters[0], minR);
    setLedMeter(meters[1], dayR);

    const nums = row.querySelector(".led-line__nums");
    const bits = [];
    if (m.caps.rpm) bits.push("<b>" + hr.min.req + "</b>/" + m.caps.rpm + " req·min");
    if (m.caps.tpm) bits.push("<b>" + fmtTok(hr.min.tok) + "</b>/" + fmtTok(m.caps.tpm) + " tok·min");
    if (m.caps.rpd) bits.push("<b>" + e.day.req + "</b>/" + fmtTok(m.caps.rpd) + " req·day");
    if (m.caps.tpd) bits.push("<b>" + fmtTok(e.day.prompt + e.day.completion) + "</b>/" + fmtTok(m.caps.tpd) + " tok·day");
    if (!bits.length) bits.push("<b>" + fmtTok(e.day.prompt + e.day.completion) + "</b> tok·day · no published cap");
    nums.innerHTML = bits.join("<br>");

    const tripEl = row.querySelector(".led-line__trip");
    if (isTripped(m, now)) {
      tripEl.textContent = "TRIPPED · back " + fmtDelay(tripRemaining(m, now));
      if (!row.querySelector("button.led-line__clr")) {
        const btn = document.createElement("button");
        btn.className = "btn btn--sm led-line__clr";
        btn.textContent = "CLEAR TRIP";
        btn.style.marginTop = "4px";
        btn.addEventListener("click", () => {
          clearTrip(m);
          toast("LINE " + String(m.line).padStart(2, "0") + " trip cleared", "ok");
        });
        tripEl.appendChild(btn);
      }
    } else {
      tripEl.textContent = "";
      const old = row.querySelector(".led-line__clr");
      if (old) old.remove();
    }
  });

  const sum = document.querySelector("#ledSummary");
  if (sum) {
    const cards = sum.querySelectorAll(".stat-card");
    if (cards[0]) cards[0].querySelector("b").innerHTML = fmtTok(tokToday) + " <em>tok</em>";
    if (cards[1]) cards[1].querySelector("b").innerHTML = fmtTok(reqToday) + " <em>req</em>";
    if (cards[2]) cards[2].querySelector("b").innerHTML = fmtTok(burn / 5) + " <em>tok/min</em>";
    if (cards[3]) cards[3].querySelector("b").innerHTML = String(state.ledger.session.handoffs || 0);
    if (cards[4])
      cards[4].querySelector("b").innerHTML =
        state.ledger.session.tok ? fmtTok(state.ledger.session.tok) + " <em>tok</em>" : "0";
  }
}

/* ============================================================
   BAY C · OVERRIDE & DIALS
   ============================================================ */

function bindDials() {
  const seg = document.querySelectorAll(".seg button[data-cmode]");
  seg.forEach((b) => b.addEventListener("click", () => setMode(b.dataset.cmode)));

  const pinSel = document.querySelector("#pinSel");
  if (pinSel)
    pinSel.addEventListener("change", () => {
      state.dials.pin = pinSel.value;
      state.dials.mode = "pin";
      syncDialUi();
      persistDials();
    });

  const temp = document.querySelector("[data-dial='temperature']");
  const tempOut = document.querySelector("[data-dialout='temperature']");
  if (temp)
    temp.addEventListener("input", () => {
      state.dials.temperature = parseFloat(temp.value);
      tempOut.value = temp.value;
      persistDials();
    });

  const mt = document.querySelector("[data-dial='maxTokens']");
  const mtOut = document.querySelector("[data-dialout='maxTokens']");
  if (mt)
    mt.addEventListener("input", () => {
      state.dials.maxTokens = parseInt(mt.value, 10);
      mtOut.value = fmtTok(state.dials.maxTokens);
      persistDials();
    });

  const archToggle = document.querySelector("[data-dial-toggle='useArchive']");
  if (archToggle)
    archToggle.addEventListener("click", () => {
      state.dials.useArchive = !(state.dials.useArchive !== false);
      syncDialUi();
      persistDials();
      toast(state.dials.useArchive ? "Archive recall ON — turns carry learned notes again" : "Archive recall OFF — the room answers from the conversation alone");
    });

  const sys = document.querySelector("#sysPrompt");
  if (sys)
    sys.addEventListener("input", () => {
      state.dials.system = sys.value;
      clearTimeout(sys._t);
      sys._t = setTimeout(persistDials, 500);
    });

  const tripBtn = document.querySelector("[data-bay-action='tripduty']");
  if (tripBtn)
    tripBtn.addEventListener("click", () => {
      const m = select(128);
      if (!m) {
        toast("No line on duty to trip — the fleet is dark", "warn");
        return;
      }
      manualTrip(m, "manual trip (drill from BAY 03)");
      toast("LINE " + String(m.line).padStart(2, "0") + " tripped — watch the next turn rotate", "warn");
    });

  const restore = document.querySelector("[data-bay-action='restoredials']");
  if (restore)
    restore.addEventListener("click", () => {
      state.dials = { ...DEFAULT_DIALS };
      state.dials.uiMode = state.dials.uiMode; // keep the workbench mode
      syncDialUi();
      persistDials();
      addLog("info", "ENGINE", "dials restored to factory settings");
      toast("Dials restored to factory", "ok");
    });
}

function setMode(mode) {
  state.dials.mode = mode;
  if (mode !== "pin") state.dials.pin = null;
  syncDialUi();
  persistDials();
  if (mode === "drill") {
    addLog("info", "ENGINE", "DRILL mode — every clean turn releases its line; rotation is visible");
    toast("DRILL: each clean turn will hand off to the next line", "warn");
  } else if (mode === "pin") {
    toast("PIN mode — the selected line serves until it exhausts");
  } else {
    toast("AUTO rotation resumed");
  }
}

function persistDials() {
  saveAll();
  state.bus.dispatchEvent(new CustomEvent("dials", { detail: {} }));
}

function syncDialUi() {
  const archToggle = document.querySelector("[data-dial-toggle='useArchive']");
  if (archToggle) {
    const on = state.dials.useArchive !== false;
    archToggle.setAttribute("aria-pressed", String(on));
    archToggle.textContent = on ? "ON" : "OFF";
    const out = document.querySelector("[data-dialout='useArchive']");
    if (out)
      out.textContent = on
        ? "the fleet studies your documents; each turn recalls only the notes it needs"
        : "learned notes stay filed — the room answers from the conversation alone";
  }
  document.querySelectorAll(".seg button[data-cmode]").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.cmode === state.dials.mode));
  });
  const pinSel = document.querySelector("#pinSel");
  if (pinSel) {
    if (!pinSel.options.length) {
      const ph = document.createElement("option");
      ph.value = "";
      ph.textContent = "— choose a line —";
      pinSel.appendChild(ph);
      for (const m of MODELS) {
        const o = document.createElement("option");
        o.value = m.id;
        o.textContent =
          String(m.line).padStart(2, "0") + " · " + m.name + ((state.keys[m.id] || "").trim() ? "" : "  (no key)");
        pinSel.appendChild(o);
      }
    }
    pinSel.value = state.dials.pin || "";
  }
  const temp = document.querySelector("[data-dial='temperature']");
  const tempOut = document.querySelector("[data-dialout='temperature']");
  if (temp) {
    temp.value = state.dials.temperature;
    tempOut.value = String(state.dials.temperature);
  }
  const mt = document.querySelector("[data-dial='maxTokens']");
  const mtOut = document.querySelector("[data-dialout='maxTokens']");
  if (mt) {
    mt.value = state.dials.maxTokens;
    mtOut.value = fmtTok(state.dials.maxTokens);
  }
  const sys = document.querySelector("#sysPrompt");
  if (sys && sys.value !== state.dials.system) sys.value = state.dials.system;
  const uiSeg = document.querySelectorAll(".bench__mode button[data-umode]");
  uiSeg.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.umode === state.dials.uiMode)));
}

/* ============================================================
   BAY D · WORK LOG
   ============================================================ */

function bindLog() {
  document.querySelectorAll(".logfilter[data-f]").forEach((f) => {
    f.addEventListener("click", () => {
      logFilter = f.dataset.f;
      document.querySelectorAll(".logfilter[data-f]").forEach((x) => x.setAttribute("aria-pressed", String(x === f)));
      renderLog();
    });
  });
  const clear = document.querySelector(".log-clear");
  if (clear)
    clear.addEventListener("click", () => {
      state.log = [];
      saveAll();
      renderLog();
      toast("Work log cleared");
    });
}

function onLogEvent() {
  if (openBayId === "d") renderLog();
}

function renderLog() {
  const wrap = document.querySelector("#log");
  if (!wrap) return;
  const wasBottom = wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight < 40;
  const entries = state.log
    .filter((e) => logFilter === "ALL" || e.tag === logFilter)
    .slice(-150);
  if (!entries.length) {
    wrap.innerHTML = '<div class="log--empty">no events yet — the engine is quiet</div>';
    return;
  }
  wrap.innerHTML = entries
    .map(
      (e) =>
        '<div class="logline logline--' + escapeHtml(e.sev) + '">' +
        '<span class="logline__t">' + fmtClock(new Date(e.t)) + "</span>" +
        '<span class="logline__tag">' + escapeHtml(e.tag) + "</span>" +
        '<span class="logline__m">' + escapeHtml(e.msg) + "</span>" +
        "</div>"
    )
    .join("");
  if (wasBottom) wrap.scrollTop = wrap.scrollHeight;
}
