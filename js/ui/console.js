/* ============================================================
   Gunther · GLASS HOUSE CONSOLE — js/ui/console.js
   The glass room: the feed, streaming, the workbench, and
   PLAN mode (plan → step tiles → executed increments).
   ============================================================ */

import { state, addLog, scheduleSave, setBusy } from "../state.js";
import { MODELS, byId, estimateTokens, VENDORS } from "../models.js";
import { dispatch, headroom, select } from "../engine.js";
import { getTurnContext } from "./archive.js";
import { mdToHtml, toast, copyText, escapeHtml, fmtTok, fmtClockHM } from "./render.js";
import { createTask, beginStep, completeStep, failStep, recordEvidence } from "../agent-runtime.js";
import { runCodingStep } from "../agent-runner.js";
import { verifiedStep } from "../build-loop.js";
import { renderRunText, runLine, taskRuns, verificationSummary } from "../evidence.js";
import { activeProject, agentCommandContext, deliverProject, projectBaseline, verificationCommand } from "./project.js";

const PLAN_SYSTEM = [
  "You are the planning engine of Gunther, an autonomous coding agent.",
  "Respond with ONLY a JSON object — no prose, no markdown, no code fences:",
  '{"goal":"<six words max>","steps":[{"title":"<five words max>","prompt":"<one self-contained build instruction>"}]}',
  "Rules: 2 to 6 steps. Each step must be buildable on its own, reference exact file paths where sensible, and steps are ordered (later steps build on earlier ones).",
  "Prefer small verifiable increments: scaffold, then feature, then harden, then document.",
].join("\n");

const EXEC_SYSTEM = [
  "You are Gunther executing exactly one step of an approved build plan.",
  "Deliver in this order: a one-line status, then the complete code in a single fenced block with a language tag, then at most three bullet notes.",
  "Never output placeholders, TODOs, ellipses, or truncated code. Use only the context provided from earlier steps.",
].join("\n");

let controller = null;
let planAbort = false;
let lastTurnText = ""; // whatever the operator last asked — holdable if the fleet can't answer

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

/** A command record rendered where the build happened — never a summary of one. */
function commandShell(record) {
  const el = document.createElement("article");
  el.className = "msg msg--agent runcard";
  const verdict = !record.ran ? "NOT RUN" : record.timedOut ? "TIMEOUT" : record.code === 0 ? "PASS" : "FAIL";
  const meta = record.ran
    ? "exit " + record.code + " · " + Math.round((record.durationMs || 0) / 100) / 10 + "s" + (record.truncated ? " · truncated" : "")
    : "did not run";
  el.innerHTML =
    '<header class="msg__head"><span class="msg__dot"></span><span class="msg__line"></span>' +
    '<span class="msg__rot"></span><span class="msg__meta"></span></header>' +
    '<div class="msg__body"><pre class="runcard__out"></pre></div>';
  el.querySelector(".msg__line").textContent = "COMMAND · " + (record.name || "run") + " · " + verdict;
  el.querySelector(".msg__meta").textContent = meta;
  el.querySelector(".runcard__out").textContent = renderRunText(record, 4000);
  return el;
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
    const holdBtn = document.createElement("button");
    holdBtn.className = "btn btn--sm";
    holdBtn.textContent = "HOLD FOR A LINE";
    holdBtn.title = "the console keeps this turn and runs it itself the moment any line frees";
    holdBtn.addEventListener("click", () => holdLetter());
    wrap.appendChild(holdBtn);
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

/* ---------- turnbar: the app is never silent about being alive ---------- */
let turnbarEl = null;
let turnbarFade = null;
const pad2 = (n) => String(n).padStart(2, "0");
function ensureTurnbar() {
  if (turnbarEl && turnbarEl.isConnected) return turnbarEl;
  turnbarEl = document.createElement("div");
  turnbarEl.className = "turnbar";
  turnbarEl.id = "turnbar";
  turnbarEl.innerHTML = '<span class="turnbar__dot"></span><b class="turnbar__t"></b>';
  const f = feed();
  (f && f.parentElement ? f.parentElement : document.body).insertBefore(turnbarEl, f || null);
  return turnbarEl;
}
function renderTurnbar(info) {
  const el = ensureTurnbar();
  if (turnbarFade) {
    clearTimeout(turnbarFade);
    turnbarFade = null;
  }
  const L = (m) => "LINE " + pad2(m.line) + " · " + String(m.name || "").toUpperCase();
  let txt = "";
  let st = "work";
  if (info.phase === "routing") txt = "◇ selecting lines…";
  else if (info.phase === "contact") txt = "◈ contacting " + L(info.model) + " — try " + info.attempt + "/" + info.max;
  else if (info.phase === "retry") txt = "↻ rotating to " + L(info.model) + " — try " + info.attempt + "/" + info.max;
  else if (info.phase === "streaming") txt = "▸ " + L(info.model) + " answering";
  else if (info.phase === "failed") {
    txt = "✕ " + L(info.model) + " — " + (info.note || "failed");
    st = "failed";
  } else if (info.phase === "answered") {
    txt = "✓ answered via " + L(info.model) + " · " + ((info.ms || 0) / 1000).toFixed(1) + "s" + (info.attempts > 1 ? " · " + info.attempts + " tries" : "");
    st = "answered";
  } else if (info.phase === "halt") {
    txt = "⛔ turn halted — " + (info.note || "see the red card above");
    st = "halt";
  }
  el.dataset.state = st;
  el.querySelector(".turnbar__t").textContent = txt;
  el.hidden = false;
  if (st === "answered") {
    turnbarFade = setTimeout(() => {
      el.hidden = true;
    }, 3200);
  }
  scrollFeed();
}
function scrollFeed() {
  const f = feed();
  f.scrollTop = f.scrollHeight;
}
function syncEmpty() {
  /* the hero state was removed entirely (owner directive 2026-09-19):
     the conversation window is always visible, always scrollable. */
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
  renderTurnbar({ phase: "routing" });
  const history = buildHistory();
  // the archive gets first look at the question — learned notes that bear
  // on it ride in the system prompt; irrelevant ones stay filed
  const arch = await getTurnContext(userMsg.content);
  try {
    const res = await dispatch({
      system: state.dials.system + arch.text,
      messages: history,
      estTok: estFor(history),
      maxTokens: state.dials.maxTokens,
      temperature: state.dials.temperature,
      signal: controller.signal,
      onDelta: (t) => shell.appendDelta(t),
      onRotate: (info) => {
        shell.setRotate(info.from, info.to);
        // the building taps you on the wrist when a line hands off mid-turn
        try {
          if (navigator.vibrate) navigator.vibrate([14, 60, 14]);
        } catch {
          /* no haptics, no problem */
        }
      },
      onStatus: renderTurnbar,
    });
    shell.setLine(res.model);
    finalizeAgent(shell, res);
    if (arch.used.length) {
      shell.metaEl.textContent += " · archive: " + arch.used.length + (arch.used.length === 1 ? " learned note recalled" : " learned notes recalled");
    }
    try {
      if (navigator.vibrate) navigator.vibrate(12);
    } catch {
      /* no haptics, no problem */
    }
    state.thread.push({
      role: "assistant",
      content: res.text,
      at: Date.now(),
      model: res.model.id,
      usage: res.usage,
    });
    scheduleSave();
  } catch (err) {
    if (err.code === "ABORT") {
      finalizeAborted(shell);
      renderTurnbar({ phase: "halt", note: "stopped by operator" });
    } else {
      showError(shell, err);
      renderTurnbar({ phase: "halt", note: (err.msg || err.note || err.code || "").slice(0, 160) });
    }
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
  renderTurnbar({ phase: "routing" });
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

  const task = createTask(goal, plan.steps.map((s) => ({ title: s.title, instruction: s.prompt })), { origin: "plan" });
  state.tasks.push(task);
  state.tasks = state.tasks.slice(-20);
  scheduleSave();
  const outputs = [];
  for (let i = 0; i < plan.steps.length; i++) {
    if (planAbort || (controller && controller.signal.aborted)) {
      setStep(pEl, i, "halt");
      continue;
    }
    setStep(pEl, i, "run");
    beginStep(task, task.steps[i].id);
    scheduleSave();
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

    const stepId = task.steps[i].id;
    const project = activeProject();
    const verifyCommand = project ? verificationCommand() : null;

    /* one model turn through the controlled tools — repeated for repairs */
    const runOneStep = async (instructionNow, attempt) => {
      const shell = attempt === 0 ? stepShell : agentShell("REPAIR " + attempt);
      if (attempt > 0) {
        f.appendChild(shell.el);
        scrollFeed();
      }
      const result = await runCodingStep({
        workspace: state.workspace,
        goal: plan.goal || goal,
        instruction: instructionNow,
        maxTurns: attempt === 0 ? 6 : 8,
        toolContext: agentCommandContext({ task, stepId, maxRuns: 3 }),
        dispatch: (opts) => dispatch({ ...opts, signal: controller.signal, estTok: estimateTokens((opts.messages || []).map((m) => m.content).join(" ") + (opts.system || "")), onStatus: renderTurnbar }),
        onDelta: (t) => shell.appendDelta(t),
        onTool: (call, toolResult) => {
          renderTurnbar({ phase: toolResult.ok ? "tool" : "repair" });
          addLog(toolResult.ok ? "info" : "warn", "TOOL", call.name + " → " + (toolResult.ok ? "ok" : toolResult.error));
        },
      });
      if (result.status === "limit") throw new Error("coding tool loop reached its safety limit without a final answer");
      const res = {
        text: result.text,
        model: result.model || { id: "tool-loop", line: 0, name: "TOOL LOOP" },
        usage: result.usage || { prompt: 0, completion: 0, total: 0 },
        ms: 0,
        attempts: result.turns,
      };
      shell.setLine(res.model);
      finalizeAgent(shell, res);
      return { ok: true, text: res.text, model: res.model, usage: res.usage, turns: result.turns };
    };

    /* the step ends when the project's own command says so, or honestly not */
    let outcome;
    if (verifyCommand) {
      setStep(pEl, i, "verify");
      outcome = await verifiedStep({
        project,
        workspace: state.workspace,
        baseline: projectBaseline(),
        command: verifyCommand,
        state,
        task,
        stepId,
        instruction: prompt,
        goal: plan.goal || goal,
        runStep: runOneStep,
        onPhase: (info) => renderTurnbar({ phase: info.phase }),
        onFlush: (flush) => {
          if (flush.written.length || flush.deleted.length) {
            addLog("info", "PROJECT", flush.written.length + " written · " + flush.deleted.length + " deleted in the real project");
          }
        },
        onRun: (record) => {
          f.appendChild(commandShell(record));
          scrollFeed();
          addLog(record.code === 0 ? "ok" : "warn", "PROJECT", runLine(record));
        },
      });
    } else {
      try {
        const only = await runOneStep(prompt, 0);
        outcome = {
          status: project ? "unverified" : "done",
          attempts: [only],
          runs: [],
          repairs: 0,
          text: only.text,
          reason: project
            ? "no approved verification command is declared for this project"
            : "no real project is open — this ran against the in-app workspace only",
        };
      } catch (err) {
        outcome = { status: "halted", code: err.code, error: err.msg || err.note || err.message || String(err), attempts: [], runs: [], repairs: 0 };
      }
    }

    const lastAttempt = outcome.attempts.length ? outcome.attempts[outcome.attempts.length - 1] : null;
    if (lastAttempt && lastAttempt.text) {
      outputs.push(String(lastAttempt.text).slice(0, 6000));
      state.thread.push({
        role: "assistant",
        content: lastAttempt.text,
        at: Date.now(),
        model: lastAttempt.model ? lastAttempt.model.id : undefined,
        usage: lastAttempt.usage,
        step: i,
        tag: "STEP " + (i + 1),
      });
      scheduleSave();
    }

    if (outcome.status === "done") {
      const run = outcome.runs.length ? outcome.runs[outcome.runs.length - 1] : null;
      setStep(pEl, i, "done", run ? "VERIFIED · exit " + run.code : lastAttempt && lastAttempt.model && lastAttempt.model.line ? "LINE " + String(lastAttempt.model.line).padStart(2, "0") : "TOOLS");
      completeStep(task, stepId, { kind: "verify", text: run ? "verified by execution: " + runLine(run) : "step completed" });
      scheduleSave();
    } else if (outcome.status === "unverified") {
      setStep(pEl, i, "done", "UNVERIFIED");
      completeStep(task, stepId, { kind: "note", text: "completed without execution evidence — " + outcome.reason });
      scheduleSave();
    } else if (outcome.status === "halted") {
      if (outcome.code === "ABORT") {
        if (lastAttempt) finalizeAborted(stepShell);
        setStep(pEl, i, "halt");
        failStep(task, stepId, "stopped by operator", { kind: "note", text: "partial output preserved" });
      } else {
        if (lastAttempt) showError(stepShell, { code: outcome.code || "ERROR", msg: outcome.error });
        setStep(pEl, i, "fail");
        failStep(task, stepId, outcome.error || "step failed");
      }
      scheduleSave();
      planAbort = true;
    } else {
      const run = outcome.runs.length ? outcome.runs[outcome.runs.length - 1] : null;
      setStep(pEl, i, "fail", run ? "FAILED · exit " + run.code : "FAILED");
      failStep(task, stepId, outcome.reason || "the step did not verify", run ? { kind: "command", text: renderRunText(run) } : "");
      addLog("err", "SESSION", "step " + (i + 1) + " did not verify — " + String(outcome.reason || "").slice(0, 140));
      scheduleSave();
      planAbort = true;
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

  /* the verdict is assembled from command records, never from prose */
  const taskCommandRuns = taskRuns(state, task.id);
  const summary = verificationSummary(taskCommandRuns);
  let delivered = null;
  if (activeProject()) {
    try {
      delivered = await deliverProject(plan.goal || goal, task);
    } catch (error) {
      addLog("warn", "PROJECT", "the delivery report could not be written: " + (error && error.message ? error.message : error));
    }
  }
  const verifiedText = !taskCommandRuns.length
    ? "No command was executed for this build, so nothing here is verified by execution."
    : summary.failed
      ? summary.failed + " of " + summary.ran + " executed command(s) failed — the project does not pass yet."
      : "All " + summary.ran + " executed command(s) passed (exit 0).";
  sum.querySelector(".msg__meta").textContent =
    done + "/" + plan.steps.length + " steps · " + summary.passed + " passed · " + summary.failed + " failed · " + summary.notRun + " not run";
  sum.querySelector(".msg__body").innerHTML =
    "<p>" +
    (done === plan.steps.length
      ? "All " + plan.steps.length + " steps delivered."
      : done + " of " + plan.steps.length + " steps delivered before the loop halted. Retry the remaining steps from the workbench.") +
    "</p><p>" + escapeHtml(verifiedText) +
    (delivered ? " The delivery report was written to GUNTHER-REPORT.md in the project, with every command and exit code in it." : "") +
    "</p>";
  f.appendChild(sum);
  scrollFeed();

  setBusy(false);
  controller = null;
  syncEmpty();
}

/* ---------- airgap: the fleet can be full, your words never get lost ---------- */
function holdLetter() {
  const text = String(lastTurnText || "").trim();
  if (!text) return;
  if (state.hold.some((j) => j.text === text)) {
    toast("That letter is already held", "warn");
    return;
  }
  state.hold.push({ at: Date.now(), text });
  while (state.hold.length > 10) state.hold.shift();
  scheduleSave();
  addLog("info", "SESSION", "letter held — the console will run it the moment a line frees");
  toast("HELD — queued; the fleet runs it the second a line opens", "ok");
  renderHold();
}

function renderHold() {
  const bar = document.querySelector("[data-holdbar]");
  if (!bar) return;
  bar.innerHTML = "";
  bar.hidden = !state.hold.length;
  if (!state.hold.length) return;
  const head = document.createElement("span");
  head.className = "holdbar__n";
  head.textContent = state.hold.length + (state.hold.length === 1 ? " letter held" : " letters held");
  const note = document.createElement("span");
  note.className = "holdbar__note";
  note.textContent = "runs itself the moment a line frees — or run one now";
  bar.append(head, note);
  state.hold.forEach((j, i) => {
    const chip = document.createElement("span");
    chip.className = "holditem";
    const t = document.createElement("b");
    t.textContent = j.text; // the WHOLE first line of it — held text is never clipped
    const time = document.createElement("i");
    time.textContent = fmtClockHM(new Date(j.at));
    const run = document.createElement("button");
    run.type = "button";
    run.textContent = "RUN NOW";
    run.addEventListener("click", () => {
      state.hold.splice(i, 1);
      scheduleSave();
      renderHold();
      send(j.text, true);
    });
    const drop = document.createElement("button");
    drop.type = "button";
    drop.className = "holditem__x";
    drop.textContent = "✕";
    drop.title = "discard this held letter";
    drop.addEventListener("click", () => {
      state.hold.splice(i, 1);
      scheduleSave();
      renderHold();
    });
    chip.append(t, time, run, drop);
    bar.appendChild(chip);
  });
}

/* ---------- public API ---------- */

export async function send(raw, force) {
  if (state.busy && !force) return;
  const text = String(raw || "").trim();
  if (!text) return;
  const anyKey = MODELS.some((m) => (state.keys[m.id] || "").trim());
  if (!anyKey) {
    toast("Store at least one line key in BAY 01 · CREDENTIALS first", "warn");
    if (window.__gunther && window.__gunther.bays) window.__gunther.bays.openBay("a");
    return;
  }
  lastTurnText = text;
  const userMsg = { role: "user", content: text, at: Date.now() };
  state.thread.push(userMsg);
  feed().appendChild(userShell(userMsg));
  /* the bubble the user just sent must be on screen NOW — not after the
     turn completes. push first, then sync: the hero yields instantly. */
  syncEmpty();
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
  document.querySelectorAll("[data-open-credentials]").forEach((btn) => {
    btn.addEventListener("click", () => window.__gunther?.bays?.openBay("a"));
  });
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

  // held letters ride the rotation on their own — no operator needed:
  // every few seconds, if a line is free and something is queued, run it
  setInterval(() => {
    if (state.busy || !state.hold || !state.hold.length) return;
    const free = select(128);
    if (!free) return;
    const j = state.hold.shift();
    scheduleSave();
    renderHold();
    addLog("info", "SESSION", "held letter released onto LINE " + String(free.line).padStart(2, "0"));
    toast("A line is free — running the held letter", "ok");
    send(j.text, true);
  }, 3000);
  renderHold();
}

function updateDuty() {
  const modelEl = document.querySelector("[data-duty-model]");
  const subEl = document.querySelector("[data-duty-sub]");
  const credentialsBtn = document.querySelector("[data-open-credentials]");
  const welcome = document.querySelector("[data-welcome]");
  const ring = document.querySelector(".ring");
  const ringC = document.querySelector(".ring__c");

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
    if (credentialsBtn) credentialsBtn.hidden = Boolean(dm);
    const feedEl = document.querySelector("#feed");
    if (welcome) welcome.hidden = Boolean(dm) || Boolean(feedEl && feedEl.children.length);
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


}


