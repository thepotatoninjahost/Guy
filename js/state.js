/* ============================================================
   Gunther · GLASS HOUSE CONSOLE — js/state.js
   The foundation: keys, dials, the usage ledger, the work log,
   the thread. localStorage when a browser is present, plain
   memory otherwise (which is also how the test rig runs it).
   ============================================================ */

import { MODELS } from "./models.js";
import { createWorkspace, validateWorkspace } from "./workspace.js";

const K = {
  keys: "gunther.keys.v1",
  dials: "gunther.dials.v1",
  ledger: "gunther.ledger.v1",
  log: "gunther.log.v1",
  thread: "gunther.thread.v1",
  lines: "gunther.lines.v1",
  hold: "gunther.hold.v1",
  tasks: "gunther.tasks.v1",
  modelManifest: "gunther.models.v3",
  workspace: "gunther.workspace.v1",
  project: "gunther.project.v1",
  projectBaseline: "gunther.project-baseline.v1",
  runs: "gunther.runs.v1",
  approvals: "gunther.approvals.v1",
};

/* the GUY-era storage prefix — migrated once, then retired */
const LEGACY_K = {
  keys: "guy.keys.v1",
  dials: "guy.dials.v1",
  ledger: "guy.ledger.v1",
  log: "guy.log.v1",
  thread: "guy.thread.v1",
  lines: "guy.lines.v1",
};

const hasLS = typeof localStorage !== "undefined";

/** One-shot rename migration: carry over anything stored under the
 *  old guy.* prefix so keys and ledgers survive the christening. */
function migrateLegacy() {
  if (!hasLS) return;
  for (const [slot, legacy] of Object.entries(LEGACY_K)) {
    try {
      const fresh = localStorage.getItem(K[slot]);
      const old = localStorage.getItem(legacy);
      if (old != null && fresh == null) localStorage.setItem(K[slot], old);
      if (old != null) localStorage.removeItem(legacy);
    } catch {
      /* storage blocked — nothing to migrate */
    }
  }
}

const store = {
  get(key, fallback) {
    try {
      if (!hasLS) return fallback;
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      if (hasLS) localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage full or blocked — the app keeps running in memory */
    }
  },
};

export const DEFAULT_SYSTEM = [
  "You are Gunther — a precise autonomous coding agent operating a personal glass-house console.",
  "",
  "Conventions:",
  "- Prose is tight. Code is complete: full files or full patches, exact paths, no placeholders, no \"add the rest yourself\".",
  "- Every code sample ships in a fenced block with a language tag.",
  "- When a task is ambiguous, state your single best assumption in one line, then build.",
  "- You may be served by any of ten rotating free-tier model lines. Match your depth to the line on duty and never mention this dispatch detail unless asked.",
].join("\n");

export const DEFAULT_DIALS = {
  mode: "auto", // auto | pin | drill
  pin: null,
  temperature: 0.4,
  maxTokens: 4096,
  system: DEFAULT_SYSTEM,
  uiMode: "chat", // chat | plan
  useArchive: true, // learned notes ride along on every turn that needs them
};

export const state = {
  bus: new EventTarget(),
  keys: null,      // { [modelId]: string } — ten slots, one per line
  linePatches: null, // { [modelId]: { model?: string } } — live endpoint overrides
  dials: null,
  ledger: null,    // { [modelId]: ledgerEntry, session: {...} }
  log: [],         // newest last
  thread: [],      // { role, content, at, model?, usage? }
  engine: { lastLine: null },
  hold: [], // letters held while the whole fleet is at ceiling — run the moment a line frees
  tasks: [], // resumable autonomous work — plan, attempts, evidence, and learned corrections
  workspace: null, // the operator's project files and reversible revision history
  project: null, // { id, name } — the real project directory the workspace mirrors
  projectBaseline: null, // what the mirror was hydrated from — survives restart so a flush stays correct
  projectApprovals: {}, // { [projectId]: { [commandName]: argvHash } } — human-approved commands
  runs: [], // durable command records: the only evidence that anything ran
  busy: false,
};

export function blankLedger() {
  return {
    day: { w: "", req: 0, prompt: 0, completion: 0 },
    hour: { w: "", req: 0, prompt: 0, completion: 0 },
    feed: [], // { t: ms, tok: n } — rolling 60s window + burn rate
    trip: { n: 0, until: 0, reason: "" },
    lastAt: 0,
    latency: { ema: 0, last: 0 },
    ping: { ok: null, at: 0, note: "" },
  };
}

/** Load (or seed) every slice of persisted state. Idempotent. */
export function load() {
  migrateLegacy();
  if (!state.keys) {
    state.keys = store.get(K.keys, {});
    for (const m of MODELS) if (typeof state.keys[m.id] !== "string") state.keys[m.id] = "";
  }
  /* Line 05 was moved off Groq after its public developer tier retired
     Compound Mini. Never send the old Groq key to OpenRouter; clear only
     that slot, then restore the vendor's existing OpenRouter key below. */
  if (store.get(K.modelManifest, "") !== "coding-v3") {
    state.keys["groq-llama31-8b"] = "";
    store.set(K.modelManifest, "coding-v3");
  }
  for (const m of MODELS) {
    if ((state.keys[m.id] || "").trim()) continue;
    const sibling = MODELS.find((other) => other.provider === m.provider && (state.keys[other.id] || "").trim());
    if (sibling) state.keys[m.id] = state.keys[sibling.id];
  }
  if (!state.linePatches) state.linePatches = store.get(K.lines, {});
  if (!state.dials) {
    const d = store.get(K.dials, {});
    state.dials = { ...DEFAULT_DIALS, ...d };
  }
  if (!state.ledger) {
    const l = store.get(K.ledger, {});
    state.ledger = {};
    for (const m of MODELS) state.ledger[m.id] = { ...blankLedger(), ...(l[m.id] || {}) };
    state.ledger.session = l.session || { tok: 0, req: 0, handoffs: 0, startedAt: Date.now() };
    state.ledger.hist = Array.isArray(l.hist) ? l.hist.filter((x) => x && x.h).slice(-24) : [];
    // the rolling feed only means anything while it is young
    const cutoff = Date.now() - 130000;
    for (const m of MODELS) {
      const e = state.ledger[m.id];
      if (!Array.isArray(e.feed)) e.feed = [];
      e.feed = e.feed.filter((x) => x.t >= cutoff);
    }
  }
  state.hold = store.get(K.hold, []);
  if (!Array.isArray(state.hold)) state.hold = [];
  state.tasks = store.get(K.tasks, []);
  if (!Array.isArray(state.tasks)) state.tasks = [];
  const savedWorkspace = store.get(K.workspace, null);
  state.workspace = validateWorkspace(savedWorkspace) ? savedWorkspace : createWorkspace("Gunther project");
  state.log = store.get(K.log, []);
  if (!Array.isArray(state.log)) state.log = [];
  state.thread = store.get(K.thread, []);
  if (!Array.isArray(state.thread)) state.thread = [];
  const savedProject = store.get(K.project, null);
  state.project = savedProject && typeof savedProject === "object" && savedProject.id ? savedProject : null;
  const savedBaseline = store.get(K.projectBaseline, null);
  state.projectBaseline = savedBaseline && typeof savedBaseline === "object" && savedBaseline.projectId ? savedBaseline : null;
  const approvals = store.get(K.approvals, {});
  state.projectApprovals = approvals && typeof approvals === "object" && !Array.isArray(approvals) ? approvals : {};
  const runs = store.get(K.runs, []);
  state.runs = Array.isArray(runs) ? runs.filter((r) => r && typeof r === "object" && r.id).slice(-80) : [];
}

let saveTimer = 0;
export function saveAll() {
  store.set(K.keys, state.keys);
  store.set(K.dials, state.dials);
  store.set(K.ledger, state.ledger);
  store.set(K.log, state.log.slice(-150));
  store.set(K.thread, state.thread.slice(-40).map((t) => ({ ...t, content: String(t.content || "").slice(0, 60000) })));
  store.set(K.lines, state.linePatches);
  store.set(K.hold, state.hold.slice(-10));
  store.set(K.tasks, state.tasks.slice(-20));
  store.set(K.workspace, state.workspace);
  store.set(K.project, state.project);
  store.set(K.projectBaseline, state.projectBaseline);
  store.set(K.approvals, state.projectApprovals);
  store.set(K.runs, state.runs.slice(-80));
}
export function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveAll, 400);
}

export function emit(type, detail) {
  state.bus.dispatchEvent(new CustomEvent(type, { detail: detail || {} }));
}

export function setBusy(b) {
  if (state.busy === b) return;
  state.busy = b;
  emit("busy", { b });
}

export function addLog(sev, tag, msg) {
  const e = { t: Date.now(), sev, tag, msg: String(msg).slice(0, 300) };
  state.log.push(e);
  if (state.log.length > 300) state.log.splice(0, state.log.length - 300);
  emit("log", { e });
  scheduleSave();
}

/** How many minutes until the next UTC hour (the sliding windows' release). */
export function minutesToNextHour(now = new Date()) {
  return 60 - now.getUTCMinutes() - (now.getUTCSeconds() / 60);
}

/** How many ms until 00:00 UTC (the daily ledger's release). */
export function msToNextUtcDay(now = new Date()) {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return next - now.getTime();
}
