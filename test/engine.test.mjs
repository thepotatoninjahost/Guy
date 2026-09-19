/* ============================================================
   Gunther · engine test rig — run with:  node test/engine.test.mjs
   Exercises the rotation math without a browser: admission,
   scoring, pins, trips, backoff ladders, drill mode, ledger.
   ============================================================ */

import { MODELS, byId } from "../js/models.js";
import * as engine from "../js/engine.js";
import { state, load } from "../js/state.js";

let passed = 0;
let failed = 0;
const ok = (cond, name) => {
  if (cond) {
    passed++;
    console.log("  ✓ " + name);
  } else {
    failed++;
    console.error("  ✗ " + name);
  }
};

load();

/* fresh slate */
for (const m of MODELS) state.keys[m.id] = "";
state.ledger = {};
for (const m of MODELS) {
  state.ledger[m.id] = {
    day: { w: "", req: 0, prompt: 0, completion: 0 },
    hour: { w: "", req: 0, prompt: 0, completion: 0 },
    feed: [],
    trip: { n: 0, until: 0, reason: "" },
    lastAt: 0,
    latency: { ema: 0, last: 0 },
    ping: { ok: null, at: 0, note: "" },
  };
}
state.ledger.session = { tok: 0, req: 0, handoffs: 0, startedAt: Date.now() };
state.dials = { mode: "auto", pin: null, temperature: 0.4, maxTokens: 4096, system: "", uiMode: "chat" };
state.engine.lastLine = null;

console.log("\n— admission —");
ok(engine.availableCount() === 0, "no keys → zero lines available");
ok(engine.select(64) === null, "no keys → select() is null");

for (const m of MODELS) state.keys[m.id] = "test-key-" + m.id;
ok(engine.availableCount() === 10, "all ten keyed → ten lines available");

const first = engine.select(64);
ok(Boolean(first), "select() picks a line with headroom");

console.log("\n— daily ceiling binding —");
const gem = byId("gemini-25-flash"); // rpd 1500
state.ledger[gem.id].day = { w: engine.dayId(), req: 1499, prompt: 0, completion: 0 };
ok(engine.canAccept(gem, 64) === true, "at 1499/1500 the final request is still admissible");
state.ledger[gem.id].day = { w: engine.dayId(), req: 1500, prompt: 0, completion: 0 };
ok(engine.canAccept(gem, 64) === false, "line at 1500/1500 RPD refuses one more request");
ok(engine.select(64) !== gem, "select() rotates away from the bound line");
ok(engine.availableCount() === 9, "nine lines remain available");

console.log("\n— sliding minute window —");
const groq = byId("groq-llama33-70b"); // rpm 30
const now = Date.now();
state.ledger[groq.id].feed = Array.from({ length: 30 }, (_, i) => ({ t: now - i * 500, tok: 100 }));
ok(engine.sliding(groq, new Date(now)).req === 30, "sliding window counts 30 req in last 60s");
ok(engine.canAccept(groq, 64, new Date(now)) === false, "line at 30 RPM refuses another request");
state.ledger[groq.id].feed = Array.from({ length: 30 }, () => ({ t: now - 70000, tok: 100 }));
ok(engine.canAccept(groq, 64, new Date(now)) === true, "once the window slides past, the line is admitted again");

console.log("\n— TPM ceiling —");
const g3 = byId("gemini-3-flash"); // tpm 250000
state.ledger[g3.id].feed = Array.from({ length: 10 }, () => ({ t: Date.now() - 1000, tok: 25000 }));
ok(engine.canAccept(g3, 64) === false, "line at 250K tok/min refuses more tokens");

console.log("\n— daily TOKEN ceiling binds (the tpd truth) —");
const gq = byId("groq-llama33-70b"); // tpd 200000
ok(gq.caps.tpd > 0, "groq line publishes a daily token ceiling");
state.ledger[gq.id].day = { w: engine.dayId(), req: 5, prompt: 120000, completion: 79999 };
const hrg = engine.headroom(gq);
const tpdDim = hrg.dims.find((d) => d.k === "tpd");
ok(tpdDim && tpdDim.used === 199999, "tpd dimension sums prompt+completion — not a phantom day.tok field");
ok(engine.canAccept(gq, 64) === false, "line at 199,999/200,000 tpd refuses one more request");
ok(hrg.ratio < 0.01, "a bound tpd collapses headroom to ~0");
state.ledger[gq.id].day = { w: engine.dayId(), req: 5, prompt: 60000, completion: 60000 };
ok(engine.canAccept(gq, 64) === true, "half the day spent, the line admits again");

console.log("\n— the 24-hour burn ridge —");
engine.recordSuccess(byId("or-qwen3-coder"), { prompt: 10, completion: 15, total: 25 }, 400);
const ridge = engine.burnRidge();
ok(ridge.length === 24, "ridge is exactly 24 hourly buckets, oldest first");
ok(ridge[23].now === true && ridge[23].tok >= 25, "the current hour accrues the served turn");
ok(state.ledger.hist[state.ledger.hist.length - 1].h === engine.hourId(), "history is bucketed by UTC hour");

console.log("\n— trips & backoff ladder —");
const r1 = byId("groq-r1-70b");
engine.trip(r1, "quota", "test 429");
ok(engine.isTripped(r1), "quota trip puts the line in backoff");
ok(engine.tripRemaining(r1) >= 59e3, "first quota backoff is ~60s");
engine.trip(r1, "quota", "second 429");
ok(engine.tripRemaining(r1) >= 5 * 60e3 - 1000, "second quota backoff is ~5m");
engine.trip(r1, "quota", "third 429");
ok(engine.tripRemaining(r1) >= 30 * 60e3 - 1000, "third quota backoff is ~30m");
engine.clearTrip(r1);
ok(engine.isTripped(r1) === false, "clearTrip releases the line");

engine.trip(r1, "soft", "502 blip");
ok(engine.tripRemaining(r1) >= 14e3, "soft (transient) backoff is short (~15s)");
engine.clearTrip(r1);

console.log("\n— pin & drill —");
state.dials.mode = "pin";
state.dials.pin = "or-llama33-70b";
const pinned = engine.select(64);
ok(pinned && pinned.id === "or-llama33-70b", "pin mode rides the chosen line");
state.dials.mode = "drill";
engine.recordSuccess(byId("groq-llama31-8b"), { prompt: 100, completion: 90, total: 190 }, 800);
ok(engine.isTripped(byId("groq-llama31-8b")), "drill mode releases the line right after a clean turn");
engine.clearTrip(byId("groq-llama31-8b"));
state.dials.mode = "auto";
state.dials.pin = null;

console.log("\n— ledger bookkeeping —");
const before = state.ledger.session.tok;
engine.recordSuccess(byId("gemini-25-flash-lite"), { prompt: 120, completion: 340, total: 460 }, 620);
ok(state.ledger.session.tok === before + 460, "session token total accrues");
const g2 = state.ledger["gemini-25-flash-lite"];
ok(g2.day.req === 1 && g2.day.completion === 340, "daily ledger accrues per line");
ok(g2.hour.req === 1, "hourly ledger accrues per line");
ok(g2.feed.length === 1 && g2.feed[0].tok === 460, "rolling feed records the turn");
ok(g2.latency.ema === 620, "latency EMA records the turn");
const hr = engine.headroom(byId("gemini-25-flash-lite")); // one turn just served
const rpdDim = hr.dims.find((d) => d.k === "rpd");
ok(rpdDim && rpdDim.used === 1, "rpd dimension counts the served turn (1/1000)");
const liteCaps = byId("gemini-25-flash-lite").caps;
ok(Math.abs(hr.ratio - (liteCaps.rpm - 1) / liteCaps.rpm) < 1e-9, "headroom is the tightest dimension (1 of " + liteCaps.rpm + " rpm spent)");

console.log("\n— headroom decomposition —");
const h = engine.headroom(gem); // 1500/1500 RPD from earlier
ok(h.dims.some((d) => d.k === "rpd" && d.used === 1500), "rpd dimension decomposed with usage");
ok(h.ratio < 0.01, "headroom ~0 on the bound dimension");

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
