/* ============================================================
   Gunther · RIG HOST (test/tools only)

   A second implementation of the contract in docs/android-project-contract.md:
   real directories, real processes, real exit codes — on the machine running
   the tests instead of inside the APK.

   It is deliberately loud about what it is NOT: hostInfo().platform is
   "rig", and the console renders that as "local contract harness (not a
   device)". Passing here means the console side of the contract works
   against a real filesystem; it says nothing about Android.
   ============================================================ */

import { spawn } from "node:child_process";
import {
  accessSync,
  constants,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, sep } from "node:path";

const MAX_TEXT_BYTES = 2_000_000;
const MAX_LIST_FILES = 5000;
const MAX_OUTPUT_BYTES = 200_000;
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 600_000;
const MAX_IMPORT_FILES = 2000;
const MAX_IMPORT_BYTES = 40_000_000;

const TOOL_CANDIDATES = [
  "sh", "dash", "bash", "cat", "ls", "cp", "mv", "rm", "mkdir", "touch", "ln", "find", "grep", "sed",
  "awk", "sort", "uniq", "wc", "head", "tail", "cut", "tr", "xargs", "expr", "diff", "patch",
  "sha256sum", "timeout", "env", "printf", "tee", "date", "sleep", "zip", "unzip", "tar", "gzip",
  "curl", "git", "make", "node", "npm", "python3", "ruby",
];

export class HostError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code || "HOST_ERROR";
  }
}

const fail = (message, code) => {
  throw new HostError(message, code);
};

const newId = () => "p-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);

function safeId(id) {
  return typeof id === "string" && id.length > 0 && id.length < 80 && /^[A-Za-z0-9._-]+$/.test(id) && !id.startsWith(".");
}

function inside(root, target) {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !rel.includes(".." + sep));
}

function resolveInside(root, rel) {
  if (typeof rel !== "string" || !rel.trim()) fail("missing path", "BADREQUEST");
  const cleaned = rel.replace(/\\/g, "/").trim();
  if (cleaned.startsWith("/")) fail("absolute paths are not allowed", "BADREQUEST");
  const target = join(root, cleaned);
  if (!inside(root, target)) fail("path escapes the project", "BADREQUEST");
  return target;
}

/** `base` is the project root (paths are relative to it); `dir` walks down. */
function walkFiles(base, dir = base, out = [], state = { truncated: false }) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (out.length >= MAX_LIST_FILES) {
        state.truncated = true;
        return out;
      }
      walkFiles(base, full, out, state);
      continue;
    }
    if (out.length >= MAX_LIST_FILES) {
      state.truncated = true;
      return out;
    }
    out.push({ path: relative(base, full).split(sep).join("/"), bytes: statSync(full).size });
  }
  return out;
}

const looksBinary = (data) => {
  const limit = Math.min(data.length, 8192);
  for (let i = 0; i < limit; i++) if (data[i] === 0) return true;
  return false;
};

function toolPath(name) {
  const paths = (process.env.PATH || "/usr/bin:/bin").split(":");
  for (const dir of paths) {
    const candidate = join(dir, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

/* ------------------------------------------------------------------
   a minimal, real ZIP (stored entries) so delivery/export is genuinely
   an archive on the rig too
   ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = -1;
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

export function writeZip(root, target) {
  const entries = walkFiles(root);
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const data = readFileSync(join(root, entry.path));
    const name = Buffer.from(entry.path, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, name, data);
    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(20, 6);
    head.writeUInt16LE(0, 8);
    head.writeUInt16LE(0, 10);
    head.writeUInt16LE(0, 12);
    head.writeUInt16LE(0, 14);
    head.writeUInt32LE(crc, 16);
    head.writeUInt32LE(data.length, 20);
    head.writeUInt32LE(data.length, 24);
    head.writeUInt16LE(name.length, 28);
    head.writeUInt16LE(0, 30);
    head.writeUInt16LE(0, 32);
    head.writeUInt16LE(0, 34);
    head.writeUInt16LE(0, 36);
    head.writeUInt32LE(0, 38);
    head.writeUInt32LE(offset, 42);
    central.push(head, name);
    offset += local.length + name.length + data.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  const buffer = Buffer.concat([...chunks, centralBuf, end]);
  writeFileSync(target, buffer);
  return { files: entries.length, bytes: buffer.length };
}

export function readZip(archive, root) {
  const buffer = readFileSync(archive);
  const entries = [];
  let cursor = 0;
  let bytes = 0;
  while (cursor + 30 <= buffer.length && buffer.readUInt32LE(cursor) === 0x04034b50) {
    const method = buffer.readUInt16LE(cursor + 8);
    const size = buffer.readUInt32LE(cursor + 18);
    const nameLen = buffer.readUInt16LE(cursor + 26);
    const extraLen = buffer.readUInt16LE(cursor + 28);
    const name = buffer.slice(cursor + 30, cursor + 30 + nameLen).toString("utf8");
    if (method !== 0) fail("the rig reads stored (uncompressed) archives only", "UNSUPPORTED");
    const start = cursor + 30 + nameLen + extraLen;
    const data = buffer.slice(start, start + size);
    const target = resolveInside(root, name);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, data);
    bytes += data.length;
    entries.push(name);
    cursor = start + size;
  }
  if (!entries.length) fail("the archive has no readable entries", "IMPORT");
  return { files: entries.length, bytes };
}

/* ------------------------------------------------------------------
   the host
   ------------------------------------------------------------------ */

export function createNodeHost(options = {}) {
  const root = options.root || join(process.cwd(), ".gunther-rig");
  const projectsRoot = join(root, "projects");
  mkdirSync(projectsRoot, { recursive: true });
  const indexFile = join(projectsRoot, "index.json");

  const readIndex = () => {
    try {
      const parsed = JSON.parse(readFileSync(indexFile, "utf8"));
      return Array.isArray(parsed.projects) ? parsed.projects : [];
    } catch {
      return [];
    }
  };
  const writeIndex = (projects) => writeFileSync(indexFile, JSON.stringify({ projects }, null, 2));

  const projectDir = (id) => {
    if (!safeId(id)) fail("unsafe project id", "BADREQUEST");
    const dir = join(projectsRoot, id);
    if (!existsSync(dir)) fail("project not found: " + id, "NOTFOUND");
    return dir;
  };

  const countFiles = (dir) => walkFiles(dir).length;
  const dirBytes = (dir) => walkFiles(dir).reduce((n, f) => n + f.bytes, 0);

  const createProjectDir = (name) => {
    const clean = String(name || "Untitled project").trim().slice(0, 120) || "Untitled project";
    const id = newId();
    const dir = join(projectsRoot, id);
    mkdirSync(dir, { recursive: true });
    writeIndex([...readIndex().filter((p) => p.id !== id), { id, name: clean, createdAt: Date.now() }]);
    return { dir, id, name: clean };
  };

  return {
    kind: "rig",

    async hostInfo() {
      return {
        platform: "rig",
        apiLevel: 0,
        release: process.platform + " " + process.version,
        abi: process.arch,
        device: "contract harness — NOT a device",
        storageRoot: projectsRoot,
        pluginVersion: "rig-1.0.0",
        writable: true,
        note: "this is the local test harness, not Android",
      };
    },

    async probeToolchain() {
      return {
        shell: toolPath("sh") || "",
        path: process.env.PATH || "",
        tools: TOOL_CANDIDATES.map((name) => {
          const path = toolPath(name);
          return {
            name,
            path: path || "",
            available: Boolean(path),
            note: path ? "found" : "not present on this machine",
          };
        }),
        note: "rig toolchain — the device toolchain is reported by the Android plugin",
      };
    },

    async listProjects() {
      const seen = new Map(readIndex().map((p) => [p.id, p]));
      for (const entry of readdirSync(projectsRoot, { withFileTypes: true })) {
        if (!entry.isDirectory() || !safeId(entry.name)) continue;
        if (!seen.has(entry.name)) seen.set(entry.name, { id: entry.name, name: entry.name, createdAt: Date.now() });
      }
      return {
        projects: Array.from(seen.values()).map((p) => {
          const dir = join(projectsRoot, p.id);
          return { id: p.id, name: p.name, createdAt: p.createdAt, fileCount: countFiles(dir), bytes: dirBytes(dir) };
        }),
      };
    },

    async createProject({ name } = {}) {
      const { id, name: clean } = createProjectDir(name);
      return { project: { id, name: clean, createdAt: Date.now() } };
    },

    async deleteProject({ id } = {}) {
      if (!safeId(id)) fail("unsafe project id", "BADREQUEST");
      rmSync(join(projectsRoot, id), { recursive: true, force: true });
      writeIndex(readIndex().filter((p) => p.id !== id));
      return { deleted: true, id };
    },

    async listFiles({ id } = {}) {
      const dir = projectDir(id);
      const state = { truncated: false };
      const files = walkFiles(dir, dir, [], state);
      files.sort((a, b) => a.path.localeCompare(b.path));
      return { files, truncated: state.truncated, root: dir };
    },

    async readFile({ id, path } = {}) {
      const dir = projectDir(id);
      const target = resolveInside(dir, path);
      if (!existsSync(target) || statSync(target).isDirectory()) fail("file not found: " + path, "NOTFOUND");
      const data = readFileSync(target);
      if (data.length > MAX_TEXT_BYTES) fail("file exceeds the " + MAX_TEXT_BYTES / 1000 + " KB working limit", "TOOLARGE");
      const binary = looksBinary(data);
      return {
        path: relative(dir, target).split(sep).join("/"),
        bytes: data.length,
        binary,
        text: binary ? "" : data.toString("utf8"),
        ...(binary ? { note: "binary file — not shown as text" } : {}),
      };
    },

    async writeFile({ id, path, text } = {}) {
      const dir = projectDir(id);
      const target = resolveInside(dir, path);
      if (existsSync(target) && statSync(target).isDirectory()) fail("path is a directory: " + path, "BADREQUEST");
      const body = text == null ? "" : String(text);
      if (Buffer.byteLength(body, "utf8") > MAX_TEXT_BYTES) fail("file exceeds the working limit", "TOOLARGE");
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, body);
      return { path: relative(dir, target).split(sep).join("/"), bytes: Buffer.byteLength(body, "utf8") };
    },

    async deleteFile({ id, path } = {}) {
      const dir = projectDir(id);
      const target = resolveInside(dir, path);
      const existed = existsSync(target) && !statSync(target).isDirectory();
      if (existed) rmSync(target);
      return { deleted: existed, path };
    },

    async runCommand({ id, argv, timeoutMs } = {}) {
      const dir = projectDir(id);
      if (!Array.isArray(argv) || !argv.length) fail("argv is required", "BADREQUEST");
      const head = String(argv[0]);
      const binary = head.includes("/") ? (existsSync(head) ? head : null) : toolPath(head);
      if (!binary) fail("only system binaries can be executed; '" + head + "' was not found on PATH", "BINARY_NOT_ALLOWED");
      let timeout = Number(timeoutMs) || DEFAULT_TIMEOUT_MS;
      if (timeout <= 0) timeout = DEFAULT_TIMEOUT_MS;
      if (timeout > MAX_TIMEOUT_MS) timeout = MAX_TIMEOUT_MS;

      const full = [binary, ...argv.slice(1).map(String)];
      const started = Date.now();
      const child = spawn(full[0], full.slice(1), {
        cwd: dir,
        // its own process group: a timed-out wrapper must not leave children running
        detached: true,
        env: { PATH: process.env.PATH || "", HOME: dir, GUNTHER_PROJECT: dir, LANG: "C.UTF-8" },
      });
      let stdout = Buffer.alloc(0);
      let stderr = Buffer.alloc(0);
      let truncated = false;
      const collect = (chunk, which) => {
        const current = which === "out" ? stdout : stderr;
        const next = Buffer.concat([current, chunk]);
        if (next.length > MAX_OUTPUT_BYTES) {
          truncated = true;
          const clipped = next.slice(0, MAX_OUTPUT_BYTES);
          if (which === "out") stdout = clipped;
          else stderr = clipped;
          return;
        }
        if (which === "out") stdout = next;
        else stderr = next;
      };
      child.stdout.on("data", (chunk) => collect(chunk, "out"));
      child.stderr.on("data", (chunk) => collect(chunk, "err"));

      let timedOut = false;
      const code = await new Promise((resolve) => {
        const timer = setTimeout(() => {
          timedOut = true;
          try {
            process.kill(-child.pid, "SIGKILL"); // the whole group, not just the wrapper
          } catch {
            child.kill("SIGKILL");
          }
        }, timeout);
        child.on("error", (error) => {
          clearTimeout(timer);
          resolve({ error });
        });
        child.on("close", (exitCode, signal) => {
          clearTimeout(timer);
          resolve(exitCode == null ? -1 : exitCode);
        });
      });
      if (code && code.error) fail("could not start '" + head + "': " + code.error.message, "SPAWN");

      return {
        argv: full,
        cwd: dir,
        code,
        stdout: stdout.toString("utf8"),
        stderr: stderr.toString("utf8"),
        stdoutTruncated: truncated,
        stderrTruncated: truncated,
        durationMs: Date.now() - started,
        timedOut,
        timeoutMs: timeout,
        runner: "rig-child-process",
        binary,
        ...(timedOut ? { note: "killed after " + timeout / 1000 + "s" } : {}),
      };
    },

    /** The rig has no storage picker: the caller names a real directory. */
    async importFolder({ name, sourcePath } = {}) {
      if (!sourcePath) fail("the rig cannot open a picker — pass sourcePath", "BADREQUEST");
      if (!existsSync(sourcePath) || !statSync(sourcePath).isDirectory()) fail("not a directory: " + sourcePath, "NOTFOUND");
      const { dir, id, name: clean } = createProjectDir(name || sourcePath.split(sep).pop());
      cpSync(sourcePath, dir, { recursive: true, filter: (src) => !src.includes(sep + ".git" + sep) });
      const files = walkFiles(dir);
      let bytes = 0;
      for (const f of files) bytes += f.bytes;
      return { project: { id, name: clean, createdAt: Date.now() }, imported: files.length, skipped: 0, bytes, cancelled: false };
    },

    async importArchive({ name, sourcePath } = {}) {
      if (!sourcePath) fail("the rig cannot open a picker — pass sourcePath", "BADREQUEST");
      const { dir, id, name: clean } = createProjectDir(name || "Imported archive");
      const res = readZip(sourcePath, dir);
      return { project: { id, name: clean, createdAt: Date.now() }, imported: res.files, skipped: 0, bytes: res.bytes, cancelled: false };
    },

    async exportArchive({ id, name, targetPath } = {}) {
      const dir = projectDir(id);
      const target = targetPath || join(root, ((name || id) + ".zip").replace(/[^A-Za-z0-9._-]+/g, "-"));
      const res = writeZip(dir, target);
      return { saved: true, cancelled: false, fileName: target.split(sep).pop(), files: res.files, bytes: res.bytes, targetPath: target };
    },
  };
}
