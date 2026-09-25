/* Gunther · command evidence tests.
   A run record must come from a real process, carry the real exit code, and
   fail loudly when the environment cannot run anything at all. */

import { assert, sumUp } from "./_harness.mjs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNodeHost } from "./hosts/node-host.mjs";
import { clearHost, setHost } from "../js/host.js";
import { createProject } from "../js/project.js";
import {
  executeCommand,
  lastRun,
  projectRuns,
  renderRunText,
  runLine,
  runPassed,
  runVerdict,
  taskRuns,
  verificationSummary,
} from "../js/evidence.js";
import { beginStep, createTask } from "../js/agent-runtime.js";

const root = mkdtempSync(join(tmpdir(), "gunther-evidence-"));
const host = createNodeHost({ root });

/* ---------- 1. no host: the run is recorded as NOT RUN ---------- */
const state = { runs: [] };
const orphan = await executeCommand({
  projectId: "p-whatever",
  command: { name: "verify", argv: ["sh", "verify.sh"] },
  state,
});
assert.equal(orphan.ok, false);
assert.equal(orphan.record.ran, false);
assert.equal(orphan.record.code, null);
assert.equal(orphan.record.code_error, "NO_HOST");
assert.equal(runVerdict(orphan.record), "NOT RUN");
assert.match(renderRunText(orphan.record), /no exit code exists/);
assert.equal(state.runs.length, 1);
assert.equal(runLine(orphan.record).startsWith("NOT RUN"), true);

/* ---------- 2. real processes, real exit codes ---------- */
setHost(host);
const { project } = await createProject("evidence rig");
await host.writeFile({ id: project.id, path: "ok.sh", text: "echo fine\nexit 0\n" });
await host.writeFile({ id: project.id, path: "bad.sh", text: "echo broke >&2\nexit 3\n" });

const passed = await executeCommand({
  projectId: project.id,
  command: { name: "verify", argv: ["sh", "ok.sh"] },
  state,
  trigger: "operator",
});
assert.equal(passed.ok, true);
assert.equal(passed.record.ran, true);
assert.equal(passed.record.code, 0);
assert.equal(passed.record.stdout.trim(), "fine");
assert.equal(runPassed(passed.record), true);
assert.equal(runVerdict(passed.record), "PASS");
assert.equal(passed.record.host, "rig");
assert.equal(passed.record.trigger, "operator");
assert.equal(passed.record.argv[0].endsWith("/sh") || passed.record.argv[0] === "sh", true);

const failed = await executeCommand({
  projectId: project.id,
  command: { name: "verify", argv: ["sh", "bad.sh"] },
  state,
});
assert.equal(failed.ok, false);
assert.equal(failed.record.code, 3);
assert.equal(failed.record.stderr.trim(), "broke");
assert.equal(runVerdict(failed.record), "FAIL");
assert.match(renderRunText(failed.record), /VERDICT: FAIL/);

/* ---------- 3. a timeout is a timeout, not a failure of the project ---------- */
const slow = await executeCommand({
  projectId: project.id,
  command: { name: "verify", argv: ["sh", "-c", "sleep 30"] },
  state,
  timeoutMs: 400,
});
assert.equal(slow.ok, false);
assert.equal(slow.record.timedOut, true);
assert.equal(runVerdict(slow.record), "TIMEOUT");
assert.equal(slow.record.code, -1);
assert.match(String(slow.record.note || ""), /killed after/);

/* ---------- 4. an unrunnable command is reported, never faked ---------- */
const missing = await executeCommand({
  projectId: project.id,
  command: { name: "verify", argv: ["gunther-tool-that-does-not-exist"] },
  state,
});
assert.equal(missing.record.ran, false);
assert.equal(missing.record.code_error, "BINARY_NOT_ALLOWED");
assert.equal(runPassed(missing.record), false);
assert.match(renderRunText(missing.record), /NOT RUN/);

/* ---------- 5. evidence lands on the durable task step ---------- */
const task = createTask("prove it runs", [{ title: "verify the project" }]);
const stepId = task.steps[0].id;
beginStep(task, stepId);
const attached = await executeCommand({
  projectId: project.id,
  command: { name: "verify", argv: ["sh", "ok.sh"] },
  state,
  task,
  stepId,
  trigger: "auto",
});
assert.equal(attached.ok, true);
assert.equal(task.steps[0].evidence.length, 1);
assert.equal(task.steps[0].evidence[0].kind, "command");
assert.match(task.steps[0].evidence[0].text, /exit code: 0/);
await executeCommand({
  projectId: project.id,
  command: { name: "verify", argv: ["sh", "bad.sh"] },
  state,
  task,
  stepId,
  trigger: "auto",
});
assert.equal(task.steps[0].evidence.length, 2);
assert.match(task.steps[0].evidence[1].text, /exit code: 3/);

/* ---------- 6. verdicts are derived from records only ---------- */
const runs = taskRuns(state, task.id);
assert.equal(runs.length, 2);
const summary = verificationSummary(runs);
assert.equal(summary.ran, 2);
assert.equal(summary.passed, 1);
assert.equal(summary.failed, 1);
assert.equal(summary.verdict, "failed");
assert.equal(verificationSummary([orphan.record]).verdict, "not-run");
assert.equal(verificationSummary([]).verdict, "unverified");
assert.equal(lastRun(state, project.id, "verify").code, 3);

/* ---------- 7. the ledger keeps one project's runs separate ---------- */
const other = await createProject("other project");
assert.equal(projectRuns(state, other.project.id).length, 0);
assert.equal(projectRuns(state, project.id).length >= 4, true);

clearHost();
sumUp("evidence");
