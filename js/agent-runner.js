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
  "Never claim a test or build passed unless a COMMAND RECORD in the transcript shows exit code 0.",
  "A command that did not run has no exit code. Never report one as passed or failed on your own authority.",
  "Never use placeholders or pretend that a file was edited.",
].join("\n");

const COMMAND_RULES = [
  "This project declares runnable commands. You may execute them with run_command, for example {\"type\":\"tool\",\"name\":\"run_command\",\"args\":{\"name\":\"verify\"}}.",
  "The declared commands are: ",
  "You cannot run anything else — undeclared commands are refused. Read the real output and repair the cause of a failure.",
].join("\n");

function transcriptText(transcript) {
  return transcript.map((item) => JSON.stringify(item)).join("\n").slice(-18000);
}

export async function runCodingStep({ workspace, goal, instruction, dispatch, maxTurns = 6, onDelta, onTool, toolContext = {} }) {
  if (!workspace || typeof dispatch !== "function") throw new Error("workspace and dispatch are required");
  const allowed = Array.isArray(toolContext.allowedCommands) ? toolContext.allowedCommands : [];
  const commandRules = allowed.length
    ? COMMAND_RULES.replace("The declared commands are: ", "The declared commands are: " + allowed.map((c) => c.name + " → " + (c.argv || []).join(" ")).join(" · "))
    : "This project declares no runnable command. You cannot execute anything: describe the change, and say plainly that it is not verified by execution.";
  const base = [
    TOOL_RULES,
    commandRules,
    "PROJECT FILES: " + (listFiles(workspace).join(", ").slice(0, 4000) || "(empty project)"),
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
    toolContext,
  });
  return { ...result, model: lastModel, usage };
}

export { TOOL_DEFINITIONS };
