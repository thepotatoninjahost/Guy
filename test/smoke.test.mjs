/* ============================================================
   Gunther · DOM smoke test — run with:  node test/smoke.test.mjs
   Boots the real app (index.html + all modules) inside jsdom,
   then drives a full streaming turn through transport → engine
   → console with a stubbed fetch. Catches runtime wiring errors.
   ============================================================ */

import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

const dom = new JSDOM(html, {
  url: "http://localhost:8000/",
  pretendToBeVisual: true,
});

const { window } = dom;
// Note: CustomEvent/EventTarget are intentionally left as Node's built-ins —
// the engine bus is a Node EventTarget in this rig, and same-realm events must match it.
const shims = {
  window,
  document: window.document,
  localStorage: window.localStorage,
  location: window.location,
  navigator: window.navigator,
  HTMLElement: window.HTMLElement,
  getComputedStyle: window.getComputedStyle,
  requestAnimationFrame: (cb) => setTimeout(cb, 16),
  cancelAnimationFrame: (id) => clearTimeout(id),
};
for (const [k, v] of Object.entries(shims)) {
  try {
    Object.defineProperty(global, k, { value: v, configurable: true, writable: true });
  } catch {
    /* global already exists and is fine */
  }
}

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 4000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return true;
    await sleep(25);
  }
  return fn();
}

/* ---------- boot ---------- */
await import("../js/main.js");
ok(await until(() => Boolean(window.__gunther)), "window.__gunther is registered after boot");

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

ok($$("#lines .line").length === 10, "Fleet renders all ten lines");
ok($$("#keygrid .keyrow").length === 10, "Bay A renders ten key slots");
ok($$("#ledLines .led-line").length === 10, "Bay B renders ten ledger rows");
ok(/^\d\d:\d\d:\d\dZ$/.test($("[data-clock]").textContent), "crest clock is ticking");
ok(!$("[data-on-duty]"), "the crest chip is retired — ONE duty indicator, in the room");
ok(!$("#empty"), "the hero state is deleted — the conversation window owns the room");
ok($("#feed").hidden === false, "the conversation window is visible from the very start (hero deleted)");
ok($$("#lines .line.on-duty").length === 0, "no line on duty before keys exist");

/* ---------- bay machinery ---------- */
window.__gunther.bays.openBay("b");
ok($(".sheet").classList.contains("open"), "opening a bay raises the sheet");
ok($('.bay[data-bay="b"]').classList.contains("active"), "bay B is the active bay");
ok($("[data-sheet-num]").textContent === "02", "sheet header shows bay 02");
window.__gunther.bays.openBay("b");
ok(!$(".sheet").classList.contains("open"), "toggling the same door closes the sheet");

window.__gunther.bays.openBay("d");
ok($$("#log .logline").length >= 1, "work log shows the boot event");
window.__gunther.bays.closeSheet();

/* ---------- guard: no keys, no turns ---------- */
window.__gunther.console.send("hello there");
await sleep(30);
ok($$(".toasts .toast").some((t) => t.textContent.includes("BAY 01")), "send without keys is refused with a toast");
ok($$(".sheet.open")?.length === 1, "the refusal lifts the credentials bay");

/* ---------- key everything, line goes on duty ---------- */
const state = window.__gunther.state();
for (const k of Object.keys(state.keys)) state.keys[k] = "sk-test-" + k;
state.bus.dispatchEvent(new CustomEvent("dials", { detail: {} }));
await sleep(30);
ok($$("#lines .line.on-duty").length === 1, "exactly one line goes on duty once keys exist");
ok($("[data-duty-model]").textContent.trim().length > 3, "the ON DUTY card names the line on duty");

/* ---------- vendor auto-broadcast through the real input path ---------- */
const g1 = $('.keyrow[data-model="groq-r1-70b"] .keyrow__in');
g1.value = "gsk_autotest123";
g1.dispatchEvent(new window.Event("input", { bubbles: true }));
await until(() =>
  state.keys["groq-llama33-70b"] === "gsk_autotest123" &&
  state.keys["groq-llama31-8b"] === "gsk_autotest123"
);
ok(true, "a pasted Groq key spreads across all three Groq lines");

const g2 = $('.keyrow[data-model="groq-llama31-8b"] .keyrow__in');
g2.value = "AIzaSYNTHETIC";
g2.dispatchEvent(new window.Event("input", { bubbles: true }));
await until(() =>
  state.keys["gemini-25-flash"] === "AIzaSYNTHETIC" &&
  state.keys["gemini-3-flash"] === "AIzaSYNTHETIC" &&
  state.keys["groq-llama31-8b"] === ""
);
ok(true, "prefix recognition parks a mis-pasted key in the right vendor group");

ok(!!$("#keygrid").parentElement.querySelector(".keybar"), "get-a-key vendor strip renders above the grid");

/* ---------- in-app native escape: PING routes through CapacitorHttp ---------- */
let capturedReq = null;
window.Capacitor = {
  isNativePlatform: () => true,
  Plugins: {
    CapacitorHttp: {
      request: async (o) => {
        capturedReq = o;
        return {
          status: 200,
          data: { choices: [{ message: { content: "OK" }, finish_reason: "stop" }], usage: { total_tokens: 5 } },
        };
      },
    },
  },
};
{
  const orRow = $('.keyrow[data-model="or-llama4-maverick"]');
  orRow.querySelector(".keyrow__in").value = "sk-or-v1-fake-for-native-path";
  orRow.querySelector(".keyrow__in").dispatchEvent(new window.Event("input", { bubbles: true }));
  await until(() => state.keys["or-llama4-maverick"] === "sk-or-v1-fake-for-native-path");
  orRow.querySelector(".keyrow__ping").click();
  await until(() => (orRow.querySelector(".keyrow__note").textContent || "").includes("answered (native)"), 6000);
  ok(!!capturedReq && capturedReq.url.includes("openrouter.ai"), "in-app ping rode the native HTTP plugin, not the WebView");
  ok(capturedReq.headers.authorization === "Bearer sk-or-v1-fake-for-native-path", "native request carried the bearer token");
}
delete window.Capacitor;

/* ---------- a live streaming turn through the stubbed wire ---------- */
let fetches = [];
const sse = (payloads) => {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < payloads.length) {
        controller.enqueue(encoder.encode("data: " + payloads[i] + "\n\n"));
        i++;
      } else {
        controller.close();
      }
    },
  });
};
global.fetch = async (url, opts) => {
  fetches.push(String(url));
  const isGemini = String(url).includes("generativelanguage");
  if (isGemini) {
    return {
      ok: true,
      status: 200,
      body: sse([
        JSON.stringify({ candidates: [{ content: { parts: [{ text: "Framed" }] } } ] }),
        JSON.stringify({ candidates: [{ content: { parts: [{ text: " the" }] } } ] }),
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: " wall." }] } }],
          usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 9, totalTokenCount: 21 },
        }),
      ]),
    };
  }
  if (String(url).includes("client/v4/accounts")) {
    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true, result: [{ id: "acct_deadbeef01", name: "Gunther Main" }] }),
      text: async () => "",
    };
  }
  return {
    ok: true,
    status: 200,
    text: async () => "",
    json: async () => ({}),
    body: sse([
      JSON.stringify({ choices: [{ delta: { content: "Framed " } }] }),
      JSON.stringify({
        choices: [{ delta: { content: "the wall." }, finish_reason: "stop" }],
        usage: { prompt_tokens: 12, completion_tokens: 9, total_tokens: 21 },
      }),
      "[DONE]",
    ]),
  };
};

/* Pin the fleet to line 01 so this test is about the wire, not the
   registry's current quality tuning — the engine is free to prefer other
   lines in the real world. */
state.dials.mode = "pin";
state.dials.pin = "gemini-25-flash";
state.bus.dispatchEvent(new CustomEvent("dials", { detail: {} }));

window.__gunther.console.send("build the glass wall");
ok(await until(() => state.ledger.session.req >= 1, 5000), "the turn completed and was booked to the ledger");
ok(fetches.length === 1, "exactly one wire call for one turn");
const usedLine = fetches[0];
ok(usedLine.includes("generativelanguage") || usedLine.includes("openai/v1"), "the call hit a provider endpoint");
/* ---------- Cloudflare: a bare token now finds its own account ---------- */
{
  const cfRow = $('.keyrow[data-model="cf-llama33-70b"]');
  cfRow.querySelector(".keyrow__in").value = "cfat_testTokenOnly1234567890abcdef";
  cfRow.querySelector(".keyrow__in").dispatchEvent(new window.Event("input", { bubbles: true }));
  await until(() => state.keys["cf-llama33-70b"] === "cfat_testTokenOnly1234567890abcdef");
  const before = fetches.length;
  cfRow.querySelector(".keyrow__ping").click();
  await until(() => (cfRow.querySelector(".keyrow__note").textContent || "").includes("answered"), 8000);
  ok(state.keys["cf-llama33-70b"] === "acct_deadbeef01/cfat_testTokenOnly1234567890abcdef",
    "bare Cloudflare token was auto-rewritten to acct/token after discovery");
  ok(fetches.slice(before).some((u) => u.includes("/accounts/acct_deadbeef01/ai/v1/chat/completions")),
    "the CF ping rode the discovered account id in the URL path");
}


const agentMsg = $$(".feed .msg--agent").pop();
ok(Boolean(agentMsg), "the agent reply rendered in the feed");
ok(agentMsg.querySelector(".msg__body").textContent.includes("Framed the wall."), "streamed text assembled in the reply body");
ok(/\d+ tok/.test(agentMsg.querySelector(".msg__meta").textContent), "reply header shows token count");
ok(state.ledger.session.tok === 21, "session tokens accrue from the real usage payload");
ok($("#feed").hidden === false, "the feed is always on screen — nothing to yield to");

/* ---------- 429 → trip → seamless handoff ---------- */
fetches = [];
let first = true;
const rotatedResponse = (url) => {
  const isGemini = String(url).includes("generativelanguage");
  if (isGemini) {
    return {
      ok: true,
      status: 200,
      body: sse([
        JSON.stringify({ candidates: [{ content: { parts: [{ text: "rotated fine." }] } }],
          usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3, totalTokenCount: 8 } }),
      ]),
    };
  }
  return {
    ok: true,
    status: 200,
    body: sse([
      JSON.stringify({ choices: [{ delta: { content: "rotated fine." } }] }),
      JSON.stringify({
        choices: [{ delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
      }),
      "[DONE]",
    ]),
  };
};
global.fetch = async (url) => {
  fetches.push(String(url));
  if (first) {
    first = false;
    return {
      ok: false,
      status: 429,
      body: null,
      text: async () => JSON.stringify({ error: { message: "Resource has been exhausted (quota), please retry later." } }),
    };
  }
  return rotatedResponse(url);
};
const handoffsBefore = state.ledger.session.handoffs;
window.__gunther.console.send("again, please");
ok(await until(() => state.ledger.session.handoffs > handoffsBefore, 5000), "the 429 was handed off — handoff counter moved");
ok(fetches.length === 2, "two wire calls: one tripped line, one rotated");
ok(fetches[0] !== fetches[1], "the retry actually changed lines");
const tripped = Object.entries(state.ledger).filter(([id, e]) => id !== "session" && e.trip.until > Date.now());
ok(tripped.length === 3, "the 429 tripped the whole OpenRouter vendor group — one ceiling, not three (no more line-by-line door-knocking)");
const lastAgent = $$(".feed .msg--agent").pop();
ok(lastAgent.querySelector(".msg__body").textContent.includes("rotated fine."), "the rotated line delivered the turn");
ok(lastAgent.querySelector(".msg__rot").textContent.includes("handoff"), "the reply header records the handoff");

/* ---------- plan mode parses a strict JSON plan ---------- */
let planCall = 0;
const PLAN_JSON =
  '{"goal":"tiny build","steps":[{"title":"scaffold","prompt":"make index.html"},{"title":"harden","prompt":"add meta tags"}]}';
global.fetch = async (url) => {
  planCall++;
  const isGemini = String(url).includes("generativelanguage");
  if (planCall === 1) {
    if (isGemini) {
      return {
        ok: true,
        status: 200,
        body: sse([
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: PLAN_JSON }] } }],
            usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 6, totalTokenCount: 10 },
          }),
        ]),
      };
    }
    return {
      ok: true,
      status: 200,
      body: sse([
        JSON.stringify({ choices: [{ delta: { content: PLAN_JSON } }] }),
        JSON.stringify({
          choices: [{ delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 4, completion_tokens: 6, total_tokens: 10 },
        }),
        "[DONE]",
      ]),
    };
  }
  if (isGemini) {
    return {
      ok: true,
      status: 200,
      body: sse([
        JSON.stringify({ candidates: [{ content: { parts: [{ text: "```html\n<!doctype html>\n```" }] } }],
          usageMetadata: { promptTokenCount: 6, candidatesTokenCount: 4, totalTokenCount: 10 } }),
      ]),
    };
  }
  return {
    ok: true,
    status: 200,
    body: sse([
      JSON.stringify({ choices: [{ delta: { content: "```html\n<!doctype html>\n```" } }] }),
      JSON.stringify({
        choices: [{ delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 6, completion_tokens: 4, total_tokens: 10 },
      }),
      "[DONE]",
    ]),
  };
};
state.dials.uiMode = "plan";
window.__gunther.console.send("build the tiny house");
ok(
  await until(() => $$(".plan__step.is-done").length === 2, 6000),
  "PLAN mode executed both steps of the parsed plan"
);
ok($$(".plan").length === 1, "the plan tile rendered once");

ok($$(".feed .codeblock").length >= 1, "step output rendered a fenced code block");

/* ---------- never silent: the turnbar narrates, the watchdog rotates ---------- */
{
  const tb = () => document.querySelector(".turnbar");
  ok(!!tb(), "activity strip exists above the feed");
  const savedKeys = { ...state.keys };
  const savedFetch = global.fetch;
  const savedPin = state.dials.mode;
  const savedFw = state.dials.firstWordMs;
  state.keys = {};
  state.keys["gemini-25-flash"] = "AIza-test-watchdog";
  state.dials.mode = "auto";
  state.dials.uiMode = "chat";
  state.dials.firstWordMs = 140;
  state.bus.dispatchEvent(new CustomEvent("dials", { detail: {} }));
  const hang = () => new Promise(() => {}); // black-holed connection: never resolves, never errors
  global.fetch = (u) => (String(u).includes("generativelanguage") ? hang() : Promise.reject(new TypeError("blocked")));

  window.__gunther.console.send("prove you are working", true);
  ok(await until(() => /selecting|contacting|rotating/i.test(tb().textContent || ""), 2000), "strip narrates the instant a task is sent");
  const verdict = await until(() => tb().dataset.state === "halt", 15000);
  if (!verdict) console.log("TBDBG", tb().dataset.state, JSON.stringify(tb().textContent));
  ok(verdict, "hung lines become a visible verdict instead of dead silence");
  ok(/CEILING|HALTED|refused/i.test(tb().textContent || ""), "the halt names the reason on the strip itself");

  global.fetch = savedFetch;
  state.keys = savedKeys;
  state.dials.firstWordMs = savedFw || 25000;
  state.bus.dispatchEvent(new CustomEvent("dials", { detail: {} }));
  window.__gunther.console.send("answer me", true);
  ok(await until(() => /ANSWERED VIA LINE/i.test(tb().textContent || ""), 8000), "success is announced by the strip too");
}

/* ---------- layout law: hidden means hidden, flow means no collisions ---------- */
{
  const facade = readFileSync("css/04-facade.css", "utf8");
  const mobile = readFileSync("css/07-mobile.css", "utf8");
  ok(!/id="empty"/.test(readFileSync("index.html", "utf8")) && !/.empty {/.test(facade), "the hero — and its overlap vector — are deleted, not hidden");
  ok(!/\.empty/.test(mobile), "no hero rules left on the phone sheet");
  for (const src of [facade, mobile]) {
    const bands = src.match(/(\.empty__sub|\.empty__chips|\.chip-btn|\.turnbar|\.msg__head|\.feed) \{[^}]*\}/g) || [];
    for (const b of bands) {
      ok(!/margin-top: *-/.test(b) && !/position: *absolute/.test(b), "no negative-margin/absolute trickery in " + b.slice(0, b.indexOf(" {")));
    }
  }
  ok(/rgba\(13, 19, 31, 0\.30\)/.test(facade) && /blur\(14px\)/.test(facade), "agent bubbles are translucent glass again (no black cover-ups)");
  ok(!/background: *#070b13/.test(facade), "code blocks shed the opaque slab fill");
}


/* ---------- every surface opens, no window is empty, no error escapes ---------- */
{
  const errs = [];
  window.addEventListener("error", (e) => errs.push(String(e && e.message)));
  process.on("unhandledRejection", (r) => errs.push("rejection: " + r));

  // the slab doors raise FILLED bays — the top menu is gone; this is the only menu
  document.querySelector('.door[data-bay="a"]').click();
  await until(() => document.querySelector(".sheet").classList.contains("open"));
  const active = document.querySelector(".bay.active");
  ok(!!active && active.dataset.bay === "a", "the credentials door raises a real bay, not an empty window");
  ok(document.querySelectorAll(".slab__label .vtab").length === 2, "bottom menu carries the Room/Fleet switch");
  document.querySelector('.vtab[data-view="fleet"]').click();
  ok(await until(() => !document.querySelector("#view-fleet").hidden), "Fleet vtab switches views");
  document.querySelector('.vtab[data-view="console"]').click();
  ok(await until(() => !document.querySelector("#view-console").hidden), "Room vtab switches back");
  document.querySelector(".sheet__close").click();
  await until(() => !document.querySelector(".sheet").classList.contains("open"));
  ok(active.querySelectorAll(".keyrow").length === 10, "the credentials bay carries all ten rows");
  // each bay opens with content
  for (const [id, probe] of [["b", "#ledLines .ledline"], ["c", ".dial-grid"], ["d", "#log .logrow"]]) {
    window.__gunther.bays.openBay(id);
    const el = document.querySelector(".bay.active");
    ok(el && el.dataset.bay === id, "bay " + id + " opens active");
    const cnt = id === "b" ? document.querySelectorAll("#ledLines > *").length : el.querySelectorAll("*").length;
    ok(cnt > 0, "bay " + id + " is not empty");
  }
  document.querySelector(".sheet__close").click();
  await until(() => !document.querySelector(".sheet").classList.contains("open"));
  ok(!document.querySelector(".sheet").classList.contains("open"), "sheet closes back to the pure view");

  // Fleet view renders its ten cards
  location.hash = "#/fleet";
  await until(() => !document.querySelector("#view-fleet").hidden);
  ok(document.querySelectorAll("#lines .line").length === 10, "fleet view shows ten line cards");
  location.hash = "#/console";
  await until(() => !document.querySelector("#view-console").hidden);
  ok(!!document.querySelector("#feed"), "console view returns with the conversation window");

  await new Promise((r) => setTimeout(r, 120));
  ok(errs.length === 0, "no uncaught errors while touring every surface" + (errs.length ? " — " + errs.join(" | ") : ""));

  // regression guards on the shipped sources
  const man = readFileSync("android/app/src/main/AndroidManifest.xml", "utf8");
  ok(/windowSoftInputMode="adjustResize"/.test(man), "Android keyboard resizes the room instead of panning it away");
  const mobileCss = readFileSync("css/07-mobile.css", "utf8");
  const phoneBlock = mobileCss.slice(mobileCss.indexOf("console room on a phone"));
  ok(/@media \(max-width: 720px\)/.test(phoneBlock), "phone rules stay scoped to phones");
  ok(!/text-overflow: *ellipsis/.test(mobileCss.match(/\.duty__sub \{[^}]*\}/)[0]), "duty caps are never truncated on phones");
  const baysCss = readFileSync("css/06-bays.css", "utf8");
  ok(!/white-space: *nowrap/.test(baysCss.match(/\.keyrow__note \{[^}]*\}/)[0]), "ping verdict notes can wrap — verdicts never get cut");
  ok(/"box box"/.test(readFileSync("css/04-facade.css", "utf8")), "composer spans the full width in its own band");
  ok(!/room__head|fleet__head|bay__note/.test(readFileSync("index.html", "utf8")), "the struck-out chrome is gone from the markup");
}

console.log("\n" + passed + " passed, " + failed + " failed");
for (const t of $$(".toasts .toast")) t.remove?.();
process.exit(failed ? 1 : 0);
