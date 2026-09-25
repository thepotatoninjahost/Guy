/* ============================================================
   Gunther · THE PROJECT ROOM

   Import, browse, edit, run, and deliver a real project. Every panel
   here is wired to the host contract in js/host.js; nothing is cached
   as truth except the mirror, and the mirror announces what it could
   not hold.

   Three rules are visible in the UI on purpose:
     · an unavailable host is stated in words, never faked;
     · a command that has not been approved cannot be run by anyone,
       including the agent;
     · the ledger shows exit codes reported by the host, not prose.
   ============================================================ */

import { addLog, scheduleSave, state } from "../state.js";
import { hostKind, hostLabel, commandAvailability, callHost, probeHost } from "../host.js";
import {
  MANIFEST_FILE,
  buildReport,
  commandKey,
  createProject,
  deleteProject,
  exportArchive,
  fileTree,
  flushWorkspace,
  humanBytes,
  hydrateProject,
  importArchive,
  importFolder,
  listProjects,
  preferredCommand,
  readProjectFile,
  writeProjectFile,
} from "../project.js";
import { writeFile } from "../workspace.js";
import { executeCommand, projectRuns, runLine, runVerdict } from "../evidence.js";
import { escapeHtml, toast } from "./render.js";

let baseline = null; // mirror bookkeeping for flush — persisted as plain arrays
let manifest = null;
let probe = null;
let files = [];
let hydration = null; // what the last hydration could and could not mirror
let current = { path: "", text: "", binary: false };
let currentCommand = "";
let busy = false;

const $ = (sel) => document.querySelector(sel);

/* ------------------------------------------------------------------
   mirror bookkeeping — Sets are rebuilt from the persisted arrays
   ------------------------------------------------------------------ */

function toPersistable(base) {
  if (!base) return null;
  return {
    projectId: state.project ? state.project.id : "",
    paths: Array.from(base.paths || []),
    revisions: { ...(base.revisions || {}) },
    opaque: Array.from(base.opaque || []),
  };
}

function fromPersistable(saved, projectId) {
  if (!saved || saved.projectId !== projectId) {
    return { paths: new Set(), revisions: {}, opaque: new Set() };
  }
  return {
    paths: new Set(saved.paths || []),
    revisions: { ...(saved.revisions || {}) },
    opaque: new Set(saved.opaque || []),
  };
}

function setBaseline(base) {
  baseline = base;
  state.projectBaseline = toPersistable(base);
  scheduleSave();
}

/* ------------------------------------------------------------------
   what other modules may ask for
   ------------------------------------------------------------------ */

export function activeProject() {
  return state.project || null;
}

export function activeManifest() {
  return manifest;
}

export function projectBaseline() {
  return baseline || fromPersistable(state.projectBaseline, state.project ? state.project.id : "");
}

export function approvalsFor(projectId) {
  const all = state.projectApprovals || {};
  return all[projectId] || {};
}

export function approvedCommandList() {
  if (!state.project || !manifest) return [];
  const approvals = approvalsFor(state.project.id);
  return manifest.commands.filter((c) => approvals[c.name] === commandKey(c.argv));
}

export function verificationCommand() {
  return preferredCommand(approvedCommandList());
}

export function approveCommand(name) {
  if (!state.project || !manifest) return false;
  const command = manifest.commands.find((c) => c.name === name);
  if (!command) return false;
  state.projectApprovals[state.project.id] = {
    ...approvalsFor(state.project.id),
    [name]: commandKey(command.argv),
  };
  scheduleSave();
  addLog("ok", "PROJECT", "approved command '" + name + "' → " + command.argv.join(" "));
  return true;
}

export function revokeCommand(name) {
  if (!state.project) return false;
  const table = { ...approvalsFor(state.project.id) };
  delete table[name];
  state.projectApprovals[state.project.id] = table;
  scheduleSave();
  return true;
}

/** The tool context the coding loop hands to run_command. */
export function agentCommandContext({ task = null, stepId = null, maxRuns = 3 } = {}) {
  const commands = approvedCommandList();
  const budget = { used: 0, max: maxRuns };
  return {
    allowedCommands: commands,
    budget,
    run: async (command) => {
      const res = await executeCommand({
        projectId: state.project ? state.project.id : "",
        command,
        trigger: "agent",
        task,
        stepId,
        state,
      });
      renderRuns();
      renderOutput(res.record);
      return { ok: res.ok, record: res.record };
    },
  };
}

/** Write the mirror into the real directory. Used by the loop and by the UI. */
export async function flushActiveProject() {
  if (!state.project || !state.workspace) return { ok: true, written: [], deleted: [], protected: [], errors: [], changed: 0 };
  const res = await flushWorkspace(state.workspace, state.project.id, baseline);
  if (res.written.length || res.deleted.length) {
    addLog("info", "PROJECT", "flushed " + res.written.length + " written · " + res.deleted.length + " deleted to the device");
  }
  for (const path of res.protected) addLog("warn", "PROJECT", "refused to overwrite " + path + " — it was never mirrored as text");
  for (const err of res.errors) addLog("err", "PROJECT", "flush failed on " + err.path + ": " + err.message);
  const base = baseline || projectBaseline();
  setBaseline(base);
  return res;
}

/* ------------------------------------------------------------------
   opening a project
   ------------------------------------------------------------------ */

export async function openProject(project) {
  const res = await hydrateProject(project);
  if (!res.ok) {
    toast(res.message || "this project could not be opened");
    addLog("err", "PROJECT", "open failed: " + (res.message || res.code));
    return res;
  }
  state.project = { id: project.id, name: project.name || project.id };
  state.workspace = res.workspace;
  setBaseline(res.baseline);
  manifest = res.manifest;
  hydration = res;
  const listed = await callHost("listFiles", { id: project.id });
  files = listed.ok && Array.isArray(listed.files) ? listed.files : [];
  current = { path: "", text: "", binary: false };
  currentCommand = manifest && manifest.commands.length ? manifest.commands[0].name : "";
  scheduleSave();
  addLog(
    "ok",
    "PROJECT",
    "opened '" + state.project.name + "' — " + res.loaded.length + " of " + res.total + " files mirrored" + (res.complete ? "" : " (see the skip notice for what is not visible to the agent)")
  );
  renderProjectRoom();
  return res;
}

export async function resumeProject() {
  if (!state.project || hostKind() === "none") return null;
  const known = state.project;
  // Anything the mirror still owes the device is written first, so a resumed
  // session never silently discards the previous one's work.
  const owed = fromPersistable(state.projectBaseline, known.id);
  if (owed.paths.size || Object.keys(owed.revisions).length) {
    baseline = owed;
    await flushActiveProject();
  }
  const res = await openProject(known);
  if (!res.ok) {
    state.project = null;
    state.projectBaseline = null;
    scheduleSave();
  }
  return res;
}

/* ------------------------------------------------------------------
   rendering
   ------------------------------------------------------------------ */

export async function initProject() {
  wire();
  await refreshProbe();
  renderProjectRoom();
  if (state.project) {
    // resume in the background: the room is usable while the device catches up
    resumeProject().then(() => renderProjectRoom());
  }
}

async function refreshProbe() {
  probe = await probeHost();
  return probe;
}

/** Re-ask the shell what it can reach, then repaint. Used at boot and whenever
    the app comes back to the foreground — a person returning from the system
    picker should not be looking at a stale toolchain. */
export async function refreshHost() {
  await refreshProbe();
  renderProjectRoom();
  return probe;
}

function badge(text, cls) {
  const el = $("#projHostBadge");
  if (!el) return;
  el.textContent = text;
  el.className = "proj__badge" + (cls ? " " + cls : "");
}

function renderHost() {
  const el = $("#projTools");
  if (!el) return;
  el.innerHTML = "";
  if (!probe || probe.kind === "none") {
    badge("NO HOST", "is-off");
    $("#projHostText").textContent =
      "This environment cannot reach real files: Gunther is open in a browser tab, not the Android app. " +
      "The plan and chat tools still work on the in-app workspace, but no command can be executed and no project can be imported or exported here.";
    return;
  }
  badge(probe.kind === "android" ? "ANDROID HOST" : "RIG HOST", probe.kind === "android" ? "" : "is-warn");
  const info = probe.info || {};
  $("#projHostText").textContent =
    (probe.kind === "android"
      ? "Android " + (info.release || "?") + " · API " + (info.apiLevel || "?") + " · " + (info.abi || "?") + " · storage " + (info.storageRoot || "?")
      : "A local contract harness — real files and real processes, but NOT a device. Anything verified here is verified against the harness, not against Android.") +
    (info.writable === false ? " · the project directory is NOT writable" : "");
  const tools = (probe.toolchain && probe.toolchain.tools) || [];
  for (const tool of tools) {
    const chip = document.createElement("span");
    chip.className = "tool-chip" + (tool.available ? "" : " is-missing");
    chip.textContent = tool.name;
    chip.title = tool.available ? tool.path : tool.note + " — Gunther will not pretend this tool exists";
    el.appendChild(chip);
  }
}

function renderProjects(list) {
  const el = $("#projList");
  if (!el) return;
  el.innerHTML = "";
  if (!list) return;
  if (!list.length) {
    el.innerHTML = '<p class="proj__empty">No projects on this device yet. Create one, or import a folder or a .zip from storage.</p>';
    return;
  }
  for (const project of list) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "proj__item" + (state.project && state.project.id === project.id ? " is-open" : "");
    row.innerHTML =
      "<b>" + escapeHtml(project.name || project.id) + "</b>" +
      "<small>" + project.fileCount + " files · " + humanBytes(project.bytes) + "</small>";
    row.addEventListener("click", async () => {
      await flushActiveProject();
      await openProject(project);
    });
    el.appendChild(row);
  }
}

function renderActive() {
  const panel = $("#projActive");
  if (!panel) return;
  if (!state.project) {
    panel.hidden = true;
    $("#projWork").hidden = true;
    $("#projRun").hidden = true;
    return;
  }
  panel.hidden = false;
  $("#projWork").hidden = false;
  $("#projRun").hidden = false;
  $("#projTitle").textContent = state.project.name;
  const mirrored = baseline ? baseline.paths.size : 0;
  const opaque = baseline ? baseline.opaque.size : 0;
  const approved = approvedCommandList().length;
  const declared = manifest ? manifest.commands.length : 0;
  $("#projMeta").innerHTML = [
    "id " + escapeHtml(state.project.id),
    "files on device " + files.length,
    "mirrored for the agent " + mirrored + (mirrored < files.length ? " (the rest are not visible to it)" : ""),
    "protected (binary/oversized) " + opaque,
    "revision " + (state.workspace ? state.workspace.revision : 0),
    "commands " + declared + " declared · " + approved + " approved",
    "manifest " + (manifest ? MANIFEST_FILE : "absent — Gunther will not invent one"),
  ].join(" · ");

  const skips = $("#projSkips");
  const skipped = hydration ? hydration.skipped : [];
  const errors = hydration ? hydration.errors : [];
  if (skips) {
    if (!skipped.length && !errors.length && hydration) {
      skips.hidden = true;
    } else if (hydration && (skipped.length || errors.length)) {
      skips.hidden = false;
      const shown = skipped.slice(0, 12);
      skips.innerHTML =
        "<b>The agent cannot see these files.</b> The working copy holds " + mirrored + " of " + hydration.total + " files — " +
        "Gunther reports the gap instead of pretending it sees the whole project." +
        "<ul>" +
        shown.map((s) => "<li>" + escapeHtml(s.path) + " — " + escapeHtml(s.reason) + "</li>").join("") +
        errors.map((e) => "<li>" + escapeHtml(e.path) + " — could not be read (" + escapeHtml(e.message) + ")</li>").slice(0, 8).join("") +
        (skipped.length > shown.length ? "<li>…and " + (skipped.length - shown.length) + " more</li>" : "") +
        "</ul>";
    } else {
      skips.hidden = true;
    }
  }
  renderFiles();
  renderCommands();
  renderRuns();
}

function renderFiles() {
  const el = $("#projFiles");
  if (!el) return;
  el.innerHTML = "";
  if (!state.project) return;
  if (!files.length) {
    el.innerHTML = '<p class="proj__empty">This project has no files yet.</p>';
    return;
  }
  for (const item of fileTree(files.map((f) => f.path))) {
    const entry = files.find((f) => f.path === item.path) || { bytes: 0 };
    const row = document.createElement("button");
    row.type = "button";
    row.className = "proj__file" + (current.path === item.path ? " is-current" : "");
    row.innerHTML =
      '<span class="dp">' + escapeHtml("  ".repeat(item.depth)) + "</span>" +
      escapeHtml(item.name) +
      '<span class="sz">' + humanBytes(entry.bytes) + "</span>";
    row.title = item.path;
    row.addEventListener("click", () => loadFile(item.path));
    el.appendChild(row);
  }
}

function renderFileNote(text, kind) {
  const el = $("#projFileNote");
  if (!el) return;
  el.textContent = text || "";
  el.style.color = kind === "bad" ? "var(--err)" : kind === "ok" ? "var(--ok)" : "var(--ink-3)";
}

async function loadFile(path) {
  if (!state.project) return;
  const res = await readProjectFile(state.project.id, path);
  if (!res.ok) {
    renderFileNote("read failed: " + res.message, "bad");
    return;
  }
  current = { path: res.path || path, text: res.text || "", binary: Boolean(res.binary), bytes: res.bytes };
  $("#projFileName").textContent = current.path;
  const area = $("#projFileText");
  area.value = current.binary ? "" : current.text;
  area.disabled = current.binary;
  renderFileNote(current.binary ? "binary file — not shown as text" : humanBytes(current.bytes), current.binary ? "bad" : "");
  renderFiles();
}

async function saveFile() {
  if (!state.project || !current.path) {
    renderFileNote("select a file first", "bad");
    return;
  }
  const text = $("#projFileText").value;
  const res = await writeProjectFile(state.project.id, current.path, text);
  if (!res.ok) {
    renderFileNote("could not save: " + res.message, "bad");
    addLog("err", "PROJECT", "save failed on " + current.path + ": " + res.message);
    return;
  }
  current.text = text;
  // the mirror must agree with what is now on disk, or the next flush would
  // write the stale copy back over this edit
  const file = writeFile(state.workspace, current.path, text);
  const base = baseline || projectBaseline();
  base.paths.add(current.path);
  base.revisions[current.path] = file.revision;
  base.opaque.delete(current.path);
  setBaseline(base);
  renderFileNote("saved " + humanBytes(res.bytes), "ok");
  addLog("ok", "PROJECT", "saved " + current.path);
  await refreshFileList();
}

async function refreshFileList() {
  if (!state.project) return;
  const listed = await callHost("listFiles", { id: state.project.id });
  if (listed.ok && Array.isArray(listed.files)) files = listed.files;
  renderFiles();
}

function renderCommands() {
  const el = $("#projCommands");
  if (!el) return;
  el.innerHTML = "";
  if (!manifest) {
    el.innerHTML =
      '<p class="proj__empty">No ' + MANIFEST_FILE + " in this project. Gunther will not invent a verification command — " +
      "declare one (for example \"verify\": [\"sh\", \"verify.sh\"]) and it becomes runnable after you approve it here.</p>";
    return;
  }
  if (!manifest.commands.length) {
    el.innerHTML = '<p class="proj__empty">' + MANIFEST_FILE + " declares no usable command.</p>";
    return;
  }
  const approvals = approvalsFor(state.project.id);
  for (const command of manifest.commands) {
    const approved = approvals[command.name] === commandKey(command.argv);
    const availability = probe && probe.toolchain ? commandAvailability(command.argv, probe.toolchain) : { runnable: false, reason: "no toolchain probe" };
    const row = document.createElement("div");
    row.className = "proj__cmd" + (currentCommand === command.name ? " is-current" : "");
    const pick = document.createElement("button");
    pick.type = "button";
    pick.className = "proj__cmdpick";
    pick.innerHTML =
      "<b>" + escapeHtml(command.name) + "</b> <code>" + escapeHtml(command.argv.join(" ")) + "</code>" +
      (command.label ? " <em>" + escapeHtml(command.label) + "</em>" : "") +
      '<small class="' + (approved ? "approved" : "pending") + '">' +
      (approved ? "APPROVED — this exact argv" : "NEEDS APPROVAL") +
      (availability.runnable ? "" : " · " + escapeHtml(availability.reason.slice(0, 60))) +
      "</small>";
    pick.addEventListener("click", () => {
      currentCommand = command.name;
      renderCommands();
    });
    /* The gate is the human's: the operator approves this exact argv here,
       and any edit to the command silently revokes that approval. */
    const gate = document.createElement("button");
    gate.type = "button";
    gate.className = "btn btn--sm" + (approved ? "" : " btn--brass");
    gate.textContent = approved ? "REVOKE" : "APPROVE";
    gate.title = approved
      ? "withdraw approval for " + command.name + " — it becomes unrunnable again"
      : "approve '" + command.name + "' exactly as declared: " + command.argv.join(" ");
    gate.addEventListener("click", (event) => {
      event.stopPropagation();
      const next = approved ? revokeCommand(command.name) : approveCommand(command.name);
      renderCommands();
      renderActive();
      addLog("info", "PROJECT", command.name + (next ? " approved by the operator · " : " approval withdrawn · ") + command.argv.join(" "));
      toast(next ? "Approved: " + command.name : "Withdrawn: " + command.name, next ? "ok" : "warn");
    });
    row.append(pick, gate);
    el.appendChild(row);
  }
}

function renderOutput(record) {
  const el = $("#projOutput");
  if (!el) return;
  if (!record) {
    el.innerHTML = '<span class="dim">No command has been run yet in this session.</span>';
    return;
  }
  const cls = runVerdict(record) === "PASS" ? "ok" : record.ran ? "bad" : "dim";
  const head =
    '<span class="' + cls + '">' + runVerdict(record) + "</span> · $" + escapeHtml((record.argv || []).join(" ")) +
    (record.ran ? " · exit " + record.code + " · " + Math.round((record.durationMs || 0) / 100) / 10 + "s" : " · " + escapeHtml(record.error || "did not run")) +
    (record.truncated ? " · output truncated" : "") + "\n";
  el.innerHTML = head;
  if (record.stdout) el.innerHTML += escapeHtml(record.stdout) + "\n";
  if (record.stderr) el.innerHTML += '<span class="bad">' + escapeHtml(record.stderr) + "</span>";
}

function renderRuns() {
  const el = $("#projRuns");
  if (!el) return;
  el.innerHTML = "";
  if (!state.project) return;
  const runs = projectRuns(state, state.project.id).slice().reverse();
  if (!runs.length) {
    el.innerHTML = '<p class="proj__empty">No command has been executed for this project yet. Until one has, nothing here is verified.</p>';
    return;
  }
  for (const run of runs) {
    const verdict = runVerdict(run);
    const row = document.createElement("button");
    row.type = "button";
    row.className = "proj__runrow " + (verdict === "PASS" ? "is-pass" : run.ran ? "is-fail" : "is-none");
    row.innerHTML =
      "<span>" + escapeHtml(runLine(run)) + "</span>" +
      "<time>" + new Date(run.at).toISOString().slice(11, 19) + "Z · " + escapeHtml(run.trigger || "") + "</time>";
    row.addEventListener("click", () => renderOutput(run));
    el.appendChild(row);
  }
}

export function renderProjectRoom() {
  renderHost();
  renderActive();
  listProjects().then((res) => {
    if (res.ok) renderProjects(res.projects);
    else renderProjects(null);
  });
}

/* ------------------------------------------------------------------
   actions
   ------------------------------------------------------------------ */

export async function runDeclaredCommand(name, trigger = "operator", task = null, stepId = null, timeoutMs = 0) {
  if (!state.project) {
    toast("no project is open");
    return { ok: false, record: null };
  }
  const command = (manifest ? manifest.commands : []).find((c) => c.name === name);
  if (!command) {
    const why = "this project does not declare '" + name + "'";
    renderOutput({ argv: [], ran: false, error: why, durationMs: 0 });
    toast(why);
    return { ok: false, record: null };
  }
  const approvals = approvalsFor(state.project.id);
  if (approvals[command.name] !== commandKey(command.argv)) {
    const why = "'" + name + "' has not been approved — approve it in the Project room first";
    // the refusal is written where the result would have been, not only as a toast
    renderOutput({ argv: command.argv, ran: false, error: why, durationMs: 0 });
    toast(why);
    return { ok: false, record: null };
  }
  busy = true;
  $("#projRunBtn").disabled = true;
  $("#projRunAll").disabled = true;
  renderOutput({ argv: command.argv, ran: false, error: "running…", durationMs: 0 });
  const res = await executeCommand({
    projectId: state.project.id,
    command,
    trigger,
    task,
    stepId,
    timeoutMs,
    state,
  });
  busy = false;
  $("#projRunBtn").disabled = false;
  $("#projRunAll").disabled = false;
  renderOutput(res.record);
  renderRuns();
  scheduleSave();
  addLog(res.ok ? "ok" : "warn", "PROJECT", command.name + " → " + runLine(res.record));
  return res;
}

async function writeReport() {
  if (!state.project) return;
  const runs = projectRuns(state, state.project.id);
  const task = state.tasks.length ? state.tasks[state.tasks.length - 1] : null;
  const unavailable = [];
  if (!runs.length) unavailable.push("no command was executed for this project");
  if (probe && probe.toolchain) {
    for (const tool of probe.toolchain.tools.filter((t) => !t.available)) {
      const needed = runs.some((r) => (r.argv || [])[0] === tool.name);
      if (needed) unavailable.push(tool.name + " is not installed on this device");
    }
  }
  if (baseline && baseline.opaque.size) unavailable.push(baseline.opaque.size + " file(s) were never mirrored (binary or oversized) and were not touched");
  if (!manifest) unavailable.push("no " + MANIFEST_FILE + " — this project declares no verification command");
  const text = buildReport({
    projectName: state.project.name,
    projectId: state.project.id,
    goal: task ? task.goal : "",
    task,
    runs,
    probe,
    files,
    commands: manifest ? manifest.commands : [],
    unavailable,
    notes: [
      "host: " + hostLabel(),
      state.workspace ? "mirror revision " + state.workspace.revision : "no mirror",
    ],
  });
  const target = "GUNTHER-REPORT.md";
  const res = await writeProjectFile(state.project.id, target, text);
  if (!res.ok) {
    toast("could not write the report: " + res.message);
    return;
  }
  const file = writeFile(state.workspace, target, text);
  const base = baseline || projectBaseline();
  base.paths.add(target);
  base.revisions[target] = file.revision;
  setBaseline(base);
  await refreshFileList();
  toast("report written to GUNTHER-REPORT.md in the project");
  addLog("ok", "PROJECT", "delivery report written (" + runs.length + " command records)");
}

/** Used by the console when a plan finishes: deliver, then say what is proven. */
export async function deliverProject(goal, task) {
  if (!state.project || hostKind() === "none") return null;
  await flushActiveProject();
  await writeReport();
  return { project: state.project, runs: projectRuns(state, state.project.id) };
}

/* ------------------------------------------------------------------
   wiring
   ------------------------------------------------------------------ */

function wire() {
  const create = $("#projCreate");
  if (!create) return;
  create.addEventListener("click", async () => {
    const name = $("#projNewName").value.trim() || "Untitled project";
    const res = await createProject(name);
    if (!res.ok) {
      toast(res.message);
      return;
    }
    $("#projNewName").value = "";
    addLog("ok", "PROJECT", "created '" + name + "' on the device");
    await openProject(res.project);
    renderProjectRoom();
  });

  $("#projImportFolder").addEventListener("click", async () => {
    const res = await importFolder($("#projNewName").value.trim());
    if (!res.ok) {
      toast(res.code === "NO_HOST" ? res.message : "import failed: " + res.message);
      return;
    }
    if (res.cancelled) {
      toast("import cancelled");
      return;
    }
    $("#projNewName").value = "";
    addLog("ok", "PROJECT", "imported " + res.imported + " files (" + res.skipped + " skipped) from a device folder");
    await openProject(res.project);
    renderProjectRoom();
  });

  $("#projImportArchive").addEventListener("click", async () => {
    const res = await importArchive($("#projNewName").value.trim());
    if (!res.ok) {
      toast(res.code === "NO_HOST" ? res.message : "import failed: " + res.message);
      return;
    }
    if (res.cancelled) {
      toast("import cancelled");
      return;
    }
    $("#projNewName").value = "";
    addLog("ok", "PROJECT", "imported " + res.imported + " files (" + res.skipped + " skipped) from an archive");
    await openProject(res.project);
    renderProjectRoom();
  });

  $("#projExport").addEventListener("click", async () => {
    if (!state.project) return;
    await flushActiveProject();
    const res = await exportArchive(state.project.id, state.project.name);
    if (!res.ok) {
      toast("export failed: " + res.message);
      return;
    }
    toast(res.cancelled ? "export cancelled" : "exported " + res.files + " files (" + humanBytes(res.bytes) + ")");
    if (!res.cancelled) addLog("ok", "PROJECT", "exported the project as " + res.fileName);
  });

  $("#projReport").addEventListener("click", writeReport);

  $("#projDelete").addEventListener("click", async () => {
    if (!state.project) return;
    const label = state.project.name;
    const res = await deleteProject(state.project.id);
    if (!res.ok) {
      toast("delete failed: " + res.message);
      return;
    }
    addLog("warn", "PROJECT", "deleted '" + label + "' from the device");
    state.project = null;
    state.projectBaseline = null;
    baseline = null;
    manifest = null;
    files = [];
    scheduleSave();
    renderProjectRoom();
  });

  $("#projFileSave").addEventListener("click", saveFile);
  $("#projFileRevert").addEventListener("click", async () => {
    if (!current.path) return;
    await loadFile(current.path);
    renderFileNote("reverted to the file on the device", "");
  });

  $("#projRunBtn").addEventListener("click", () => {
    if (currentCommand) runDeclaredCommand(currentCommand);
  });

  $("#projRunAll").addEventListener("click", async () => {
    for (const command of approvedCommandList()) {
      // eslint-disable-next-line no-await-in-loop
      const res = await runDeclaredCommand(command.name);
      if (!res.ok) break; // stop at the first failure — that is the honest order
    }
  });

  // coming back from the system picker (or any app switch) re-asks what the
  // shell can reach, so the room never shows a toolchain that has gone stale
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshHost();
  });
}
