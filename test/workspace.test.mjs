import assert from "node:assert/strict";
import { createWorkspace, deleteFile, importFiles, listFiles, readFile, replaceExact, snapshot, transaction, validateWorkspace, writeFile } from "../js/workspace.js";

const ws = createWorkspace("demo");
assert.equal(validateWorkspace(ws), true);
importFiles(ws, { "src/app.js": "export const answer = 41;\n", "README.md": "# demo\n" });
assert.deepEqual(listFiles(ws), ["README.md", "src/app.js"]);
assert.equal(readFile(ws, "src/app.js"), "export const answer = 41;\n");
replaceExact(ws, "src/app.js", "41", "42");
assert.match(readFile(ws, "src/app.js"), /42/);
assert.throws(() => replaceExact(ws, "src/app.js", "missing", "x"), /anchor not found/);
writeFile(ws, "src/test.js", "export {};", { language: "javascript" });
assert.equal(deleteFile(ws, "src/test.js"), true);
assert.equal(deleteFile(ws, "src/test.js"), false);
assert.throws(() => writeFile(ws, "../escape", "bad"), /unsafe/);
const before = snapshot(ws);
const failed = transaction(ws, (draft) => {
  writeFile(draft, "src/app.js", "broken");
  throw new Error("verification failed");
});
assert.equal(failed.ok, false);
assert.equal(readFile(ws, "src/app.js"), readFile(before, "src/app.js"));
const passed = transaction(ws, (draft) => writeFile(draft, "src/app.js", "fixed"));
assert.equal(passed.ok, true);
assert.equal(readFile(ws, "src/app.js"), "fixed");
assert.equal(validateWorkspace(ws), true);
console.log("workspace: 15 passed, 0 failed");
