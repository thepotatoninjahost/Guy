/* ============================================================
   Gunther · GLASS HOUSE CONSOLE — js/ui/crest.js
   The roof's live instruments: UTC clock, on-duty chip,
   session totals, and the three staggered nav tabs.
   ============================================================ */

import { state } from "../state.js";
import { MODELS, byId } from "../models.js";
import { select, headroom } from "../engine.js";
import { fmtClock, fmtTok, escapeHtml } from "./render.js";

const VIEWS = { console: "#view-console", fleet: "#view-fleet" };

export function initCrest() {
  const clock = document.querySelector("[data-clock]");
  const tickClock = () => {
    clock.textContent = fmtClock();
  };
  tickClock();
  setInterval(tickClock, 1000);

  document.querySelectorAll(".vtab[data-view]").forEach((tab) => {
    tab.addEventListener("click", () => {
      location.hash = tab.dataset.view === "console" ? "#/console" : "#/fleet";
    });
  });

  const update = () => renderStatus();
  state.bus.addEventListener("ledger", update);
  state.bus.addEventListener("dials", update);
  state.bus.addEventListener("busy", update);
  renderStatus();
}

function setTabCurrent(view) {
  document.querySelectorAll(".vtab[data-view]").forEach((t) => {
    t.setAttribute("aria-current", String(t.dataset.view === view));
  });
}

export function markView(view) {
  setTabCurrent(view);
}

function renderStatus() {
  const m = select(128);
  // crest chip retired (owner directive): the room's ON DUTY card is the single indicator

  const s = state.ledger.session || { tok: 0, req: 0, handoffs: 0 };
  const tok = document.querySelector("[data-session-tok]");
  const req = document.querySelector("[data-session-req]");
  const hand = document.querySelector("[data-session-handoffs]");
  if (tok) tok.textContent = fmtTok(s.tok);
  if (req) req.textContent = String(s.req);
  if (hand) hand.textContent = String(s.handoffs);
}

function MODELS_KEYED() {
  return MODELS.some((m) => (state.keys[m.id] || "").trim());
}

export function dutyModel() {
  return select(128);
}

export function dutyHeadroom(m) {
  if (!m) return 0;
  return headroom(m).ratio;
}

export { byId };
