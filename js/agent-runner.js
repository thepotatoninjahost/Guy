/* ============================================================
   Gunther · CODING STEP RUNNER

   Adapter between a qualified model call and the safe workspace tool
   loop. The model is never handed filesystem access; it must request
   one of the declared tools, receive the result, and continue.
   ============================================================ */

import { runToolLoop, TOOL_DEFINITIONS } from "./agent-tools.js";
import { listFiles } from "./workspace.js";

const TOOL_RULES = [
  "You are operating a coding workspace through explicit tools.",
  "When you need project information or a change, return ONLY JSON: {\"type\":\"tool\",\"name\":\"...\",\"args\":{...}}.",
  "When the work is complete, return ONLY JSON: {\"type\":\"final\",\"text\":\"what was done and what was verified\"}.",
  "Never claim a test passed unless the workspace or a verification tool actually provided that evidence.",
  "Never use placeholders or pretend that a file was edited.",
].join("\n");

function transcriptText(transcript) {
  return transcript.map((item) => JSON.stringify(item)).join("\n").slice(-18000);
}

export async function runCodingStep({ workspace, goal, instruction, dispatch, maxTurns = 6, onDelta, onTool }) {
  if (!workspace || typeof dispatch !== "function") throw new Error("workspace and dispatch are required");
  const base = [
    TOOL_RULES,
    "PROJECT FILES: " + (listFiles(workspace).join(", ") || "(empty project)"),
    "GOAL: " + String(goal || "").slice(0, 4000),
    "CURRENT STEP: " + String(instruction || "").slice(0, 8000),
  ].join("\n\n");
  let usage = { prompt: 0, completion: 0, total: 0 };
  let lastModel = null;
  const result = await runToolLoop({
    workspace,
    maxTurns,
    ask: async ({ transcript }) => {
      const res = await dispatch({
        system: base,
        messages: [{ role: "user", content: base + "\n\nTOOL TRANSCRIPT:\n" + (transcriptText(transcript) || "(none)") }],
        maxTokens: 4096,
        temperature: 0.2,
        onDelta,
      });
      lastModel = res.model || lastModel;
      usage.prompt += res.usage?.prompt || 0;
      usage.completion += res.usage?.completion || 0;
      usage.total += res.usage?.total || 0;
      return res.text;
    },
    onTool,
  });
  return { ...result, model: lastModel, usage };
}

export { TOOL_DEFINITIONS };
