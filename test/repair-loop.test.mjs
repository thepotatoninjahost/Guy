/* ============================================================
   Gunther · the real loop

   This test does not stub the world. It builds a real project on disk,
   hydrates it through the product's own path, runs its real verification
   command with a real shell, watches it fail, repairs the project, and
   watches it pass.

   The "model" in it lies in the first attempt — it claims the check
   passes while the file is still wrong. The loop must not care: the
   verdict comes from the exit code, so the lie costs a repair attempt
   and never becomes a pass.
   ============================================================ */

import { assert, sumUp } from "./_harness.mjs";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNodeHost } from "./hosts/node-host.mjs";
import { clearHost, setHost } from "../js/host.js";
import {
  MANIFEST_FILE,
  commandKey,
  createProject,
  hydrateProject,
  renderManifest,
} from "../js/project.js";
import { executeCommand, renderRunText, taskRuns, verificationSummary } from "../js/evidence.js";
import { verifiedStep } from "../js/build-loop.js";
import { executeTool, runToolLoop } from "../js/agent-tools.js";
import { createTask, beginStep, completeStep, failStep } from "../js/agent-runtime.js";
import { readFile, writeFile } from "../js/workspace.js";

/* ---------- a real project a phone could actually run ---------- */
const root = mkdtempSync(join(tmpdir(), "gunther-loop-"));
const host = createNodeHost({ root });
setHost(host);
const { project } = await createProject("tiny answer project");
const dir = join(root, "projects", project.id);
mkdirSync(join(dir, "src"), { recursive: true });

/* posix sh + toybox tools only: nothing here needs node, npm or python */
await host.writeFile({
  id: project.id,
  path: "verify.sh",
  text: [
    "#!/bin/sh",
    "# The project's own check: the answer in src/answer.txt must be 42.",
    "value=$(cat src/answer.txt)",
    "if [ \"$value\" = \"42\" ]; then",
    "  echo \"ok: answer is $value\"",
    "  exit 0",
    "fi",
    "echo \"FAIL: expected 42 but src/answer.txt holds '$value'\" >&2",
    "exit 1",
    "",
  ].join("\n"),
});
await host.writeFile({ id: project.id, path: "src/answer.txt", text: "41\n" });
await host.writeFile({
  id: project.id,
  path: MANIFEST_FILE,
  text: renderManifest("tiny answer project", [{ name: "verify", argv: ["sh", "verify.sh"], label: "check the answer" }]),
});

/* ---------- open it the way the product opens it ---------- */
const opened = await hydrateProject(project);
assert.equal(opened.ok, true);
assert.equal(opened.complete, true);
assert.equal(opened.manifest.commands[0].argv.join(" "), "sh verify.sh");
const workspace = opened.workspace;
const baseline = opened.baseline;
const command = opened.manifest.commands[0];
const state = { runs: [] };

/* ---------- the task and step this work belongs to ---------- */
const task = createTask("make the project's check pass", [{ title: "fix the answer" }]);
const stepId = task.steps[0].id;
beginStep(task, stepId);

/* ---------- a model that fixes it on the second attempt, after lying ---------- */
let attemptSeen = 0;
const outcome = await verifiedStep({
  project,
  workspace,
  baseline,
  command,
  state,
  task,
  stepId,
  instruction: "make the project's own check pass",
  goal: "make the project's own check pass",
  maxRepairs: 2,
  runStep: async (instruction, attempt) => {
    attemptSeen += 1;
    if (attempt === 0) {
      // wrong value, and a confident claim that the project passes anyway
      writeFile(workspace, "src/answer.txt", "41\n");
      return { ok: true, text: "Updated src/answer.txt and verified the check passes.", usage: { total: 10 }, model: { id: "stub", line: 1 } };
    }
    assert.match(instruction, /COMMAND RECORD/);
    assert.match(instruction, /exit code: 1/);
    assert.match(instruction, /Do not weaken or delete the check/);
    writeFile(workspace, "src/answer.txt", "42\n");
    return { ok: true, text: "The check reported 'expected 42 but holds 41'; I set the value to 42.", usage: { total: 12 }, model: { id: "stub", line: 1 } };
  },
});

assert.equal(attemptSeen, 2);
assert.equal(outcome.status, "done");
assert.equal(outcome.repairs, 1);
assert.equal(outcome.runs.length, 2);
assert.equal(outcome.runs[0].code, 1);
assert.equal(outcome.runs[1].code, 0);
assert.equal(outcome.runs[0].ran, true);
assert.match(outcome.runs[0].stderr, /expected 42/);
assert.equal(outcome.runs[0].trigger, "auto");
assert.equal(outcome.runs[1].trigger, "repair");
assert.equal(readFileSync(join(dir, "src/answer.txt"), "utf8"), "42\n");
assert.equal(state.runs.length, 2);
assert.equal(task.steps[0].evidence.length, 2);
assert.match(task.steps[0].evidence[1].text, /VERDICT: PASS/);

/* the model's first claim was recorded as prose, never as a pass */
assert.match(outcome.attempts[0].text, /verified the check passes/);
assert.equal(outcome.runs[0].code === 0, false);

completeStep(task, stepId, { kind: "verify", text: "the project's check exited 0" });
assert.equal(task.status, "done");
const summary = verificationSummary(taskRuns(state, task.id));
assert.equal(summary.passed, 1);
assert.equal(summary.failed, 1);
assert.equal(summary.verdict, "passed");

/* ---------- a model that never fixes it: honest failure, no fake pass ---------- */
const stubbornTask = createTask("change the answer back", [{ title: "break it again" }]);
const stubbornStep = stubbornTask.steps[0].id;
beginStep(stubbornTask, stubbornStep);
await host.writeFile({ id: project.id, path: "src/answer.txt", text: "41\n" });
const reopened = await hydrateProject(project);
const stubborn = await verifiedStep({
  project,
  workspace: reopened.workspace,
  baseline: reopened.baseline,
  command,
  state,
  task: stubbornTask,
  stepId: stubbornStep,
  instruction: "make the check pass again",
  goal: "make the check pass again",
  maxRepairs: 1,
  runStep: async () => ({ ok: true, text: "It passes now, I am sure.", usage: { total: 5 }, model: { id: "stub", line: 1 } }),
});
assert.equal(stubborn.status, "failed");
assert.equal(stubborn.repairs, 1);
assert.equal(stubborn.runs.length, 2);
assert.equal(stubborn.runs.every((r) => r.code === 1), true);
assert.match(stubborn.reason, /still fails after 1 repair/);
failStep(stubbornTask, stubbornStep, stubborn.reason, { kind: "command", text: renderRunText(stubborn.runs[1]) });
assert.equal(stubbornTask.status, "blocked");
assert.equal(readFileSync(join(dir, "src/answer.txt"), "utf8"), "41\n");

/* ---------- no declared command: unverified, and it says so ---------- */
const unverified = await verifiedStep({
  project,
  workspace,
  baseline,
  command: null,
  state,
  task: null,
  stepId: null,
  instruction: "say something",
  goal: "say something",
  runStep: async () => ({ ok: true, text: "I think that is fine.", usage: { total: 3 }, model: { id: "stub", line: 1 } }),
});
assert.equal(unverified.status, "unverified");
assert.match(unverified.reason, /no verification command/);
assert.equal(unverified.runs.length, 0);

/* ---------- run_command inside the coding loop ---------- */
const toolState = { runs: [] };
const toolTask = createTask("use the declared command", [{ title: "run it" }]);
const toolStep = toolTask.steps[0].id;
const allowed = [{ name: "verify", argv: ["sh", "verify.sh"] }];
const budget = { used: 0, max: 2 };
const toolContext = {
  allowedCommands: allowed,
  budget,
  run: (cmd) =>
    executeCommand({ projectId: project.id, command: cmd, trigger: "agent", task: toolTask, stepId: toolStep, state: toolState }),
};

const refused = await executeTool(workspace, "run_command", { name: "deploy" }, toolContext);
assert.equal(refused.ok, false);
assert.match(refused.error, /not an allowed command/);
const neverApproved = await executeTool(workspace, "run_command", { name: "verify" }, { allowedCommands: [], budget: { used: 0, max: 2 }, run: toolContext.run });
assert.equal(neverApproved.ok, false);
assert.match(neverApproved.error, /no runnable command/);

let calls = 0;
const loop = await runToolLoop({
  workspace,
  maxTurns: 4,
  toolContext,
  ask: async () => {
    calls += 1;
    if (calls === 1) return { type: "tool", name: "run_command", args: { name: "verify" } };
    return { type: "final", text: "I ran the project's check." };
  },
});
assert.equal(loop.status, "complete");
assert.equal(loop.results[0].ran, true);
assert.equal(loop.results[0].exitCode, 1);
assert.match(loop.results[0].output, /COMMAND RECORD/);
assert.match(loop.results[0].output, /exit code: 1/);
assert.equal(budget.used, 1);
assert.equal(toolState.runs.length, 1);
assert.equal(toolTask.steps[0].evidence.length, 1);

const exhausted = await executeTool(workspace, "run_command", { name: "verify" }, { ...toolContext, budget: { used: 2, max: 2 } });
assert.equal(exhausted.ok, false);
assert.match(exhausted.error, /budget/);

/* ---------- the workspace mirror matches the device after the loop ---------- */
assert.equal(readFile(workspace, "src/answer.txt"), "42\n");
assert.equal(existsSync(join(dir, "verify.sh")), true);
assert.equal(readFile(reopened.workspace, "src/answer.txt"), "41\n");

clearHost();
sumUp("repair loop");
