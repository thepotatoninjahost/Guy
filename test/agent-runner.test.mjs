import assert from "node:assert/strict";
import { runCodingStep, TOOL_DEFINITIONS } from "../js/agent-runner.js";
import { createWorkspace, readFile } from "../js/workspace.js";

const ws = createWorkspace("runner");
let n = 0;
const result = await runCodingStep({
  workspace: ws,
  goal: "make a greeting",
  instruction: "create src/greet.js",
  dispatch: async () => {
    n++;
    if (n === 1) return { text: JSON.stringify({ type: "tool", name: "create_file", args: { path: "src/greet.js", content: "export const greet = () => 'hello';" } }), usage: { prompt: 2, completion: 3, total: 5 }, model: { line: 1 } };
    return { text: JSON.stringify({ type: "final", text: "Created src/greet.js and verified its contents." }), usage: { prompt: 2, completion: 3, total: 5 }, model: { line: 1 } };
  },
});
assert.equal(result.status, "complete");
assert.equal(result.results[0].ok, true);
assert.equal(readFile(ws, "src/greet.js"), "export const greet = () => 'hello';");
assert.equal(result.usage.total, 10);
assert.equal(TOOL_DEFINITIONS.length, 5);
console.log("agent runner: 5 passed, 0 failed");
