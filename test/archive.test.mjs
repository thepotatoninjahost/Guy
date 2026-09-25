/* ============================================================
   Gunther · archive test rig — run with:  node test/archive.test.mjs
   The pure logic of THE ARCHIVE: chunking that loses nothing,
   digest parsing, recall that stays silent instead of noisy,
   the store contract, and the honest cost estimates.
   ============================================================ */

import {
  chunkText,
  estimateChunks,
  parseNotes,
  tokenize,
  scoreNote,
  retrieve,
  formatContext,
  openStore,
  newDoc,
  CHUNK_CHARS,
  MAX_CHUNKS,
} from "../js/archive.js";

let passed = 0;
let failed = 0;
const ok = (cond, name) => {
  if (cond) {
    passed++;
    console.log("  ✓ " + name);
  } else {
    failed++;
    console.error("  ✗ " + name);
  }
};

console.log("\n— chunking: nothing lost, nothing oversized —");
const paras = Array.from(
  { length: 100 },
  (_, i) => "Paragraph " + i + " talks about bearings and " + "x".repeat(140) + "."
).join("\n\n");
const cs = chunkText(paras);
ok(cs.length > 1, "a long document splits into multiple chunks");
ok(cs.every((c) => c.length <= CHUNK_CHARS), "no chunk exceeds the size cap");
ok(
  cs.join("\n\n").replace(/\s+/g, " ").length === paras.replace(/\s+/g, " ").length,
  "nothing is lost between chunks — every character survives the packing"
);
const monster = "word ".repeat(CHUNK_CHARS).trim();
ok(
  chunkText(monster).length > 1 && chunkText(monster).every((c) => c.length <= CHUNK_CHARS),
  "a paragraph bigger than the cap is split at whitespace, not mid-word"
);
ok(chunkText("").length === 0, "an empty document yields no chunks");

console.log("\n— digest parsing: structured or blob —");
const notes = parseNotes(
  "### Bearing spec\n- Bronze, 12mm, press-fit.\n- Rated 40 degrees.\n\n### Housing\n- Cast aluminium 6061.",
  "gears.md"
);
ok(notes.length === 2, "two headings, two notes");
ok(notes[0].t === "Bearing spec" && notes[0].b.includes("press-fit"), "title and body split cleanly");
ok(notes.every((n) => n.doc === "gears.md"), "every note remembers the document it came from");
const blob = parseNotes("just a wall of prose with no structure at all", "memo.txt");
ok(blob.length === 1 && blob[0].t.startsWith("just a wall"), "an unstructured answer still becomes one usable note");
ok(parseNotes("").length === 0, "silence yields no notes");

console.log("\n— recall: what a turn actually needs —");
const bank = [
  { t: "Bearing spec", b: "Bronze 12mm press-fit rated forty degrees", doc: "gears.md" },
  { t: "Housing alloy", b: "Cast aluminium 6061 anodized black", doc: "gears.md" },
  { t: "Groq free tier", b: "gpt-oss-120b rate limits rpm windows", doc: "notes.txt" },
];
const hit = retrieve(bank, "what bearing is press fit into the housing?", 5);
ok(hit.length >= 2 && hit[0].t === "Bearing spec", "the question lights up the notes that answer it, best first");
ok(retrieve(bank, "banana smoothie", 5).length === 0, "an unrelated query recalls nothing — silence beats noise");
ok(retrieve(bank, "housing aluminium anodized", 1).length === 1, "k is respected");
const ctx = formatContext(hit);
ok(ctx.includes("ARCHIVE — learned material") && ctx.includes("[gears.md]"), "the injected block names itself and cites its source");
ok(formatContext([]) === "", "no picks, no block — the prompt stays clean");
ok(tokenize("The bearing spec, bronze!").has("bearing") && !tokenize("ab xy").has("ab"), "tokenizer keeps words of 3+ characters");
ok(scoreNote(bank[0], tokenize("bearing bearing bronze")) > scoreNote(bank[1], tokenize("bearing bronze")), "title hits outweigh body hits");

console.log("\n— store contract —");
const store = await openStore();
const d1 = newDoc("first.txt", "hello".repeat(30));
const d2 = newDoc("second.txt", "world".repeat(30));
await store.put(d1);
await store.put(d2);
let all = await store.all();
ok(all.length === 2 && all[0].id === d2.id, "all() returns newest first");
ok(d1.status === "raw" && d1.chars === 150, "newDoc stamps honest metadata");
await store.put({ ...d1, status: "learned", notes: [{ t: "x", b: "y", doc: "first.txt" }] });
all = await store.all();
ok(all.find((d) => d.id === d1.id).status === "learned", "put() overwrites by id — documents update in place");
await store.del(d2.id);
all = await store.all();
ok(all.length === 1 && all[0].id === d1.id, "del() forgets completely");
ok(store.kind === "memory", "no IndexedDB in the node rig — the memory fallback keeps the same API");

console.log("\n— cost honesty —");
const big = Array.from({ length: MAX_CHUNKS * 60 }, (_, i) => "para " + i + " " + "y".repeat(200)).join("\n\n");
ok(estimateChunks(big) > MAX_CHUNKS, "huge documents measure honestly big — the estimate does not flinch");
ok(chunkText(big).slice(0, MAX_CHUNKS).length === MAX_CHUNKS, "the digest cap is enforced at the queue — one document cannot quietly spend a vendor's day");

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
