/* ============================================================
   Gunther · WORKSPACE TOOL LOOP

   Models do not get raw access to the project. They receive a small,
   explicit tool surface, and every mutation goes through the safe
   workspace transaction layer. A failed edit cannot half-change a
   project. The loop is provider-neutral so it can later be attached
   to any qualified coding model.
   ============================================================ */

import { deleteFile, listFiles, readFile, replaceExact, snapshot, transaction, writeFile } from "./workspace.js";
import { renderRunText } from "./evidence.js";

export const TOOL_DEFINITIONS = [
  { name: "list_files", description: "List every file in the current project", mutates: false },
  { name: "read_file", description: "Read one complete project file", mutates: false, required: ["path"] },
  { name: "create_file", description: "Create or replace a project file", mutates: true, required: ["path", "content"] },
  { name: "edit_file", description: "Replace one exact, unique passage in a project file", mutates: true, required: ["path", "before", "after"] },
  { name: "delete_file", description: "Delete one project file", mutates: true, required: ["path"] },
  {
    name: "run_command",
    description:
      "Run one command that the project declares in gunther.project.json and read its real exit code and output. Commands the project does not declare cannot be run.",
    mutates: false,
    required: ["name"],
  },
];

const definition = (name) => TOOL_DEFINITIONS.find((x) => x.name === name) || null;
const argsObject = (args) => (args && typeof args === "object" && !Array.isArray(args) ? args : {});

export function executeTool(workspace, name, rawArgs = {}, ctx = {}) {
  const def = definition(name);
  if (!def) return { ok: false, name, error: "unknown tool: " + name };
  const args = argsObject(rawArgs);
  for (const key of def.required || []) {
    if (args[key] == null || String(args[key]).length === 0) return { ok: false, name, error: "missing argument: " + key };
  }
  if (name === "run_command") return runDeclaredCommand(name, args, ctx);
  try {
    if (name === "list_files") return { ok: true, name, files: listFiles(workspace) };
    if (name === "read_file") return { ok: true, name, path: args.path, content: readFile(workspace, args.path) };
    if (name === "create_file") {
      const tx = transaction(workspace, (ws) => writeFile(ws, args.path, args.content, { language: args.language }));
      return tx.ok ? { ok: true, name, path: args.path, revision: workspace.revision } : { ok: false, name, error: tx.error };
    }
    if (name === "edit_file") {
      const tx = transaction(workspace, (ws) => replaceExact(ws, args.path, args.before, args.after));
      return tx.ok ? { ok: true, name, path: args.path, revision: workspace.revision } : { ok: false, name, error: tx.error };
    }
    if (name === "delete_file") {
      const tx = transaction(workspace, (ws) => {
        if (!deleteFile(ws, args.path)) throw new Error("file not found: " + args.path);
        return true;
      });
      return tx.ok ? { ok: true, name, path: args.path, revision: workspace.revision } : { ok: false, name, error: tx.error };
    }
  } catch (error) {
    return { ok: false, name, error: error instanceof Error ? error.message : String(error) };
  }
  return { ok: false, name, error: "tool has no implementation: " + name };
}

/**
 * run_command is deliberately narrow. The model may only run commands that
 * the project itself declares AND that a human has approved, and only a
 * bounded number of times per step. A model cannot author itself a passing
 * command mid-task, and it cannot shell its way around the tool surface.
 */
async function runDeclaredCommand(name, args, ctx) {
  const allowed = Array.isArray(ctx.allowedCommands) ? ctx.allowedCommands : [];
  if (!allowed.length) {
    return {
      ok: false,
      name,
      error:
        "this project declares no runnable command (or none has been approved yet) — Gunther does not invent verification commands",
    };
  }
  const wanted = String(args.name || "").trim();
  const command = allowed.find((c) => c.name === wanted);
  if (!command) {
    return { ok: false, name, error: "not an allowed command: " + wanted + " — allowed: " + allowed.map((c) => c.name).join(", ") };
  }
  const budget = ctx.budget && typeof ctx.budget === "object" ? ctx.budget : null;
  if (budget) {
    const max = Number(budget.max) || 4;
    if ((Number(budget.used) || 0) >= max) {
      return { ok: false, name, error: "the command budget for this step is exhausted (" + max + " runs)" };
    }
    budget.used = (Number(budget.used) || 0) + 1;
  }
  if (typeof ctx.run !== "function") {
    return { ok: false, name, error: "this environment has no command host — the command was not run" };
  }
  const outcome = await ctx.run(command);
  const record = outcome && outcome.record ? outcome.record : null;
  if (!record) return { ok: false, name, error: "the host returned no command record" };
  return {
    ok: Boolean(outcome.ok),
    name,
    command: command.name,
    argv: record.argv,
    ran: record.ran,
    exitCode: record.code,
    timedOut: record.timedOut,
    truncated: record.truncated,
    hostError: record.error || "",
    output: renderRunText(record, 8000),
  };
}

export function parseToolResponse(raw) {
  if (raw && typeof raw === "object") return raw;
  const text = String(raw || "").trim();
  const body = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try { return JSON.parse(body); } catch { return { type: "final", text }; }
}

export function toolCallFrom(response) {
  const value = parseToolResponse(response);
  if (!value || typeof value !== "object") return null;
  if (value.type === "tool" && typeof value.name === "string") return { name: value.name, args: argsObject(value.args) };
  if (value.tool && typeof value.tool === "string") return { name: value.tool, args: argsObject(value.args) };
  return null;
}

/**
 * Run a bounded model/tool conversation. `ask` is deliberately injected:
 * the transport adapter supplies the model call, while this loop remains
 * fully testable without network access. The model must return either
 * {type:"tool",name,args} or {type:"final",text}.
 */
export async function runToolLoop({ workspace, ask, maxTurns = 8, onTool, toolContext = {} }) {
  if (!workspace || typeof ask !== "function") throw new Error("workspace and ask are required");
  const transcript = [];
  const results = [];
  for (let turn = 0; turn < maxTurns; turn++) {
    const answer = await ask({ turn, transcript: transcript.slice() });
    const parsed = parseToolResponse(answer);
    const call = toolCallFrom(parsed);
    if (!call) {
      const text = parsed && parsed.type === "final" ? String(parsed.text || "") : String(answer || "");
      return { status: "complete", text, turns: turn + 1, transcript, results };
    }
    const result = await executeTool(workspace, call.name, call.args, toolContext);
    transcript.push({ role: "assistant", tool: call.name, args: call.args });
    transcript.push({ role: "tool", name: call.name, result });
    results.push(result);
    if (typeof onTool === "function") onTool(call, result);
  }
  return { status: "limit", text: "tool loop stopped at its safety limit", turns: maxTurns, transcript, results };
}

export function workspaceSnapshot(workspace) {
  return snapshot(workspace);
}
