/* ============================================================
   Gunther · VERIFIED STEP LOOP

   A step is not finished when the model says it is. It is finished
   when the project's own declared command has been executed against
   the written files and the host reported exit 0.

   So the shape of a step is:

     write (through the controlled tools)
       → flush the workspace into the real directory
       → run the project's declared command
       → if it failed, hand the model the ACTUAL output and try again
       → stop on pass, or stop honestly with the last real failure

   Every attempt is bounded, every command record is kept, and a step
   with no declared command is reported as unverified rather than
   passed. Model prose never ends this loop.
   ============================================================ */

import { flushWorkspace } from "./project.js";
import { executeCommand, renderRunText, runPassed } from "./evidence.js";

export const MAX_REPAIR_ATTEMPTS = 2;

/**
 * Run one plan step with verification and repair.
 *
 * runStep(instruction, attempt) → { ok, text, model, usage, turns, error? }
 * The caller owns the model call and the tool loop; this module owns the
 * evidence, the flush, and the decision about what "done" means.
 */
export async function verifiedStep(options) {
  const {
    project,
    workspace,
    baseline,
    command = null,
    state = null,
    task = null,
    stepId = null,
    instruction = "",
    goal = "",
    runStep,
    verifyHelper = null,
    maxRepairs = MAX_REPAIR_ATTEMPTS,
    onPhase = () => {},
    onRun = () => {},
    onFlush = () => {},
  } = options;

  if (typeof runStep !== "function") throw new Error("runStep is required");

  const attempts = [];
  const runs = [];
  let repairs = 0;
  let instructionNow = instruction;

  for (;;) {
    onPhase({ phase: repairs ? "repairing" : "coding", attempt: repairs });
    let stepResult;
    try {
      stepResult = await runStep(instructionNow, repairs);
    } catch (error) {
      return {
        status: "halted",
        attempts,
        runs,
        repairs,
        code: error && error.code ? error.code : "",
        error: error && (error.msg || error.note || error.message) ? error.msg || error.note || error.message : String(error),
        text: "",
      };
    }
    attempts.push({
      kind: repairs ? "repair" : "build",
      text: stepResult && stepResult.text ? String(stepResult.text) : "",
      model: (stepResult && stepResult.model) || null,
      usage: (stepResult && stepResult.usage) || null,
      turns: (stepResult && stepResult.turns) || 0,
    });

    // 1) the real directory is the truth — write the changes there first
    const flush = await flushWorkspace(workspace, project.id, baseline);
    onFlush(flush);
    if (flush.errors.length) {
      return {
        status: "failed",
        attempts,
        runs,
        repairs,
        flush,
        text: attempts[attempts.length - 1].text,
        reason:
          "the changes could not be written to the project: " +
          flush.errors.map((e) => e.path + " (" + e.message + ")").join("; "),
      };
    }

    // 2) verification
    if (!command) {
      return {
        status: "unverified",
        attempts,
        runs,
        repairs,
        flush,
        text: attempts[attempts.length - 1].text,
        reason: "no verification command is declared for this project",
      };
    }

    const { record } = await executeCommand({
      projectId: project.id,
      command,
      trigger: repairs ? "repair" : "auto",
      task,
      stepId,
      state,
    });
    runs.push(record);
    onRun(record, flush);

    if (runPassed(record)) {
      return { status: "done", attempts, runs, repairs, flush, text: attempts[attempts.length - 1].text, command };
    }

    // 3) repair, with the real output in hand
    if (repairs >= maxRepairs) {
      return {
        status: "failed",
        attempts,
        runs,
        repairs,
        flush,
        command,
        text: attempts[attempts.length - 1].text,
        reason:
          record.ran === false
            ? "the verification command could not be run: " + record.error
            : "the verification command still fails after " + repairs + " repair attempt(s)",
      };
    }
    repairs += 1;

    const hint = typeof verifyHelper === "function" ? verifyHelper(record) : "";
    instructionNow = [
      "REPAIR THIS PROJECT — the project's own verification command was executed and it did not pass.",
      "",
      "GOAL: " + String(goal || "").slice(0, 800),
      "STEP: " + String(instruction || "").slice(0, 800),
      "",
      renderRunText(record),
      "",
      hint,
      "Fix the cause in the project files using the workspace tools. Do not weaken or delete the check, " +
        "do not claim it passes, and do not stop until you have a concrete change. " +
        "You may run the command again with run_command to see the real result.",
    ]
      .filter((line) => line !== "")
      .join("\n");
  }
}
