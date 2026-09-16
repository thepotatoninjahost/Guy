/* ============================================================
   GUY · GLASS HOUSE CONSOLE — js/ui/crest.js
   The roof's live instruments: UTC clock, on-duty chip,
   session totals, and the three staggered nav tabs.
   ============================================================ */

import { state } from "../state.js";
import { byId } from "../models.js";
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

  document.querySelectorAll(".tab[data-view]").forEach((tab) => {
    tab.addEventListener("click", () => {
      const v = tab.dataset.view;
      if (v === "service") {
        const { openBay } = window.__guy?.bays || {};
        if (openBay) openBay();
        return;
      }
      location.hash = v === "console" ? "#/console" : "#/fleet";
    });
  });

  const update = () => renderStatus();
  state.bus.addEventListener("ledger", update);
  state.bus.addEventListener("dials", update);
  state.bus.addEventListener("busy", update);
  renderStatus();
}

function setTabCurrent(view) {
  document.querySelectorAll(".tab[data-view]").forEach((t) => {
    t.setAttribute("aria-current", String(t.dataset.view === view || (view === "console" && t.dataset.view === "console")));
  });
}

export function markView(view) {
  setTabCurrent(view);
}

function renderStatus() {
  const chip = document.querySelector("[data-on-duty]");
  if (!chip) return;
  const m = select(128);
  if (m) {
    chip.innerHTML =
      "<b>" + String(m.line).padStart(2, "0") + "</b> " + escapeHtml(m.name);
  } else if (!MODELS_KEYED()) {
    chip.innerHTML = "NO KEYS — SERVICE BAY 01";
  } else {
    chip.innerHTML = "FLEET AT CEILING";
  }

  const s = state.ledger.session || { tok: 0, req: 0, handoffs: 0 };
  const tok = document.querySelector("[data-session-tok]");
  const req = document.querySelector("[data-session-req]");
  const hand = document.querySelector("[data-session-handoffs]");
  if (tok) tok.textContent = fmtTok(s.tok);
  if (req) req.textContent = String(s.req);
  if (hand) hand.textContent = String(s.handoffs);
}

function MODELS_KEYED() {
  return Object.values(state.keys || {}).some((k) => (k || "").trim());
}

export function dutyModel() {
  return select(128);
}

export function dutyHeadroom(m) {
  if (!m) return 0;
  return headroom(m).ratio;
}

export { byId };
