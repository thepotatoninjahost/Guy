/* ============================================================
   Gunther · AUTONOMOUS TASK RUNTIME

   The durable spine of the agent. A conversation is not a build:
   builds need resumable state, ordered work, evidence, and a record
   of what was learned when a step succeeds or fails. This module is
   deliberately pure; the UI and transport are adapters around it.
   ============================================================ */

const MAX_TEXT = 12000;
const clampText = (v) => String(v || "").trim().slice(0, MAX_TEXT);
const now = () => Date.now();

function id(prefix = "t") {
  return prefix + now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function stepShape(step, i) {
  const s = typeof step === "string" ? { title: step } : step || {};
  return {
    id: s.id || id("s"),
    index: i,
    title: clampText(s.title || "Untitled step").slice(0, 180),
    instruction: clampText(s.instruction || s.prompt || s.title || ""),
    status: "queued", // queued | active | done | failed | skipped
    attempts: 0,
    evidence: [],
    error: "",
    startedAt: 0,
    finishedAt: 0,
  };
}

export function createTask(goal, steps = [], meta = {}) {
  const clean = Array.isArray(steps) ? steps.slice(0, 24).map(stepShape) : [];
  return {
    id: id(),
    goal: clampText(goal).slice(0, 500),
    status: clean.length ? "ready" : "planning", // planning | ready | active | blocked | done | abandoned
    createdAt: now(),
    updatedAt: now(),
    activeStep: null,
    steps: clean,
    learnings: [],
    sources: [],
    meta: { origin: "console", ...meta },
  };
}

export function addSteps(task, steps) {
  if (!task || !Array.isArray(steps) || task.status === "done" || task.status === "abandoned") return task;
  const start = task.steps.length;
  task.steps.push(...steps.slice(0, 24 - start).map((s, i) => stepShape(s, start + i)));
  task.status = task.steps.length ? "ready" : "planning";
  task.updatedAt = now();
  return task;
}

export function nextStep(task) {
  if (!task || !Array.isArray(task.steps)) return null;
  return task.steps.find((s) => s.status === "queued" || s.status === "failed") || null;
}

export function beginStep(task, stepId) {
  const step = task && task.steps.find((s) => s.id === stepId);
  if (!step || ["done", "skipped"].includes(step.status)) return null;
  step.status = "active";
  step.attempts += 1;
  step.startedAt = step.startedAt || now();
  step.error = "";
  task.activeStep = step.id;
  task.status = "active";
  task.updatedAt = now();
  return step;
}

export function recordEvidence(task, stepId, evidence) {
  const step = task && task.steps.find((s) => s.id === stepId);
  if (!step) return false;
  const item = typeof evidence === "string" ? { kind: "note", text: evidence } : evidence || {};
  const text = clampText(item.text || item.message || item.output);
  if (!text) return false;
  step.evidence.push({ kind: String(item.kind || "note").slice(0, 40), text, at: now() });
  step.evidence = step.evidence.slice(-12);
  task.updatedAt = now();
  return true;
}

export function completeStep(task, stepId, evidence) {
  const step = task && task.steps.find((s) => s.id === stepId);
  if (!step) return false;
  if (evidence) recordEvidence(task, stepId, evidence);
  step.status = "done";
  step.finishedAt = now();
  step.error = "";
  if (task.activeStep === step.id) task.activeStep = null;
  const remaining = nextStep(task);
  task.status = remaining ? "ready" : "done";
  task.updatedAt = now();
  return true;
}

export function failStep(task, stepId, error, evidence) {
  const step = task && task.steps.find((s) => s.id === stepId);
  if (!step) return false;
  if (evidence) recordEvidence(task, stepId, evidence);
  step.status = "failed";
  step.error = clampText(error).slice(0, 1000);
  step.finishedAt = now();
  if (task.activeStep === step.id) task.activeStep = null;
  task.status = "blocked";
  task.updatedAt = now();
  return true;
}

export function resumeTask(task) {
  if (!task || ["done", "abandoned"].includes(task.status)) return null;
  const active = task.steps.find((s) => s.status === "active" || s.status === "failed");
  if (active) active.status = "queued"; // an interrupted or failed turn is retryable, never silently lost
  task.activeStep = null;
  task.status = nextStep(task) ? "ready" : "done";
  task.updatedAt = now();
  return nextStep(task);
}

export function learn(task, lesson, source = "task") {
  if (!task) return false;
  const text = clampText(lesson);
  if (!text) return false;
  const key = text.toLowerCase();
  if (task.learnings.some((x) => x.text.toLowerCase() === key)) return false;
  task.learnings.push({ id: id("l"), text, source: clampText(source).slice(0, 120), at: now() });
  task.learnings = task.learnings.slice(-40);
  task.updatedAt = now();
  return true;
}

export function attachSource(task, source) {
  if (!task || !source) return false;
  const item = typeof source === "string" ? { title: source } : source;
  const url = clampText(item.url || "");
  const title = clampText(item.title || url || "Research source");
  if (!url && !title) return false;
  if (task.sources.some((s) => url && s.url === url)) return false;
  task.sources.push({ title: title.slice(0, 180), url: url.slice(0, 1000), excerpt: clampText(item.excerpt).slice(0, 2000), at: now() });
  task.sources = task.sources.slice(-40);
  task.updatedAt = now();
  return true;
}

export function progress(task) {
  if (!task || !task.steps.length) return { done: 0, total: 0, ratio: 0 };
  const done = task.steps.filter((s) => s.status === "done" || s.status === "skipped").length;
  return { done, total: task.steps.length, ratio: done / task.steps.length };
}

export function validateTask(task) {
  if (!task || typeof task !== "object") return false;
  if (!task.id || !task.goal || !Array.isArray(task.steps)) return false;
  return task.steps.every((s, i) => s && s.id && s.index === i && typeof s.title === "string");
}
