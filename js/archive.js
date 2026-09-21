/* ============================================================
   Gunther · GLASS HOUSE CONSOLE — js/archive.js
   THE ARCHIVE — the building's filing cabinet, pure logic.

   The operator hands Gunther documents — projects, research,
   source material — because nobody re-explains a codebase every
   morning. This module owns the honest parts: how text is split
   into digest chunks, how a digested answer becomes stored notes,
   how a turn's question retrieves which notes matter, and where
   everything is kept (IndexedDB when the host has one, memory in
   the test rig — same API, no branches at the call sites).

   The learning itself is done by the fleet: js/ui/archive.js runs
   these chunks through engine.dispatch under the LEARN system
   prompt. Free tokens in, permanent notes out.
   ============================================================ */

/* ---------- chunking: paragraphs packed to a size, never cut mid-word ---------- */

export const CHUNK_CHARS = 9000; // ~2.3K tokens per chunk — comfortable for every free line
export const MAX_CHUNKS = 24; // one document may not quietly spend a vendor's whole day

export function chunkText(text, size = CHUNK_CHARS) {
  const paras = String(text || "").replace(/\r\n/g, "\n").split(/\n{2,}/);
  const out = [];
  let cur = "";
  const flush = () => {
    if (cur.trim()) out.push(cur.trim());
    cur = "";
  };
  for (let p of paras) {
    p = p.trim();
    if (!p) continue;
    while (p.length > size) {
      // a monster paragraph: split at the last whitespace before the cap
      let cut = p.lastIndexOf(" ", size);
      if (cut < size / 2) cut = size;
      if (cur) flush();
      out.push(p.slice(0, cut).trim());
      p = p.slice(cut).trim();
    }
    if (cur && (cur.length + p.length + 2 > size)) flush();
    cur = cur ? cur + "\n\n" + p : p;
  }
  flush();
  return out;
}

export function estimateChunks(text) {
  return chunkText(text).length;
}

/* ---------- parsing a digest answer into notes ----------
   The LEARN prompt asks for blocks of:  ### ≤6-word title
                                         - factual lines
   parseNotes is forgiving: bullets, headings, or a plain blob —
   everything becomes at least one usable note. */
export function parseNotes(raw, docName = "document") {
  const s = String(raw || "").trim();
  if (!s) return [];
  const notes = [];
  const blocks = s.split(/^###\s+.*$/m).filter((b) => b.trim());
  const titles = [...s.matchAll(/^###\s+(.+)$/gm)].map((m) => m[1].trim());
  if (blocks.length && titles.length === blocks.length) {
    titles.forEach((t, i) => {
      const body = blocks[i].replace(/\n{3,}/g, "\n\n").trim();
      if (body) notes.push({ t: t.slice(0, 90), b: body.slice(0, 2000), doc: docName });
    });
  } else {
    // fallback: one note, first line as its title
    const lines = s.split(/\n+/).filter(Boolean);
    const head = (lines[0] || "notes").replace(/^[#\-*\s]+/, "").slice(0, 90);
    notes.push({ t: head || "notes", b: s.slice(0, 2000), doc: docName });
  }
  return notes;
}

/* ---------- recall: which learned notes does THIS turn need? ---------- */

export function tokenize(s) {
  const seen = new Set();
  for (const w of String(s || "").toLowerCase().split(/[^a-z0-9_\-]+/)) {
    if (w.length >= 3) seen.add(w);
  }
  return seen;
}

export function scoreNote(note, qTokens) {
  if (!qTokens.size) return 0;
  const title = tokenize(note.t);
  const body = tokenize(note.b);
  let hit = 0;
  for (const w of qTokens) {
    if (title.has(w)) hit += 3;
    else if (body.has(w)) hit += 1;
  }
  return hit;
}

/**
 * Top-k notes for a query, zero-score notes excluded — recall that
 * says nothing beats recall that wastes the prompt.
 */
export function retrieve(notes, query, k = 5, maxChars = 2600) {
  const q = tokenize(query);
  if (!q.size || !Array.isArray(notes) || !notes.length) return [];
  const scored = notes
    .map((n) => ({ n, s: scoreNote(n, q) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, k);
  const picked = [];
  let chars = 0;
  for (const { n, s } of scored) {
    const len = n.t.length + n.b.length + 6;
    if (picked.length && chars + len > maxChars) break;
    picked.push({ ...n, score: s });
    chars += len;
  }
  return picked;
}

/** The block injected into the system prompt for one turn. */
export function formatContext(picked) {
  if (!picked.length) return "";
  const head =
    "\n\nARCHIVE — learned material from the operator's own imported documents. " +
    "Apply it silently where it is relevant; never mention it unless asked.\n";
  const body = picked.map((n) => "◆ " + n.t + "  [" + n.doc + "]\n" + n.b).join("\n\n");
  return head + body;
}

/* ---------- storage: IndexedDB when present, memory otherwise ---------- */

const DB_NAME = "gunther-archive";
const STORE = "docs";

function memoryStore() {
  const map = new Map();
  return {
    kind: "memory",
    async all() {
      return [...map.values()].sort((a, b) => b.at - a.at);
    },
    async put(doc) {
      map.set(doc.id, { ...doc });
    },
    async del(id) {
      map.delete(id);
    },
  };
}

function idbStore() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => {
      const db = req.result;
      const tx = (mode) => db.transaction(STORE, mode).objectStore(STORE);
      resolve({
        kind: "idb",
        async all() {
          return new Promise((res, rej) => {
            const r = tx("readonly").getAll();
            r.onsuccess = () => res((r.result || []).sort((a, b) => b.at - a.at));
            r.onerror = () => rej(r.error);
          });
        },
        async put(doc) {
          return new Promise((res, rej) => {
            const r = tx("readwrite").put({ ...doc });
            r.onsuccess = () => res();
            r.onerror = () => rej(r.error);
          });
        },
        async del(id) {
          return new Promise((res, rej) => {
            const r = tx("readwrite").delete(id);
            r.onsuccess = () => res();
            r.onerror = () => rej(r.error);
          });
        },
      });
    };
    req.onerror = () => reject(req.error);
  });
}

let storePromise = null;

/** One store per session; callers await it and forget the difference. */
export function openStore() {
  if (!storePromise) {
    storePromise =
      typeof indexedDB !== "undefined" && indexedDB
        ? idbStore().catch(() => memoryStore())
        : Promise.resolve(memoryStore());
  }
  return storePromise;
}

let lastStamp = 0; // two files filed in one millisecond still keep their order
export function newDoc(name, raw) {
  const wall = Date.now();
  const at = wall > lastStamp ? wall : lastStamp + 1;
  lastStamp = at;
  return {
    id: "d" + at.toString(36) + Math.random().toString(36).slice(2, 7),
    name: String(name || "untitled").slice(0, 120),
    at,
    chars: String(raw || "").length,
    status: "raw", // raw → digesting → learned · error
    progress: { i: 0, n: 0 },
    notes: [],
    raw: String(raw || ""),
  };
}
