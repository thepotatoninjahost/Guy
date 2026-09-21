/* ============================================================
   Gunther · GLASS HOUSE CONSOLE — js/ui/crest.js
   The roof's live instruments: UTC clock, on-duty chip,
   session totals, and the three staggered nav tabs.
   ============================================================ */

import { state } from "../state.js";
import { MODELS } from "../models.js";
import { select, availableCount, isTripped } from "../engine.js";
import { fmtClock, fmtTok } from "./render.js";

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
  // trips expire in silence — poll so the alert lamp also RELINQUISHES
  setInterval(update, 15000);
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

  // the Fleet tab carries an alert lamp: it glows whenever a keyed line is
  // tripped, cooling, or pinned at a ceiling — trouble, visible from any room
  const led = document.querySelector('.vtab[data-view="fleet"] .vtab__led');
  if (led) {
    const keyed = MODELS.filter((m) => ((state.keys && state.keys[m.id]) || "").trim());
    let stressed = false;
    if (keyed.length) {
      stressed =
        availableCount() < keyed.length ||
        keyed.some((m) => isTripped(m)) ||
        (state.hold && state.hold.length > 0);
    }
    led.classList.toggle("is-alert", stressed);
  }
}

