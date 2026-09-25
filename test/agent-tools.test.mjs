import assert from "node:assert/strict";
import { executeTool, parseToolResponse, runToolLoop, toolCallFrom } from "../js/agent-tools.js";
import { createWorkspace, readFile } from "../js/workspace.js";

const ws = createWorkspace("tools");
assert.deepEqual(executeTool(ws, "list_files").files, []);
assert.equal(executeTool(ws, "create_file", { path: "src/main.js", content: "export const n = 1;" }).ok, true);
assert.equal(executeTool(ws, "edit_file", { path: "src/main.js", before: "1", after: "2" }).ok, true);
assert.equal(readFile(ws, "src/main.js"), "export const n = 2;");
assert.equal(executeTool(ws, "edit_file", { path: "src/main.js", before: "missing", after: "x" }).ok, false);
assert.equal(readFile(ws, "src/main.js"), "export const n = 2;");
assert.equal(executeTool(ws, "read_file", { path: "src/main.js" }).content, "export const n = 2;");
assert.equal(executeTool(ws, "nope").ok, false);
assert.deepEqual(toolCallFrom('{"type":"tool","name":"list_files","args":{}}'), { name: "list_files", args: {} });
assert.equal(parseToolResponse("not JSON").type, "final");

let calls = 0;
const loop = await runToolLoop({
  workspace: ws,
  maxTurns: 4,
  ask: async () => {
    calls++;
    if (calls === 1) return { type: "tool", name: "create_file", args: { path: "README.md", content: "# built" } };
    return { type: "final", text: "Created the project file." };
  },
});
assert.equal(loop.status, "complete");
assert.equal(loop.results[0].ok, true);
assert.equal(readFile(ws, "README.md"), "# built");
const limited = await runToolLoop({ workspace: ws, maxTurns: 2, ask: async () => ({ type: "tool", name: "list_files", args: {} }) });
assert.equal(limited.status, "limit");
assert.equal(limited.turns, 2);
console.log("agent tools: 14 passed, 0 failed");
