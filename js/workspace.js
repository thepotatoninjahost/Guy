/* ============================================================
   Gunther · WORKSPACE MODEL

   The agent needs a project it can inspect and change, not just a
   chat transcript. This is the safe, platform-neutral workspace
   layer: files are versioned in memory, edits are exact and
   transactional, and every mutation leaves an audit record. The
   Android adapter can persist/export this model; the agent runtime
   can use the same contract in tests and in the app.
   ============================================================ */

const MAX_FILE = 2_000_000;
const MAX_FILES = 500;
const cleanPath = (path) => {
  const p = String(path || "").replace(/\\/g, "/").replace(/^\.\//, "");
  if (!p || p.startsWith("/") || p.split("/").includes("..")) throw new Error("unsafe workspace path");
  return p;
};
const cleanText = (text) => String(text == null ? "" : text).slice(0, MAX_FILE);
const stamp = () => Date.now();

export function createWorkspace(name = "project") {
  return {
    id: "w-" + stamp().toString(36) + "-" + Math.random().toString(36).slice(2, 7),
    name: String(name || "project").slice(0, 120),
    createdAt: stamp(),
    updatedAt: stamp(),
    revision: 0,
    files: {},
    history: [],
  };
}

function record(ws, action, path, detail = {}) {
  ws.revision += 1;
  ws.updatedAt = stamp();
  ws.history.push({ revision: ws.revision, at: ws.updatedAt, action, path, ...detail });
  ws.history = ws.history.slice(-200);
}

export function listFiles(ws) {
  return Object.keys(ws.files || {}).sort();
}

export function hasFile(ws, path) {
  return Object.prototype.hasOwnProperty.call(ws.files || {}, cleanPath(path));
}

export function readFile(ws, path) {
  const p = cleanPath(path);
  if (!hasFile(ws, p)) throw new Error("file not found: " + p);
  return ws.files[p].text;
}

export function writeFile(ws, path, text, meta = {}) {
  const p = cleanPath(path);
  const body = cleanText(text);
  if (!hasFile(ws, p) && listFiles(ws).length >= MAX_FILES) throw new Error("workspace file limit reached");
  const old = ws.files[p];
  ws.files[p] = {
    path: p,
    text: body,
    language: String(meta.language || old?.language || p.split(".").pop() || "text").slice(0, 30),
    createdAt: old?.createdAt || stamp(),
    updatedAt: stamp(),
    revision: (old?.revision || 0) + 1,
  };
  record(ws, old ? "update" : "create", p, { bytes: body.length });
  return ws.files[p];
}

export function deleteFile(ws, path) {
  const p = cleanPath(path);
  if (!hasFile(ws, p)) return false;
  delete ws.files[p];
  record(ws, "delete", p);
  return true;
}

export function importFiles(ws, files) {
  if (!files || typeof files !== "object") return [];
  const added = [];
  for (const [path, text] of Object.entries(files)) {
    writeFile(ws, path, text);
    added.push(cleanPath(path));
  }
  return added;
}

export function replaceExact(ws, path, before, after) {
  const current = readFile(ws, path);
  const from = String(before);
  if (!from) throw new Error("edit anchor cannot be empty");
  const first = current.indexOf(from);
  if (first < 0) throw new Error("edit anchor not found: " + cleanPath(path));
  if (current.indexOf(from, first + from.length) >= 0) throw new Error("edit anchor is ambiguous: " + cleanPath(path));
  const next = current.slice(0, first) + String(after) + current.slice(first + from.length);
  return writeFile(ws, path, next);
}

export function snapshot(ws) {
  return JSON.parse(JSON.stringify(ws));
}

export function restore(ws, snap) {
  if (!snap || !snap.files || !snap.id) throw new Error("invalid workspace snapshot");
  ws.name = snap.name;
  ws.files = JSON.parse(JSON.stringify(snap.files));
  ws.history = JSON.parse(JSON.stringify(snap.history || []));
  ws.revision = snap.revision || 0;
  ws.updatedAt = stamp();
  return ws;
}

export function transaction(ws, work) {
  const before = snapshot(ws);
  try {
    const result = work(ws);
    return { ok: true, result, revision: ws.revision };
  } catch (error) {
    restore(ws, before);
    return { ok: false, error: error instanceof Error ? error.message : String(error), revision: ws.revision };
  }
}

export function validateWorkspace(ws) {
  if (!ws || typeof ws !== "object" || !ws.id || !ws.files || typeof ws.files !== "object") return false;
  const paths = Object.keys(ws.files);
  if (paths.length > MAX_FILES) return false;
  return paths.every((p) => {
    try { cleanPath(p); } catch { return false; }
    const f = ws.files[p];
    return f && f.path === p && typeof f.text === "string" && f.text.length <= MAX_FILE;
  });
}
