/* ============================================================
   Gunther · GLASS HOUSE CONSOLE — js/main.js
   Pour the concrete: load state, raise the crest, the rooms,
   the fleet, the bays — then hand the keys over.
   ============================================================ */

import { load, state, addLog, emit } from "./state.js";
import { initArchive } from "./ui/archive.js";
import { MODELS } from "./models.js";
import { initCrest, markView } from "./ui/crest.js";
import { initConsole, send, stop } from "./ui/console.js";
import { initFleet } from "./ui/fleet.js";
import { initBays, openBay, closeSheet } from "./ui/bays.js";

window.__gunther = {
  bays: { openBay, closeSheet },
  console: { send, stop },
  state: () => state,
};

const VIEWS = ["console", "fleet", "archive"];
function route() {
  const h = location.hash || "#/console";
  let v = "console";
  for (const key of VIEWS) if (h.startsWith("#/" + key)) v = key;
  for (const key of VIEWS) document.querySelector("#view-" + key).hidden = v !== key;
  markView(v);
}

/* The bars at the edges of the screen — crest and slab — are what every
   height calculation subtracts. If those subtractions are hopeful numbers,
   a bigger system font or a thicker gesture inset makes the real bar taller
   than the reservation, and the menu eats the composer (owner report:
   "the menu blocks the chat box so I can't see what I'm typing").
   So the variables become MEASURED truth, kept true by observation:
   rendered height for the bars, plus --kb for however much the keyboard
   covers the visual viewport. */
function measureFurniture() {
  const doc = document.documentElement;
  const bars = [
    [document.querySelector(".crest"), "--crest-h"],
    [document.querySelector(".slab"), "--slab-h"],
  ].filter(([el]) => el);
  const sync = () => {
    for (const [el, name] of bars) {
      const h = Math.ceil(el.getBoundingClientRect().height);
      if (h > 40) doc.style.setProperty(name, h + "px");
    }
  };
  sync();
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(sync);
    for (const [el] of bars) ro.observe(el);
  }
  const vv = window.visualViewport;
  const kb = () => {
    let covered = 0;
    if (vv) covered = Math.round(window.innerHeight - vv.height - vv.offsetTop);
    doc.style.setProperty("--kb", (covered > 40 ? covered : 0) + "px");
    sync();
  };
  if (vv) {
    vv.addEventListener("resize", kb);
    window.addEventListener("resize", kb);
    kb();
  }
  window.addEventListener("resize", sync);
}

function boot() {
  load();
  const keyed = MODELS.filter((m) => (state.keys[m.id] || "").trim()).length;
  addLog(
    "info",
    "SESSION",
    "console online — " + keyed + " of 10 lines keyed · " + MODELS.length + " lines on the manifest"
  );

  initCrest();
  initConsole();
  initFleet();
  initArchive();
  initBays();

  window.addEventListener("hashchange", route);
  route();
  measureFurniture();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
