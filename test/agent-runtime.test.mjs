import assert from "node:assert/strict";
import {
  addSteps,
  attachSource,
  beginStep,
  completeStep,
  createTask,
  failStep,
  learn,
  nextStep,
  progress,
  recordEvidence,
  resumeTask,
  validateTask,
} from "../js/agent-runtime.js";

const task = createTask("Build a durable coding agent", [
  { title: "Map the workspace", prompt: "Inspect the project files and record constraints" },
  { title: "Implement the core", prompt: "Build the smallest complete runtime" },
]);
assert.equal(validateTask(task), true);
assert.deepEqual(progress(task), { done: 0, total: 2, ratio: 0 });

const first = nextStep(task);
assert.equal(first.title, "Map the workspace");
assert.equal(beginStep(task, first.id).status, "active");
assert.equal(recordEvidence(task, first.id, { kind: "test", text: "workspace indexed" }), true);
assert.equal(completeStep(task, first.id), true);
assert.equal(task.status, "ready");
assert.equal(progress(task).ratio, 0.5);

const second = nextStep(task);
beginStep(task, second.id);
failStep(task, second.id, "provider timed out", "the partial output was preserved");
assert.equal(task.status, "blocked");
assert.equal(resumeTask(task).id, second.id);
assert.equal(task.steps[1].status, "queued");
beginStep(task, second.id);
completeStep(task, second.id, { kind: "verification", text: "runtime tests passed" });
assert.equal(task.status, "done");
assert.deepEqual(progress(task), { done: 2, total: 2, ratio: 1 });

assert.equal(learn(task, "Retry with a smaller request after a timeout", "transport"), true);
assert.equal(learn(task, "Retry with a smaller request after a timeout", "transport"), false);
assert.equal(attachSource(task, { title: "Runtime notes", url: "https://example.test/runtime", excerpt: "source excerpt" }), true);
assert.equal(attachSource(task, { title: "same", url: "https://example.test/runtime" }), false);
addSteps(task, [{ title: "Ignored after completion" }]);
assert.equal(task.steps.length, 2);

console.log("agent runtime: 16 passed, 0 failed");
