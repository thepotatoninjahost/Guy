package com.codingagent.agent

import java.time.Instant
import com.codingagent.intake.CodeSynthesisEngine
import com.codingagent.intake.OperationKind
import com.codingagent.intake.SynthesisResult
import com.codingagent.intake.TaskIntake
import com.codingagent.intake.TaskIntent
import com.codingagent.intake.TaskOperation
import com.codingagent.model.ModelGateway
import com.codingagent.workspace.AgentTask
import com.codingagent.workspace.ChangeDiff
import com.codingagent.workspace.MutationCoordinator
import com.codingagent.workspace.MutationProposeResult
import com.codingagent.workspace.PendingChangeProposal
import com.codingagent.workspace.ProjectWorkspace
import com.codingagent.workspace.VerificationReport

/**
 * ONE JOB: Stage an explicit/offline mutation for dual approval without the model loop.
 */
sealed class AgentOfflineMutation {
    data class Approval(val task: AgentTask, val proposal: PendingChangeProposal) : AgentOfflineMutation()
    data class NeedsInput(val task: AgentTask) : AgentOfflineMutation()
    data class Failed(val task: AgentTask) : AgentOfflineMutation()
}

object AgentOfflineStager {
    fun stage(
        taskId: String,
        request: String,
        intake: TaskIntake,
        plan: AgentPlan,
        workspace: ProjectWorkspace,
        knowledge: AgentKnowledge,
        mutations: MutationCoordinator,
        gateway: ModelGateway?
    ): AgentOfflineMutation? {
        val hasExplicit = intake.operation.kind != OperationKind.NONE
        val wantsEdit = hasExplicit ||
            intake.intent == TaskIntent.CREATE ||
            intake.intent == TaskIntent.CHANGE ||
            intake.intent == TaskIntent.REFACTOR
        if (!wantsEdit) return null

        // Old rule: if any model was configured, skip offline staging and hope the model
        // writes files. On free/rate-limited models that became README-only "completed".
        // Empty (or README-only) workspaces now stage locally first so a 429 cannot eat the job.
        val onlyBoilerplate = workspace.summary().files.all { file ->
            val n = file.path.lowercase()
            n.endsWith("readme.md") || n.contains(".coding-agent/")
        }
        // A configured model translates plain English itself — even on empty projects.
        // (Old rule forced vague requests into a code-demanding question loop on new
        // projects: the question-asker ran before the brain, every turn, forever.)
        // Offline synthesis stays for: explicit ops, CREATE scaffolds, and no-model.
        if (!hasExplicit && gateway != null && intake.intent != TaskIntent.CREATE) return null
        if (!hasExplicit && gateway != null && !onlyBoilerplate) return null

        val staged: Pair<List<TaskOperation>, String> = if (hasExplicit) {
            listOf(intake.operation) to "Done on the phone from your exact words (the AI brain couldn't be reached)."
        } else {
            when (val synthesis = CodeSynthesisEngine(workspace.projectRoot(), knowledge).synthesize(intake)) {
                is SynthesisResult.Ready ->
                    synthesis.proposal.operations to synthesis.proposal.rationale
                is SynthesisResult.NeedsInput -> {
                    // No brain configured and nothing concrete to stage: fall through to the
                    // honest "model is not configured" outcome instead of a question loop.
                    // (CREATE keeps its specific plain-English questions: name / replace-or-edit.)
                    if (gateway == null && intake.intent != TaskIntent.CREATE) return null
                    val question = synthesis.question +
                        " Reply in plain words — no code or file names needed unless you know them."
                    val task = AgentTask(
                        taskId, request, "needs-input", plan, emptyList(),
                        VerificationReport(true, emptyList()),
                        listOf("${Instant.now()}: offline staging needs input"),
                        question
                    )
                    return AgentOfflineMutation.NeedsInput(task)
                }
            }
        }

        return when (val proposeResult = mutations.propose(request, staged.first, staged.second)) {
            is MutationProposeResult.Proposed -> {
                val proposal = proposeResult.proposal
                val task = AgentTask(
                    taskId, request, "needs-approval", plan, proposal.changeSet.changes,
                    VerificationReport(true, emptyList()),
                    listOf("${Instant.now()}: offline proposal ${proposal.id} staged; awaiting two owner approvals"),
                    ChangeDiff.ownerReviewText(proposal)
                )
                AgentOfflineMutation.Approval(task, proposal)
            }
            is MutationProposeResult.Rejected -> {
                val message = "Offline mutation staging failed: ${proposeResult.reason}"
                val task = AgentTask(
                    taskId, request, "failed", plan, emptyList(),
                    VerificationReport(false, emptyList()),
                    listOf("${Instant.now()}: $message"),
                    message
                )
                AgentOfflineMutation.Failed(task)
            }
        }
    }
}
