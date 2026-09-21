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
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
