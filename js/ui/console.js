/* ============================================================
   GUY · GLASS HOUSE CONSOLE — js/ui/console.js
   The glass room: the feed, streaming, the workbench, and
   PLAN mode (plan → step tiles → executed increments).
   ============================================================ */

import { state, addLog, scheduleSave, setBusy } from "../state.js";
import { byId, estimateTokens, VENDORS } from "../models.js";
import { dispatch, headroom, select } from "../engine.js";
import { mdToHtml, toast, copyText, escapeHtml, fmtTok, fmtClockHM } from "./render.js";

const PLAN_SYSTEM = [
  "You are the planning engine of GUY, an autonomous coding agent.",
  "Respond with ONLY a JSON object — no prose, no markdown, no code fences:",
  '{"goal":"<six words max>","steps":[{"title":"<five words max>","prompt":"<one self-contained build instruction>"}]}',
  "Rules: 2 to 6 steps. Each step must be buildable on its own, reference exact file paths where sensible, and steps are ordered (later steps build on earlier ones).",
  "Prefer small verifiable increments: scaffold, then feature, then harden, then document.",
].join("\n");

const EXEC_SYSTEM = [
  "You are GUY executing exactly one step of an approved build plan.",
  "Deliver in this order: a one-line status, then the complete code in a single fenced block with a language tag, then at most three bullet notes.",
  "Never output placeholders, TODOs, ellipses, or truncated code. Use only the context provided from earlier steps.",
].join("\n");

let controller = null;
let planAbort = false;

const $ = (sel) => document.querySelector(sel);

/* ---------- history ---------- */

function buildHistory() {
  let msgs = state.thread
    .slice(-16)
    .filter((t) => (t.role === "user" || t.role === "assistant") && String(t.content || "").trim())
    .map((t) => ({ role: t.role, content: String(t.content).slice(0, 24000) }));
  const budget = 60000;
  let chars = state.dials.system.length;
  while (msgs.length > 2) {
    chars = state.dials.system.length + msgs.reduce((a, m) => a + m.content.length + 8, 0);
    if (chars < budget) break;
    msgs.shift();
  }
  return msgs;
}

function estFor(messages) {
  return estimateTokens(messages.map((m) => m.content).join(" ") + (state.dials.system || ""));
}

/* ---------- message shells ---------- */

function userShell(msg) {
  const el = document.createElement("article");
  el.className = "msg msg--user";
  const foot = document.createElement("div");
  foot.className = "msg__foot";
  foot.textContent = fmtClockHM(new Date(msg.at));
  const text = document.createElement("div");
  text.className = "msg__text";
  text.textContent = msg.content;
  el.appendChild(text);
  el.appendChild(foot);
  return el;
}

function agentShell(tag) {
  const el = document.createElement("article");
  el.className = "msg msg--agent";
  const head = document.createElement("header");
  head.className = "msg__head";
  head.innerHTML =
    '<span class="msg__dot"></span>' +
    '<span class="msg__line"></span>' +
    '<span class="msg__rot"></span>' +
    '<span class="msg__meta"></span>';
  const body = document.createElement("div");
  body.className = "msg__body";
  body.innerHTML = '<span class="msg__stream"></span>';
  el.appendChild(head);
  el.appendChild(body);
  const lineEl = head.querySelector(".msg__line");
  const rotEl = head.querySelector(".msg__rot");
  const metaEl = head.querySelector(".msg__meta");
  const streamEl = body.querySelector(".msg__stream");

  const setLine = (m) => {
    lineEl.textContent = "LINE " + String(m.line).padStart(2, "0") + " · " + (m ? m.name : tag || "");
  };
  const setRotate = (from, to) => {
    rotEl.textContent = "↻ handoff " + String(from.line).padStart(2, "0") + " → " + String(to.line).padStart(2, "0");
  };
  const appendDelta = (t) => {
    streamEl.innerHTML = escapeHtml(streamText(body) + t) + '<span class="caret"></span>';
    scrollFeed();
  };
  return { el, setLine, setRotate, appendDelta, metaEl, body, lineEl };
}

function streamText(bodyEl) {
  const node = bodyEl.querySelector(".msg__stream");
  return node ? node.textContent : "";
}

function finalizeAgent(shell, res) {
  shell.body.innerHTML = mdToHtml(res.text);
  shell.metaEl.textContent =
    (res.usage.estimated ? "~" : "") +
    fmtTok(res.usage.total) + " tok · " + (res.ms / 1000).toFixed(1) + "s" +
    (res.attempts > 1 ? " · " + res.attempts + " attempts" : "");
  if (res.usage.estimated) shell.metaEl.classList.add("is-est");
  scrollFeed();
}

function showError(shell, err) {
  const wrap = document.createElement("div");
  wrap.className = "errcard";
  const title =
    err.code === "NO_LINES"
      ? "FLEET AT CEILING"
      : err.code === "FLEET_DOWN"
        ? "FLEET REFUSED THE TURN"
        : err.code === "ABORT"
          ? "STOPPED BY OPERATOR"
          : "LINE FAILURE";
  wrap.innerHTML =
    '<div><div class="errcard__t">' + escapeHtml(title) + "</div>" +
    '<div class="errcard__m"></div></div>';
  wrap.querySelector(".errcard__m").textContent = err.msg || err.note || err.message || "";
  if (err.code === "NO_LINES" || err.code === "FLEET_DOWN") {
    const btn = document.createElement("button");
    btn.className = "btn btn--sm";
    btn.textContent = "RETRY";
    btn.addEventListener("click", () => {
      const lastUser = [...state.thread].reverse().find((t) => t.role === "user");
      if (lastUser) send(lastUser.content, true);
    });
    wrap.appendChild(btn);
  }
  shell.body.innerHTML = "";
  shell.body.appendChild(wrap);
  shell.metaEl.textContent = err.code;
  scrollFeed();
}

function finalizeAborted(shell) {
  const t = streamText(shell.body);
  shell.body.innerHTML = t ? mdToHtml(t) : "";
  if (!t) shell.body.innerHTML = '<p style="color:var(--ink-3)">— stopped —</p>';
  shell.metaEl.textContent = "stopped by operator";
}

/* ---------- feed ---------- */

function feed() {
  return $("#feed");
}
function emptyState() {
  return $("#empty");
}
function scrollFeed() {
  const f = feed();
  f.scrollTop = f.scrollHeight;
}
function syncEmpty() {
  const e = emptyState();
  if (e) e.hidden = state.thread.length > 0;
  feed().hidden = state.thread.length === 0;
}

function renderThread() {
  const f = feed();
  f.innerHTML = "";
  for (const t of state.thread) {
    if (t.role === "user") {
      f.appendChild(userShell(t));
    } else if (t.role === "assistant") {
      const shell = agentShell(t.tag);
      const m = byId(t.model);
      if (m) shell.setLine(m);
      shell.body.innerHTML = mdToHtml(t.content);
      if (t.usage) {
        shell.metaEl.textContent =
          (t.usage.estimated ? "~" : "") + fmtTok(t.usage.total) + " tok" + (t.step != null ? " · step " + (t.step + 1) : "");
      }
      f.appendChild(shell.el);
    }
  }
  syncEmpty();
  scrollFeed();
}

/* ---------- the turn ---------- */

async function runChat(userMsg) {
  const shell = agentShell();
  feed().appendChild(shell.el);
  scrollFeed();
  controller = new AbortController();
  setBusy(true);
  const history = buildHistory();
  try {
    const res = await dispatch({
      system: state.dials.system,
      messages: history,
      estTok: estFor(history),
      maxTokens: state.dials.maxTokens,
      temperature: state.dials.temperature,
      signal: controller.signal,
      onDelta: (t) => shell.appendDelta(t),
      onRotate: (info) => {
        shell.setRotate(info.from, info.to);
      },
    });
    shell.setLine(res.model);
    finalizeAgent(shell, res);
    state.thread.push({
      role: "assistant",
      content: res.text,
      at: Date.now(),
      model: res.model.id,
      usage: res.usage,
    });
    scheduleSave();
  } catch (err) {
    if (err.code === "ABORT") finalizeAborted(shell);
    else showError(shell, err);
    addLog("err", "SESSION", (err.code || "ERR") + " — " + (err.msg || err.note || err.message || "").slice(0, 160));
  } finally {
    setBusy(false);
    controller = null;
    syncEmpty();
  }
}

/* ---------- PLAN mode ---------- */

function parsePlan(raw) {
  let s = String(raw).trim();
  s = s.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error("no json object in plan response");
  let obj;
  try {
    obj = JSON.parse(s.slice(a, b + 1));
  } catch {
    obj = JSON.parse(s.slice(a, b + 1).replace(/,\s*([}\]])/g, "$1"));
  }
  const steps = Array.isArray(obj.steps) ? obj.steps : [];
  const clean = steps
    .slice(0, 6)
    .map((st) => ({
      title: String(st.title || st.name || "Step").slice(0, 80),
      prompt: String(st.prompt || st.task || st.instruction || "").slice(0, 4000),
    }))
    .filter((st) => st.prompt);
  if (!clean.length) throw new Error("plan had no executable steps");
  return { goal: String(obj.goal || "").slice(0, 160), steps: clean };
}

function planShell(plan) {
  const el = document.createElement("div");
  el.className = "plan";
  el.innerHTML =
    '<div class="plan__head"><b></b><span></span></div>' +
    '<ol class="plan__steps"></ol>';
  el.querySelector("b").textContent = plan.goal || "BUILD PLAN";
  el.querySelector("span").textContent = plan.steps.length + " STEPS";
  const ol = el.querySelector(".plan__steps");
  plan.steps.forEach((s, i) => {
    const li = document.createElement("li");
    li.className = "plan__step";
    li.dataset.i = i;
    li.innerHTML =
      '<span class="n">' + String(i + 1).padStart(2, "0") + "</span>" +
      '<span class="plan__st">QUEUED</span>' +
      '<span class="t"></span>' +
      '<span class="plan__line"></span>';
    li.querySelector(".t").textContent = s.title;
    ol.appendChild(li);
  });
  return el;
}

function setStep(planEl, i, st, lineText) {
  const li = planEl.querySelector('.plan__step[data-i="' + i + '"]');
  if (!li) return;
  li.className = "plan__step" + (st ? " is-" + st : "");
  const label = { run: "RUNNING", done: "DONE", fail: "FAILED", halt: "HALTED", queued: "QUEUED" }[st] || (st || "QUEUED").toUpperCase();
  li.querySelector(".plan__st").textContent = label;
  if (lineText) li.querySelector(".plan__line").textContent = lineText;
}

async function runPlan(goal) {
  const f = feed();

  // 1) plan the build
  const planShellEl = agentShell("PLANNING");
  f.appendChild(planShellEl.el);
  scrollFeed();
  controller = new AbortController();
  setBusy(true);
  planAbort = false;

  let plan = null;
  try {
    const res = await dispatch({
      system: PLAN_SYSTEM,
      messages: [{ role: "user", content: goal }],
      estTok: estimateTokens(goal + PLAN_SYSTEM),
      maxTokens: 1200,
      temperature: 0.2,
      signal: controller.signal,
    });
    planShellEl.setLine(res.model);
    planShellEl.body.innerHTML = mdToHtml(res.text);
    planShellEl.metaEl.textContent = "plan · " + fmtTok(res.usage.total) + " tok";
    try {
      plan = parsePlan(res.text);
    } catch (pe) {
      addLog("warn", "SESSION", "plan was unstructured — running as a single step (" + pe.message + ")");
      plan = { goal, steps: [{ title: "Whole plan", prompt: goal }] };
    }
  } catch (err) {
    if (err.code === "ABORT") finalizeAborted(planShellEl);
    else showError(planShellEl, err);
    setBusy(false);
    controller = null;
    return;
  }

  // 2) render the plan, then execute step by step
  const pEl = planShell(plan);
  f.appendChild(pEl);
  scrollFeed();
  addLog("info", "SESSION", "PLAN approved — " + plan.steps.length + " steps: " + plan.steps.map((s) => s.title).join(" → ").slice(0, 140));

  const outputs = [];
  for (let i = 0; i < plan.steps.length; i++) {
    if (planAbort || (controller && controller.signal.aborted)) {
      setStep(pEl, i, "halt");
      continue;
    }
    setStep(pEl, i, "run");
    scrollFeed();
    const stepShell = agentShell("STEP " + (i + 1) + "/" + plan.steps.length);
    f.appendChild(stepShell.el);
    scrollFeed();

    const prev = outputs.slice(-3).join("\n\n---\n\n").slice(0, 12000);
    const prompt = [
      "GOAL: " + (plan.goal || goal),
      "FULL PLAN:",
      plan.steps.map((s, j) => (j + 1) + ". " + s.title).join("\n"),
      "PREVIOUS STEP OUTPUTS:",
      prev || "(none — this is the first step)",
      "",
      "EXECUTE ONLY STEP " + (i + 1) + ": " + plan.steps[i].title,
      "STEP INSTRUCTION: " + plan.steps[i].prompt,
    ].join("\n");

    try {
      const res = await dispatch({
        system: EXEC_SYSTEM,
        messages: [{ role: "user", content: prompt }],
        estTok: estimateTokens(prompt + EXEC_SYSTEM),
        maxTokens: state.dials.maxTokens,
        temperature: state.dials.temperature,
        signal: controller.signal,
        onDelta: (t) => stepShell.appendDelta(t),
      });
      stepShell.setLine(res.model);
      finalizeAgent(stepShell, res);
      setStep(pEl, i, "done", "LINE " + String(res.model.line).padStart(2, "0"));
      outputs.push(res.text.slice(0, 6000));
      state.thread.push({
        role: "assistant",
        content: res.text,
        at: Date.now(),
        model: res.model.id,
        usage: res.usage,
        step: i,
        tag: "STEP " + (i + 1),
      });
      scheduleSave();
    } catch (err) {
      if (err.code === "ABORT") {
        finalizeAborted(stepShell);
        setStep(pEl, i, "halt");
        planAbort = true;
      } else {
        showError(stepShell, err);
        setStep(pEl, i, "fail");
        addLog("err", "SESSION", "step " + (i + 1) + " failed — " + (err.msg || err.note || err.code || "").slice(0, 140));
        planAbort = true;
      }
    }
  }

  const sum = document.createElement("article");
  sum.className = "msg msg--agent";
  sum.innerHTML =
    '<header class="msg__head"><span class="msg__dot"></span><span class="msg__line">BUILD SUMMARY</span><span class="msg__meta"></span></header>' +
    '<div class="msg__body"></div>';
  const done = plan.steps.filter((_, i) => {
    const li = pEl.querySelector('.plan__step[data-i="' + i + '"]');
    return li && li.classList.contains("is-done");
  }).length;
  sum.querySelector(".msg__meta").textContent = done + "/" + plan.steps.length + " steps";
  sum.querySelector(".msg__body").innerHTML =
    "<p>" +
    (done === plan.steps.length
      ? "All " + plan.steps.length + " steps delivered. The build is framed — inspect each step above, then keep pushing."
      : done + " of " + plan.steps.length + " steps delivered before the loop halted. Retry the remaining steps from the workbench.") +
    "</p>";
  f.appendChild(sum);
  scrollFeed();

  setBusy(false);
  controller = null;
  syncEmpty();
}

/* ---------- public API ---------- */

export async function send(raw, force) {
  if (state.busy && !force) return;
  const text = String(raw || "").trim();
  if (!text) return;
  const anyKey = Object.values(state.keys || {}).some((k) => (k || "").trim());
  if (!anyKey) {
    toast("Store at least one line key in BAY 01 · CREDENTIALS first", "warn");
    if (window.__guy && window.__guy.bays) window.__guy.bays.openBay("a");
    return;
  }
  syncEmpty();
  const userMsg = { role: "user", content: text, at: Date.now() };
  state.thread.push(userMsg);
  feed().appendChild(userShell(userMsg));
  scrollFeed();
  scheduleSave();

  const input = $("#input");
  if (input) {
    input.value = "";
    autosize(input);
  }

  if (state.dials.uiMode === "plan") await runPlan(text);
  else await runChat(userMsg);
}

export function stop() {
  planAbort = true;
  if (controller) controller.abort();
}

function autosize(ta) {
  ta.style.height = "auto";
  ta.style.height = Math.min(220, Math.max(52, ta.scrollHeight)) + "px";
}

export function initConsole() {
  renderThread();

  const input = $("#input");
  input.addEventListener("input", () => autosize(input));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input.value);
    }
  });

  $("#sendBtn").addEventListener("click", () => send(input.value));
  $("#stopBtn").addEventListener("click", stop);
  const stopBtn = $("#stopBtn");
  state.bus.addEventListener("busy", (e) => {
    stopBtn.hidden = !e.detail.b;
  });

  document.querySelectorAll(".bench__mode button[data-umode]").forEach((b) => {
    b.addEventListener("click", () => {
      state.dials.uiMode = b.dataset.umode;
      state.bus.dispatchEvent(new CustomEvent("dials", { detail: {} }));
      scheduleSave();
      toast("Mode: " + (b.dataset.umode === "plan" ? "PLAN — will decompose into executable steps" : "CHAT — single line serves the turn"));
    });
  });

  document.querySelectorAll(".chip-btn[data-prompt]").forEach((c) => {
    c.addEventListener("click", () => {
      input.value = c.dataset.prompt;
      autosize(input);
      input.focus();
    });
  });

  // copy buttons, delegated across the whole feed
  feed().addEventListener("click", async (e) => {
    const btn = e.target.closest(".codeblock__copy");
    if (!btn) return;
    const code = btn.closest(".codeblock").querySelector("pre code");
    const ok = await copyText(code ? code.textContent : "");
    btn.textContent = ok ? "COPIED ✓" : "FAILED";
    setTimeout(() => (btn.textContent = "COPY"), 1600);
  });

  // on-duty strip + workbench hint, once per second
  setInterval(updateDuty, 1000);
  updateDuty();
  state.bus.addEventListener("ledger", updateDuty);
  state.bus.addEventListener("dials", updateDuty);
  state.bus.addEventListener("busy", updateDuty);
}

function updateDuty() {
  const modelEl = document.querySelector("[data-duty-model]");
  const subEl = document.querySelector("[data-duty-sub]");
  const ring = document.querySelector(".ring");
  const ringC = document.querySelector(".ring__c");
  const hint = $("#nextLine");
  const modeEl = document.querySelector("[data-duty-mode]");

  const dm = select(128);
  if (modelEl) {
    if (dm) {
      modelEl.innerHTML = "<small>LINE " + String(dm.line).padStart(2, "0") + "</small>" + escapeHtml(dm.name);
      const hr = headroom(dm);
      const capBits = [];
      if (dm.caps.rpm) capBits.push(dm.caps.rpm + " RPM");
      if (dm.caps.tpm) capBits.push(fmtTok(dm.caps.tpm) + " TPM");
      if (dm.caps.rpd) capBits.push(fmtTok(dm.caps.rpd) + " RPD");
      if (dm.caps.tpd) capBits.push(fmtTok(dm.caps.tpd) + " TPD");
      const vendor = VENDORS[dm.provider] ? VENDORS[dm.provider].label : dm.provider;
      const dayTok = hr.day ? hr.day.prompt + hr.day.completion : 0;
      subEl.textContent =
        vendor + " · " + (capBits.join(" · ") || "no published cap") +
        " · " + fmtTok(dayTok) + "/" + (dm.caps.tpd ? fmtTok(dm.caps.tpd) : "∞") + " tok today";
    } else {
      modelEl.textContent = "NO LINE AVAILABLE";
      subEl.textContent = "add keys in BAY 01, or wait for a window to clear";
    }
  }
  if (modeEl) {
    modeEl.textContent =
      state.dials.mode === "pin" ? "PINNED" : state.dials.mode === "drill" ? "DRILL" : "AUTO ROTATION";
  }
  if (ring) {
    const ratio = dm ? headroom(dm).ratio : 0;
    ring.style.setProperty("--fill", (ratio * 100).toFixed(1));
    if (ringC) ringC.textContent = Math.round(ratio * 100) + "%";
  }
  const s = state.ledger.session || { tok: 0, req: 0, handoffs: 0 };
  const sess = document.querySelector("[data-duty-sess]");
  const reqEl = document.querySelector("[data-duty-req]");
  const hand = document.querySelector("[data-duty-hand]");
  if (sess) sess.textContent = fmtTok(s.tok);
  if (reqEl) reqEl.textContent = String(s.req);
  if (hand) hand.textContent = String(s.handoffs);

  if (hint) {
    if (state.busy) {
      const cur = state.engine.lastLine ? byId(state.engine.lastLine) : null;
      hint.innerHTML = state.dials.uiMode === "plan"
        ? 'MODE <b>PLAN</b> — executing step · streaming from LINE ' + (cur ? "<b>" + String(cur.line).padStart(2, "0") + "</b>" : "—")
        : "STREAMING FROM LINE " + (cur ? "<b>" + String(cur.line).padStart(2, "0") + "</b> · " + escapeHtml(cur.name) : "—");
    } else if (dm) {
      hint.innerHTML =
        "NEXT TURN RIDES LINE <b>" + String(dm.line).padStart(2, "0") + "</b> · " + escapeHtml(dm.name) +
        (state.dials.uiMode === "plan" ? " · <b>PLAN</b> MODE" : "");
    } else {
      hint.innerHTML = "FLEET DARK — <b>BAY 01</b>";
    }
  }
}


