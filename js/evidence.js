/* ============================================================
   Gunther · COMMAND EVIDENCE

   This is where Gunther either has proof or does not. A run record is
   created only by actually asking the host to execute an argv, and it
   stores what the host reported: exit code, output, duration, timeout,
   truncation, and which host answered. Nothing here reads model prose,
   and nothing here can be talked into a pass.

   A command that could not be started at all (no host, project-local
   binary, missing tool) is recorded as a run that did NOT happen, with
   the reason — never as a silent success and never as a fabricated
   failure of the project.
   ============================================================ */

import { callHost, hostKind } from "./host.js";
import { recordEvidence } from "./agent-runtime.js";

export const RUN_HISTORY = 80;
export const STORE_STREAM = 4000;
export const MODEL_STREAM = 6000;

const clamp = (text, max) => String(text == null ? "" : text).slice(0, max);
const newId = () => "r-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);

export function runVerdict(run) {
  if (!run || run.ran === false) return "NOT RUN";
  if (run.timedOut) return "TIMEOUT";
  if (run.code === 0) return "PASS";
  return "FAIL";
}

export function runPassed(run) {
  return Boolean(run && run.ran !== false && !run.timedOut && run.code === 0);
}

/**
 * Execute a declared command for real and return the record. `command` is
 * { name, argv, label } straight out of the project manifest.
 */
export async function executeCommand(options = {}) {
  const {
    projectId,
    command,
    trigger = "operator",
    task = null,
    stepId = null,
    timeoutMs = 0,
    state = null,
  } = options;

  const argv = (command && command.argv ? command.argv : []).map(String);
  const started = Date.now();
  const record = {
    id: newId(),
    projectId: projectId || "",
    taskId: task ? task.id : "",
    stepId: stepId || "",
    name: (command && command.name) || "command",
    requestedArgv: argv,
    argv,
    cwd: "",
    code: null,
    stdout: "",
    stderr: "",
    durationMs: 0,
    timedOut: false,
    truncated: false,
    ran: false,
    error: "",
    code_error: "",
    trigger,
    host: hostKind(),
    at: started,
  };

  if (!projectId) {
    record.error = "no project is open";
    record.code_error = "NO_PROJECT";
    record.durationMs = Date.now() - started;
    return finish(record, state, task, stepId);
  }
  if (!argv.length) {
    record.error = "the command has no argv";
    record.code_error = "BADREQUEST";
    record.durationMs = Date.now() - started;
    return finish(record, state, task, stepId);
  }

  const res = await callHost("runCommand", { id: projectId, argv, timeoutMs: timeoutMs || 0 });
  record.durationMs = Date.now() - started;
  if (!res.ok) {
    record.error = res.message;
    record.code_error = res.code;
    return finish(record, state, task, stepId);
  }
  record.ran = true;
  record.argv = Array.isArray(res.argv) && res.argv.length ? res.argv.map(String) : argv;
  record.cwd = res.cwd || "";
  record.code = typeof res.code === "number" ? res.code : null;
  record.stdout = clamp(res.stdout, STORE_STREAM);
  record.stderr = clamp(res.stderr, STORE_STREAM);
  record.timedOut = Boolean(res.timedOut);
  record.truncated = Boolean(res.stdoutTruncated || res.stderrTruncated);
  record.durationMs = typeof res.durationMs === "number" ? res.durationMs : record.durationMs;
  record.runner = res.runner || "";
  if (res.note) record.note = String(res.note);
  return finish(record, state, task, stepId);
}

function finish(record, state, task, stepId) {
  if (state) recordRun(state, record);
  if (task && stepId) {
    recordEvidence(task, stepId, { kind: "command", text: renderRunText(record, MODEL_STREAM) });
  }
  return { ok: record.ran && record.code === 0 && !record.timedOut, record };
}

export function recordRun(state, record) {
  if (!state || !record) return record;
  if (!Array.isArray(state.runs)) state.runs = [];
  state.runs.push(record);
  if (state.runs.length > RUN_HISTORY) state.runs = state.runs.slice(-RUN_HISTORY);
  return record;
}

export function projectRuns(state, projectId) {
  const runs = state && Array.isArray(state.runs) ? state.runs : [];
  return runs.filter((r) => !projectId || r.projectId === projectId);
}

export function taskRuns(state, taskId) {
  const runs = state && Array.isArray(state.runs) ? state.runs : [];
  return runs.filter((r) => r.taskId === taskId);
}

export function lastRun(state, projectId, name) {
  const runs = projectRuns(state, projectId).filter((r) => (name ? r.name === name : true));
  return runs.length ? runs[runs.length - 1] : null;
}

/** Verdicts for a task, derived from records only. */
export function verificationSummary(runs) {
  const list = Array.isArray(runs) ? runs : [];
  const ran = list.filter((r) => r.ran);
  const passed = ran.filter((r) => runPassed(r)).length;
  const failed = ran.filter((r) => !runPassed(r)).length;
  const notRun = list.filter((r) => !r.ran);
  const last = list.length ? list[list.length - 1] : null;
  return {
    total: list.length,
    ran: ran.length,
    passed,
    failed,
    notRun: notRun.length,
    last,
    verdict: !last ? "unverified" : runPassed(last) ? "passed" : last.ran ? "failed" : "not-run",
  };
}

/** The exact text a model or a report may read about a run. */
export function renderRunText(run, maxStream = MODEL_STREAM) {
  const lines = [];
  lines.push("COMMAND RECORD (host: " + (run.host || "unknown") + ", trigger: " + (run.trigger || "operator") + ")");
  lines.push("$ " + (run.argv || []).join(" "));
  if (run.cwd) lines.push("cwd: " + run.cwd);
  if (!run.ran) {
    lines.push("STATUS: NOT RUN — no exit code exists for this command.");
    if (run.error) lines.push("REASON: " + run.error);
    return lines.join("\n");
  }
  lines.push("exit code: " + run.code + (run.timedOut ? " (timed out after " + Math.round(run.durationMs / 1000) + "s)" : ""));
  lines.push("duration: " + Math.round((run.durationMs || 0) / 100) / 10 + "s" + (run.truncated ? " · output truncated" : ""));
  const out = clamp(run.stdout, maxStream).trim();
  const err = clamp(run.stderr, maxStream).trim();
  lines.push("stdout:");
  lines.push(out || "(empty)");
  lines.push("stderr:");
  lines.push(err || "(empty)");
  lines.push(runPassed(run) ? "VERDICT: PASS" : "VERDICT: FAIL");
  return lines.join("\n");
}

/** One line per run, for the ledger in the Project room. */
export function runLine(run) {
  const verdict = runVerdict(run);
  const argv = (run.argv || []).join(" ");
  const seconds = Math.round((run.durationMs || 0) / 100) / 10;
  if (!run.ran) return verdict + " · " + argv + " · " + (run.error || "did not run");
  return verdict + " · " + argv + " · exit " + run.code + " · " + seconds + "s";
}
