/* ============================================================
   Gunther · GLASS HOUSE CONSOLE — js/ui/fleet.js
   Ten lines, live. Each row: status, sliding-minute gauge,
   daily ledger, trip countdown, last activity. The endpoint
   model id is editable in place (free rosters rotate; the
   manifest should too). Hover a row to pin it from the bay.
   ============================================================ */

import { state, addLog, scheduleSave } from "../state.js";
import { MODELS, byId, effectiveId, VENDORS } from "../models.js";
import {
  headroom,
  burnRidge,
  isTripped,
  tripRemaining,
  availableCount,
  select,
  clearTrip,
  fmtDelay,
} from "../engine.js";
import { escapeHtml, fmtTok, fmtClockHM, toast } from "./render.js";

const $lines = () => document.querySelector("#lines");

export function initFleet() {
  buildRows();
  update();
  setInterval(update, 1000);
  state.bus.addEventListener("ledger", update);
  state.bus.addEventListener("dials", update);
  state.bus.addEventListener("lines", update);
  window.addEventListener("resize", drawRidge);
}

/* ---------- the ridge: this fleet's day, hour by hour, in pure canvas ---------- */
let ridgeContextLost = false;
function drawRidge() {
  if (ridgeContextLost) return;
  const c = document.querySelector("canvas[data-ridge]");
  if (!c) return;
  const g = c.getContext ? c.getContext("2d") : null;
  if (!g) {
    ridgeContextLost = true; // no 2d canvas here (test rigs, hardened webviews) — stop asking
    return;
  }
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(120, Math.floor(c.clientWidth || 320));
  const h = 34;
  if (c.width !== w * dpr || c.height !== h * dpr) {
    c.width = w * dpr;
    c.height = h * dpr;
  }
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const bars = burnRidge();
  const max = Math.max(1, ...bars.map((b) => b.tok));
  const bw = (w - 46) / 24;
  bars.forEach((b, i) => {
    const x = Math.round(i * (bw + 2));
    const bh = b.tok > 0 ? Math.max(3, Math.round((b.tok / max) * (h - 4))) : 3;
    g.fillStyle = b.now
      ? "rgba(240, 194, 110, 0.95)"
      : b.tok > 0
        ? "rgba(140, 170, 220, 0.34)"
        : "rgba(140, 170, 220, 0.12)";
    g.fillRect(x, h - bh, Math.max(2, Math.round(bw)), bh);
  });
}

function buildRows() {
  const wrap = $lines();
  wrap.innerHTML = "";
  for (const m of MODELS) {
    const row = document.createElement("div");
    row.className = "line";
    row.dataset.id = m.id;
    row.innerHTML =
      '<span class="line__idx">' + String(m.line).padStart(2, "0") + "</span>" +
      '<div class="line__idwrap">' +
        '<div class="line__name">' + escapeHtml(m.name) +
          (m.tier === "TRIAL" ? '<span class="line__tag line__tag--trial">TRIAL</span>' : '<span class="line__tag">FREE</span>') +
        "</div>" +
        '<div class="line__vendor"></div>' +
        '<div class="line__midwrap"></div>' +
      "</div>" +
      '<span class="line__status"></span>' +
      '<div class="line__meters">' +
        '<div class="meterrow"><span class="meterrow__lab">MIN</span><div class="meter"><i></i></div></div>' +
        '<div class="meterrow"><span class="meterrow__lab">DAY</span><div class="meter"><i></i></div></div>' +
        '<div class="line__nums"></div>' +
      "</div>" +
      '<span class="line__win"></span>' +
      '<span class="line__last"></span>' +
      '<button class="line__ovr" type="button">OVERRIDE →</button>' +
      '<div class="line__note">' + escapeHtml(m.note) + "</div>";

    row.querySelector(".line__vendor").textContent =
      (VENDORS[m.provider] ? VENDORS[m.provider].label : m.provider) + " · ctx " + fmtTok(m.ctx) + " tok";
    renderModelId(row, m);

    row.querySelector(".line__ovr").addEventListener("click", () => pinFromFleet(m));
    wrap.appendChild(row);
  }
}

function renderModelId(row, m) {
  const wrap = row.querySelector(".line__midwrap");
  const current = effectiveId(m, state.linePatches);
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "line__modelid";
  btn.textContent = current + (current !== m.model ? " · patched" : "");
  btn.title = "click to edit the endpoint model id";
  wrap.innerHTML = "";
  wrap.appendChild(btn);

  btn.addEventListener("click", () => {
    const inp = document.createElement("input");
    inp.className = "line__idedit";
    inp.value = current;
    inp.spellcheck = false;
    inp.autocomplete = "off";
    wrap.innerHTML = "";
    wrap.appendChild(inp);
    inp.focus();
    inp.select();

    let done = false;
    const commit = (save) => {
      if (done) return;
      done = true;
      const v = inp.value.trim();
      if (save && v && v !== current) {
        state.linePatches[m.id] = { ...(state.linePatches[m.id] || {}), model: v };
        scheduleSave();
        addLog("info", "ENGINE", "LINE " + String(m.line).padStart(2, "0") + " endpoint patched → " + v);
        toast("LINE " + String(m.line).padStart(2, "0") + " endpoint patched", "ok");
        state.bus.dispatchEvent(new CustomEvent("lines", { detail: { id: m.id } }));
        update();
      } else if (save && v !== current) {
        update();
      } else {
        update();
      }
    };
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") commit(true);
      if (e.key === "Escape") commit(false);
    });
    inp.addEventListener("blur", () => commit(true));
  });
}

function pinFromFleet(m) {
  state.dials.mode = "pin";
  state.dials.pin = m.id;
  scheduleSave();
  addLog("info", "ENGINE", "LINE " + String(m.line).padStart(2, "0") + " pinned for dispatch (BAY 03 controls)");
  state.bus.dispatchEvent(new CustomEvent("dials", { detail: {} }));
  toast("LINE " + String(m.line).padStart(2, "0") + " pinned — BAY 03 now holds the override", "ok");
  if (window.__gunther && window.__gunther.bays) window.__gunther.bays.openBay("c");
}

function meterRatio(dims, keys) {
  const relevant = dims.filter((d) => keys.includes(d.k));
  if (!relevant.length) return null;
  let r = 1;
  for (const d of relevant) if (d.cap > 0) r = Math.min(r, 1 - (Number(d.used) || 0) / d.cap);
  return Math.max(0, Math.min(1, r));
}

function update() {
  const wrap = $lines();
  if (!wrap) return;
  const now = new Date();
  const duty = select(128);
  const rows = wrap.querySelectorAll(".line");

  rows.forEach((row) => {
    const m = byId(row.dataset.id);
    if (!m) return;
    const hr = headroom(m, now);
    const e = state.ledger[m.id];

    row.classList.toggle("on-duty", Boolean(duty) && duty.id === m.id);
    row.classList.toggle("is-pinned", state.dials.mode === "pin" && state.dials.pin === m.id);

    /* status */
    const st = row.querySelector(".line__status");
    if (!hr.hasKey) {
      st.textContent = "NO KEY";
      st.className = "line__status st-nockey";
    } else if (isTripped(m, now)) {
      st.textContent = "TRIP " + fmtDelay(tripRemaining(m, now));
      st.className = "line__status st-trip";
    } else if (state.dials.mode === "pin" && state.dials.pin === m.id) {
      st.textContent = "PINNED";
      st.className = "line__status st-pinned";
    } else if (duty && duty.id === m.id) {
      st.textContent = "ON DUTY";
      st.className = "line__status st-duty";
    } else {
      st.textContent = "STANDBY";
      st.className = "line__status";
    }

    /* gauges */
    const minRatio = meterRatio(hr.dims, ["rpm", "tpm"]);
    const dayRatio = meterRatio(hr.dims, ["rpd", "tpd", "vrpd"]);
    const meters = row.querySelectorAll(".meter");
    setMeter(meters[0], minRatio);
    setMeter(meters[1], dayRatio);

    const dayTok = e.day.prompt + e.day.completion;
    const nums = row.querySelector(".line__nums");
    const bits = [];
    if (m.caps.rpd) bits.push(e.day.req + "/" + fmtTok(m.caps.rpd) + " req");
    if (m.caps.tpd) bits.push(fmtTok(dayTok) + "/" + fmtTok(m.caps.tpd) + " tok");
    if (m.caps.tpd === 0 && m.caps.rpd === 0) bits.push(fmtTok(dayTok) + " tok burned");
    else bits.push(fmtTok(dayTok) + " tok today");
    nums.textContent = bits.join(" · ");

    /* window + last */
    const win = row.querySelector(".line__win");
    if (hr.hasKey && !isTripped(m, now)) {
      const binding = hr.dims
        .filter((d) => d.k === "rpd" || d.k === "tpd" || d.k === "vrpd")
        .sort((a, b) => (a.used / a.cap) - (b.used / b.cap))[0];
      if (binding) {
        const frac = Math.round((binding.used / binding.cap) * 100);
        win.innerHTML = "<b>" + frac + "%</b> of " + binding.k.toUpperCase() + " day";
      } else {
        win.textContent = "no daily cap";
      }
    } else {
      win.textContent = isTripped(m, now) ? "backoff " + fmtDelay(tripRemaining(m, now)) : "—";
    }
    const last = row.querySelector(".line__last");
    last.textContent = e.lastAt ? "last " + fmtClockHM(new Date(e.lastAt)) : "no traffic yet";
  });

  /* head summary */
  const up = availableCount(now);
  const set = (sel, v, html) => {
    const el = document.querySelector(sel);
    if (!el) return;
    if (html) el.innerHTML = v;
    else el.textContent = v;
  };
  set("[data-f-up]", up + "<em>/10</em>", true);
  let tokToday = 0;
  let reqToday = 0;
  for (const m of MODELS) {
    const e = state.ledger[m.id] || { day: {} };
    tokToday += (Number(e.day.prompt) || 0) + (Number(e.day.completion) || 0);
    reqToday += Number(e.day.req) || 0;
  }
  set("[data-f-tok]", fmtTok(tokToday));
  set("[data-f-req]", fmtTok(reqToday));
  set("[data-f-hand]", String(state.ledger.session.handoffs || 0));
  // burn rate: tokens in the last 5 minutes, per minute
  let burn = 0;
  const cutoff = now.getTime() - 5 * 60e3;
  for (const m of MODELS) for (const x of state.ledger[m.id].feed) if (x.t >= cutoff) burn += x.tok;
  set("[data-f-burn]", fmtTok(burn / 5) + "<em>/min</em>", true);
  // the fleet's collective daily headroom
  let worst = 1;
  for (const m of MODELS) {
    const hr = headroom(m, now);
    const dayRatio = meterRatio(hr.dims, ["rpd", "tpd", "vrpd"]);
    if (dayRatio !== null && hr.hasKey) worst = Math.min(worst, dayRatio);
  }
  set("[data-f-head]", Math.round(worst * 100) + "%");
  drawRidge();
}

function setMeter(el, ratio) {
  if (!el) return;
  const bar = el.querySelector("i");
  if (ratio === null) {
    bar.style.width = "0%";
    el.classList.remove("is-hot");
    bar.style.opacity = "0.25";
    return;
  }
  bar.style.opacity = "1";
  bar.style.width = (ratio * 100).toFixed(1) + "%";
  el.classList.toggle("is-hot", ratio < 0.25); // hot = almost out of room
  el.classList.toggle("is-low", ratio >= 0.25 && ratio < 0.6);
}

export function clearTripPublic(id) {
  const m = byId(id);
  if (m) clearTrip(m);
}
