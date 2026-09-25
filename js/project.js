/* ============================================================
   Gunther · PROJECT MODEL

   A Gunther project is a real directory on the device, reached through
   the host bridge, mirrored into the agent's workspace so the existing
   controlled tools can edit it, and flushed back after every change.

   The mirror is a *working copy*, never the truth. The truth is the
   directory: hydration may skip files it cannot hold (too many, too
   large, binary), and this module reports exactly what it skipped
   instead of pretending the agent can see everything.

   The command manifest (gunther.project.json) is an ordinary project
   file listing the commands the project is verified with. Gunther
   never invents one silently, and a command added during a task is not
   runnable until a human approves it.
   ============================================================ */

import { callHost } from "./host.js";
import { createWorkspace, listFiles, readFile, writeFile } from "./workspace.js";

export const MANIFEST_FILE = "gunther.project.json";

/** The workspace model caps a file at 2 MB and a project at 500 files. */
export const MAX_HYDRATE_BYTES = 2_000_000;
export const MAX_HYDRATE_FILES = 400;

/* ------------------------------------------------------------------
   manifests
   ------------------------------------------------------------------ */

export function parseManifest(text) {
  const raw = String(text == null ? "" : text).trim();
  if (!raw) return { ok: false, error: "the manifest is empty" };
  let data;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    return { ok: false, error: "the manifest is not valid JSON: " + error.message };
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, error: "the manifest must be a JSON object" };
  }
  const commands = [];
  const invalid = [];
  const table = data.commands && typeof data.commands === "object" && !Array.isArray(data.commands) ? data.commands : {};
  for (const [name, spec] of Object.entries(table)) {
    const argv = Array.isArray(spec) ? spec : spec && Array.isArray(spec.argv) ? spec.argv : null;
    if (!argv || !argv.length) {
      invalid.push(name);
      continue;
    }
    commands.push({
      name: String(name).slice(0, 40),
      argv: argv.map((a) => String(a)).slice(0, 32),
      label: String((spec && spec.label) || "").slice(0, 200),
    });
  }
  return {
    ok: true,
    manifest: { name: String(data.name || "").slice(0, 120), commands, invalid, version: Number(data.gunther) || 1 },
  };
}

export function renderManifest(name, commands) {
  const table = {};
  for (const c of commands || []) table[c.name] = { argv: c.argv.map(String), label: c.label || "" };
  return JSON.stringify({ gunther: 1, name: String(name || ""), commands: table }, null, 2) + "\n";
}

export function commandKey(argv) {
  return JSON.stringify((argv || []).map(String));
}

/** Commands a human has approved, keyed by name → argv hash. */
export function approvedCommands(manifest, approvals) {
  const table = approvals && typeof approvals === "object" ? approvals : {};
  return (manifest.commands || []).filter((c) => table[c.name] === commandKey(c.argv));
}

export function pendingCommands(manifest, approvals) {
  const table = approvals && typeof approvals === "object" ? approvals : {};
  return (manifest.commands || []).filter((c) => table[c.name] !== commandKey(c.argv));
}

/** The order Gunther prefers when it must choose one command to verify with. */
export const VERIFY_ORDER = ["verify", "test", "build", "lint", "check", "all"];

export function preferredCommand(commands) {
  const list = commands || [];
  for (const name of VERIFY_ORDER) {
    const hit = list.find((c) => c.name === name);
    if (hit) return hit;
  }
  return list[0] || null;
}

/* ------------------------------------------------------------------
   project registry
   ------------------------------------------------------------------ */

export async function listProjects() {
  const res = await callHost("listProjects");
  if (!res.ok) return res;
  const projects = Array.isArray(res.projects) ? res.projects : [];
  projects.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return { ok: true, projects };
}

export function createProject(name) {
  return callHost("createProject", { name: String(name || "").slice(0, 120) });
}

export function deleteProject(id) {
  return callHost("deleteProject", { id });
}

/* `extra` carries host-specific hints (the rig is told where to read or
   write because it has no storage picker; Android ignores it and uses SAF). */
export function importFolder(name, extra = {}) {
  return callHost("importFolder", { name: name || "", ...extra });
}

export function importArchive(name, extra = {}) {
  return callHost("importArchive", { name: name || "", ...extra });
}

export function exportArchive(id, name, extra = {}) {
  return callHost("exportArchive", { id, name: name || "", ...extra });
}

/* ------------------------------------------------------------------
   hydration: project directory → agent workspace
   ------------------------------------------------------------------ */

function hydrateWorkspace(project, texts) {
  const ws = createWorkspace(project && project.name ? project.name : "project");
  for (const [path, text] of texts) writeFile(ws, path, text);
  return ws;
}

/**
 * Read the project into a workspace-shaped model the agent tools can use.
 * Returns the honest accounting: what loaded, what was skipped and why.
 */
export async function hydrateProject(project, opts = {}) {
  if (!project || !project.id) return { ok: false, code: "BADREQUEST", message: "a project id is required" };
  const maxFiles = opts.maxFiles || MAX_HYDRATE_FILES;
  const listed = await callHost("listFiles", { id: project.id });
  if (!listed.ok) return listed;
  const entries = Array.isArray(listed.files) ? listed.files : [];

  const texts = [];
  const loaded = [];
  const skipped = [];
  const errors = [];

  /* Files that cannot be mirrored must not consume the mirror budget —
     otherwise a project with a few binaries would hide readable source. */
  const candidates = [];
  for (const entry of entries) {
    if (!entry || typeof entry.path !== "string") continue;
    if (entry.bytes > MAX_HYDRATE_BYTES) {
      skipped.push({ path: entry.path, reason: "larger than the 2 MB working limit" });
      continue;
    }
    candidates.push(entry);
  }

  for (const entry of candidates) {
    if (loaded.length >= maxFiles) {
      skipped.push({ path: entry.path, reason: "beyond the " + maxFiles + "-file working limit" });
      continue;
    }
    const res = await callHost("readFile", { id: project.id, path: entry.path });
    if (!res.ok) {
      errors.push({ path: entry.path, code: res.code, message: res.message });
      continue;
    }
    if (res.binary) {
      skipped.push({ path: entry.path, reason: "binary file — Gunther does not mirror it as text" });
      continue;
    }
    texts.push([entry.path, res.text]);
    loaded.push(entry.path);
  }

  const ws = hydrateWorkspace(project, texts);
  const baseline = {
    paths: new Set(loaded),
    revisions: {},
    opaque: new Set(skipped.map((s) => s.path)),
  };
  for (const path of loaded) baseline.revisions[path] = ws.files[path].revision;

  let manifest = null;
  let manifestError = "";
  const manifestPath = loaded.find((p) => p === MANIFEST_FILE);
  if (manifestPath) {
    const parsed = parseManifest(ws.files[manifestPath].text);
    if (parsed.ok) manifest = { ...parsed.manifest, path: manifestPath, text: ws.files[manifestPath].text };
    else manifestError = parsed.error;
  }

  return {
    ok: true,
    workspace: ws,
    baseline,
    loaded,
    skipped,
    errors,
    total: entries.length,
    truncated: Boolean(listed.truncated),
    manifest,
    manifestError,
    complete: skipped.length === 0 && errors.length === 0,
  };
}

/* ------------------------------------------------------------------
   flush: agent workspace → project directory
   ------------------------------------------------------------------ */

/**
 * Write every change back to the real directory. A file that was never
 * hydrated (binary, oversized, unreadable) is protected: the flush
 * refuses to overwrite it with mirrored text and says so.
 */
export async function flushWorkspace(workspace, projectId, baseline) {
  if (!workspace || !projectId) return { ok: false, code: "BADREQUEST", message: "workspace and project id are required", written: [], deleted: [], errors: [] };
  const base = baseline || { paths: new Set(), revisions: {}, opaque: new Set() };
  const paths = listFiles(workspace);
  const present = new Set(paths);
  const written = [];
  const deleted = [];
  const errors = [];
  const protectedPaths = [];

  for (const path of paths) {
    const file = workspace.files[path];
    const isNew = !base.paths.has(path);
    const changed = isNew || file.revision !== base.revisions[path];
    if (!changed) continue;
    if (base.opaque.has(path)) {
      protectedPaths.push(path);
      continue;
    }
    if (isNew) {
      /* A path the mirror has never read may still exist on the device
         (a command or another tool may have written it). Text can be
         reviewed afterwards; a binary would be destroyed by writing
         mirrored text over it, so that write is refused instead. */
      const probe = await callHost("readFile", { id: projectId, path });
      if (probe.ok && probe.binary) {
        protectedPaths.push(path);
        base.opaque.add(path);
        continue;
      }
    }
    const res = await callHost("writeFile", { id: projectId, path, text: file.text });
    if (res.ok) {
      written.push(path);
      base.paths.add(path);
      base.revisions[path] = file.revision;
    } else {
      errors.push({ path, action: "write", code: res.code, message: res.message });
    }
  }

  for (const path of Array.from(base.paths)) {
    if (present.has(path)) continue;
    const res = await callHost("deleteFile", { id: projectId, path });
    if (res.ok) {
      base.paths.delete(path);
      delete base.revisions[path];
      deleted.push(path);
    } else {
      errors.push({ path, action: "delete", code: res.code, message: res.message });
    }
  }

  return {
    ok: errors.length === 0 && protectedPaths.length === 0,
    written,
    deleted,
    protected: protectedPaths,
    errors,
    changed: written.length + deleted.length,
  };
}

/* ------------------------------------------------------------------
   reading and writing single files through the host
   ------------------------------------------------------------------ */

export async function readProjectFile(projectId, path) {
  return callHost("readFile", { id: projectId, path });
}

export async function writeProjectFile(projectId, path, text) {
  return callHost("writeFile", { id: projectId, path, text });
}

export async function deleteProjectFile(projectId, path) {
  return callHost("deleteFile", { id: projectId, path });
}

/* ------------------------------------------------------------------
   presentation helpers
   ------------------------------------------------------------------ */

/** Sorted, indented listing — no tree widget, just the truth and depth. */
export function fileTree(paths) {
  const sorted = (paths || []).slice().sort((a, b) => {
    const as = a.split("/");
    const bs = b.split("/");
    for (let i = 0; i < Math.max(as.length, bs.length); i++) {
      const x = as[i];
      const y = bs[i];
      if (x == null) return -1;
      if (y == null) return 1;
      if (x !== y) return x.localeCompare(y);
    }
    return 0;
  });
  return sorted.map((path) => {
    const parts = path.split("/");
    return { path, name: parts[parts.length - 1], dir: parts.slice(0, -1).join("/"), depth: parts.length - 1 };
  });
}

export function humanBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1048576) return (n / 1048576).toFixed(1) + " MB";
  if (n >= 1024) return (n / 1024).toFixed(1) + " KB";
  return n + " B";
}

/**
 * The delivery report is written into the project as GUNTHER-REPORT.md.
 * It is generated from records only: commands and exit codes that really
 * happened, files really written, and the limits really observed.
 */
export function buildReport(input) {
  const {
    projectName,
    projectId,
    goal,
    task,
    runs = [],
    probe = null,
    files = [],
    commands = [],
    unavailable = [],
    notes = [],
  } = input || {};
  const lines = [];
  lines.push("# Gunther delivery report");
  lines.push("");
  lines.push("- project: **" + (projectName || "(unnamed)") + "** (`" + (projectId || "?") + "`)");
  lines.push("- generated: " + new Date().toISOString());
  lines.push("- host: " + ((probe && probe.kind) || "unknown") + (probe && probe.info ? " · Android API " + probe.info.apiLevel : ""));
  lines.push("- goal: " + (goal || "(none recorded)"));
  lines.push("");
  lines.push("## Steps");
  lines.push("");
  if (task && Array.isArray(task.steps) && task.steps.length) {
    for (const step of task.steps) {
      lines.push((step.index + 1) + ". **" + step.title + "** — " + step.status + (step.error ? " (" + step.error + ")" : ""));
    }
  } else {
    lines.push("_no task was recorded for this delivery_");
  }
  lines.push("");
  lines.push("## Verification evidence");
  lines.push("");
  if (!runs.length) {
    lines.push("- **no command was run** — nothing in this delivery is verified by execution.");
  } else {
    for (const run of runs) {
      const verdict = run.code === 0 && !run.timedOut ? "PASS" : "FAIL";
      lines.push(
        "- **" + verdict + "** `" +
          (run.argv || []).join(" ") +
          "` → exit " + run.code + (run.timedOut ? " (timed out)" : "") +
          " · " + Math.round((run.durationMs || 0) / 100) / 10 + "s · " + (run.at ? new Date(run.at).toISOString() : "time unknown")
      );
      const tail = String(run.stderr || run.stdout || "").trim().split("\n").slice(-6).join("\n");
      if (tail) lines.push("  ```\n  " + tail.replace(/\n/g, "\n  ") + "\n  ```");
    }
  }
  lines.push("");
  lines.push("## Commands the project declares");
  lines.push("");
  if (commands.length) for (const c of commands) lines.push("- `" + c.name + "` → `" + (c.argv || []).join(" ") + "`" + (c.label ? " — " + c.label : ""));
  else lines.push("- none declared in " + MANIFEST_FILE);
  lines.push("");
  lines.push("## Files");
  lines.push("");
  if (files.length) {
    for (const f of files.slice(0, 200)) lines.push("- `" + f.path + "` (" + humanBytes(f.bytes) + ")");
    if (files.length > 200) lines.push("- …and " + (files.length - 200) + " more");
  } else {
    lines.push("- no files were recorded");
  }
  lines.push("");
  lines.push("## Not verified / unavailable");
  lines.push("");
  if (unavailable.length) for (const item of unavailable) lines.push("- " + item);
  else lines.push("- nothing was reported as unavailable by the host");
  lines.push("");
  if (notes.length) {
    lines.push("## Notes");
    lines.push("");
    for (const note of notes) lines.push("- " + note);
    lines.push("");
  }
  lines.push("---");
  lines.push("");
  lines.push(
    "Generated by Gunther. Verdicts above come from exit codes recorded by the host, " +
      "not from model prose: a command that did not run is reported as not run."
  );
  lines.push("");
  return lines.join("\n");
}

export { hydrateWorkspace };
