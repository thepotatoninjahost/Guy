/* ============================================================
   Gunther · GLASS HOUSE CONSOLE — js/ui/archive.js
   THE ARCHIVE — the fourth room: import, learn, recall.

   Drop files or paste text; every document is split into honest
   chunks and run through the FLEET under a LEARN prompt — free
   tokens in, permanent notes out. The notes live on the device
   (IndexedDB). Each new turn in the Room quietly asks the archive
   which notes bear on the question, and only those ride along.
   ============================================================ */

import { state, addLog } from "../state.js";
import { dispatch } from "../engine.js";
import {
  openStore,
  newDoc,
  chunkText,
  estimateChunks,
  parseNotes,
  retrieve,
  formatContext,
  MAX_CHUNKS,
} from "../archive.js";
import { fmtTok, toast } from "./render.js";

const LEARN_SYSTEM = [
  "You are the learning engine of Gunther, a personal coding console. You are shown one chunk of a document the operator imported: project files, research, notes, specs.",
  "Compress what you were shown into NOTES Gunther will consult on future turns — facts, rules, conventions, decisions, definitions, file paths, numbers, procedures.",
  "Format: for each distinct topic, a heading line '### up-to-six-words', then 2-6 dash bullets under it. Nothing else: no preamble, no summary of your task, no code fences.",
  "Keep exact names, paths, versions and figures verbatim. If the chunk is prose in another language, keep each note's title in English and the key terms bilingual.",
  "Only note what the document states — never invent, never pad.",
].join("\n");

const $ = (s) => document.querySelector(s);
let docsCache = [];
let digesting = null; // { id, abort } while a digest runs
let searchWord = "";

export async function initArchive() {
  await refresh();
  bindTools();
  state.bus.addEventListener("archive", () => refresh());
}

async function refresh() {
  const store = await openStore();
  docsCache = await store.all();
  renderList();
}

async function persist(doc) {
  const store = await openStore();
  await store.put(doc);
  const i = docsCache.findIndex((d) => d.id === doc.id);
  if (i >= 0) docsCache[i] = doc;
  else docsCache.unshift(doc);
  renderList();
}

/* ---------- the list ---------- */

function renderList() {
  const wrap = $("#archiveList");
  if (!wrap) return;
  wrap.innerHTML = "";
  const q = searchWord.trim().toLowerCase();

  const bar = document.createElement("div");
  bar.className = "arch-count";
  const totalNotes = docsCache.reduce((a, d) => a + (d.notes ? d.notes.length : 0), 0);
  bar.textContent =
    docsCache.length === 0
      ? "empty — hand the building its papers: files above, or paste text"
      : docsCache.length +
        (docsCache.length === 1 ? " document · " : " documents · ") +
        totalNotes +
        (totalNotes === 1 ? " learned note" : " learned notes") +
        (q ? " · filter: “" + searchWord + "”" : "");
  wrap.appendChild(bar);

  if (!docsCache.length) return;

  for (const d of docsCache) {
    const matched = q
      ? (d.notes || []).filter((n) => (n.t + " " + n.b + " " + n.doc).toLowerCase().includes(q))
      : [];
    if (q && !matched.length && !(d.name || "").toLowerCase().includes(q)) continue;

    const card = document.createElement("div");
    card.className = "archdoc is-" + d.status;
    card.dataset.id = d.id;

    const head = document.createElement("div");
    head.className = "archdoc__head";
    const name = document.createElement("b");
    name.textContent = d.name;
    const meta = document.createElement("span");
    meta.className = "archdoc__meta";
    const nn = (d.notes || []).length;
    meta.textContent =
      fmtTok(d.chars) +
      " chars · " +
      (d.status === "learned"
        ? nn + (nn === 1 ? " note learned" : " notes learned")
        : d.status === "digesting"
          ? "learning " + d.progress.i + "/" + d.progress.n + " chunks"
          : d.status === "error"
            ? "interrupted — " + nn + (nn === 1 ? " note" : " notes") + " kept · retry continues from chunk " + (d.progress.i + 1)
            : "not learned yet · ~" + estimateChunks(d.raw) + (estimateChunks(d.raw) === 1 ? " chunk" : " chunks"));
    head.append(name, meta);
    card.appendChild(head);

    if (d.status === "digesting") {
      const prog = document.createElement("div");
      prog.className = "archdoc__prog";
      prog.style.setProperty("--p", Math.round((d.progress.i / Math.max(1, d.progress.n)) * 100) + "%");
      card.appendChild(prog);
    }

    const acts = document.createElement("div");
    acts.className = "archdoc__acts";
    const btn = (label, fn, cls) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn btn--sm" + (cls ? " " + cls : "");
      b.textContent = label;
      b.addEventListener("click", fn);
      acts.appendChild(b);
      return b;
    };
    if (d.status === "digesting") {
      btn("ABORT", () => {
        if (digesting && digesting.id === d.id) digesting.abort = true;
      });
    } else {
      btn(d.status === "learned" || d.status === "error" ? "RE-LEARN" : "LEARN", () => startDigest(d), d.status === "raw" ? "btn--brass" : "");
    }
    btn(d.rawOpen ? "HIDE SOURCE" : "SOURCE", () => {
      d.rawOpen = !d.rawOpen;
      renderList();
    });
    if ((d.notes || []).length) {
      btn(d.notesOpen ? "HIDE NOTES" : "NOTES (" + d.notes.length + ")", () => {
        d.notesOpen = !d.notesOpen;
        renderList();
      });
    }
    btn("✕", async () => {
      // deletes are instant — source files live on the device and can always be re-filed
      const store = await openStore();
      await store.del(d.id);
      addLog("info", "SESSION", "archive: deleted " + d.name);
      await refresh();
    });
    card.appendChild(acts);

    if (d.rawOpen) {
      const pre = document.createElement("pre");
      pre.className = "archdoc__raw";
      pre.textContent = d.raw;
      card.appendChild(pre);
    }

    const shown = d.notesOpen ? (q && matched.length ? matched : d.notes || []) : q && matched.length ? matched : [];
    if (shown.length) {
      const list = document.createElement("div");
      list.className = "archnotes";
      for (const n of shown) {
        const el = document.createElement("div");
        el.className = "archnote";
        const t = document.createElement("b");
        t.textContent = n.t;
        const b = document.createElement("div");
        b.textContent = n.b;
        el.append(t, b);
        list.appendChild(el);
      }
      card.appendChild(list);
    }
    wrap.appendChild(card);
  }
}

/* ---------- importing ---------- */

function bindTools() {
  const fileIn = $("#archFiles");
  if (fileIn) {
    fileIn.addEventListener("change", async () => {
      const files = [...(fileIn.files || [])];
      fileIn.value = "";
      let done = 0;
      for (const f of files) {
        if (f.size > 400 * 1024) {
          toast("SKIPPED " + f.name + " — over 400KB; this device learns documents, not archives", "warn");
          continue;
        }
        const text = await f.text();
        if (!text.trim() || /\u0000/.test(text.slice(0, 512))) {
          toast("SKIPPED " + f.name + " — binary, not text", "warn");
          continue;
        }
        const doc = newDoc(f.name, text);
        await persist(doc);
        done++;
      }
      if (done) {
        addLog("info", "SESSION", "archive: imported " + done + (done === 1 ? " file" : " files"));
        toast(done + (done === 1 ? " file filed — hit LEARN when you want it studied" : " files filed — hit LEARN when you want them studied"), "ok");
      }
    });
  }

  const pasteBtn = $("#archPasteBtn");
  if (pasteBtn) {
    pasteBtn.addEventListener("click", () => {
      const box = $("#archPaste");
      box.hidden = !box.hidden;
      if (!box.hidden) box.querySelector("textarea").focus();
    });
  }
  const savePaste = $("#archPasteSave");
  if (savePaste) {
    savePaste.addEventListener("click", async () => {
      const box = $("#archPaste");
      const ta = box.querySelector("textarea");
      const text = ta.value.trim();
      if (!text) {
        toast("Nothing pasted — the archive does not learn silence", "warn");
        return;
      }
      const first = text.split(/\n+/)[0].replace(/^#+\s*/, "").slice(0, 60);
      const doc = newDoc("pasted: " + (first || "notes"), text);
      await persist(doc);
      ta.value = "";
      box.hidden = true;
      addLog("info", "SESSION", "archive: pasted text filed as “" + doc.name + "”");
      toast("Filed — hit LEARN to have the fleet study it", "ok");
    });
  }

  const search = $("#archSearch");
  if (search) {
    search.addEventListener("input", () => {
      searchWord = search.value || "";
      renderList();
    });
  }
}

/* ---------- digesting: the learning run ---------- */

async function startDigest(doc) {
  if (state.busy) {
    toast("The room is mid-turn — the archive learns right after", "warn");
    return;
  }
  if (digesting) {
    toast("One document at a time — the fleet studies sequentially, honestly", "warn");
    return;
  }
  const chunks = chunkText(doc.raw).slice(0, MAX_CHUNKS);
  const proceed = () => runDigest(doc, chunks);
  if (doc.status !== "learned" && doc.status !== "error") {
    // cost honesty: one confirm arm — click LEARN again to start big jobs
    if (chunks.length > 6 && !doc.armed) {
      doc.armed = true;
      renderList();
      const card = document.querySelector('.archdoc[data-id="' + doc.id + '"]');
      if (card) {
        const b = card.querySelector(".btn--brass");
        if (b) b.textContent = "LEARN " + chunks.length + " CHUNKS · ~" + fmtTok(chunks.length * 2600) + " FREE TOK — TAP AGAIN";
      }
      return;
    }
  }
  proceed();
}

async function runDigest(doc, chunks) {
  digesting = { id: doc.id, abort: false };
  const done = doc.notes.length || 0; // retries continue where they stopped
  doc.status = "digesting";
  doc.progress = { i: done, n: chunks.length };
  doc.armed = false;
  await persist(doc);
  addLog("info", "SESSION", "archive: learning “" + doc.name + "” — " + chunks.length + " chunks");

  try {
    for (let i = done; i < chunks.length; i++) {
      if (digesting.abort) {
        doc.status = "error";
        doc.progress = { i, n: chunks.length };
        await persist(doc);
        addLog("warn", "SESSION", "archive: learning aborted at chunk " + (i + 1) + "/" + chunks.length);
        return;
      }
      const res = await dispatch({
        system: LEARN_SYSTEM,
        messages: [{ role: "user", content: "DOCUMENT: " + doc.name + " (chunk " + (i + 1) + "/" + chunks.length + ")\n\n" + chunks[i] }],
        estTok: Math.ceil(chunks[i].length / 3.2) + 200,
        maxTokens: 900,
        temperature: 0.2,
      });
      const fresh = parseNotes(res.text, doc.name);
      if (fresh.length) doc.notes.push(...fresh);
      doc.progress = { i: i + 1, n: chunks.length };
      await persist(doc);
    }
    doc.status = "learned";
    addLog("info", "SESSION", "archive: “" + doc.name + "” learned — " + (doc.notes || []).length + " notes stored");
    toast("LEARNED — " + doc.notes.length + " notes from “" + doc.name + "” are now in every relevant turn", "ok");
  } catch (err) {
    doc.status = "error";
    addLog("err", "SESSION", "archive: learning failed — " + (err.code || err.message || "err"));
    toast("Learning paused — " + (err.code === "NO_LINES" ? "fleet at ceiling; retry when a line frees" : "the line failed; retry continues from chunk " + (doc.progress.i + 1)), "warn");
  } finally {
    digesting = null;
    await persist(doc);
  }
}

/* ---------- recall: what the console asks every turn ---------- */

export async function getTurnContext(queryText) {
  if (state.dials.useArchive === false) return { text: "", used: [] };
  const store = await openStore();
  const docs = await store.all();
  const notes = [];
  for (const d of docs) for (const n of d.notes || []) notes.push(n);
  if (!notes.length) return { text: "", used: [] };
  const picked = retrieve(notes, queryText);
  return { text: formatContext(picked), used: picked };
}
