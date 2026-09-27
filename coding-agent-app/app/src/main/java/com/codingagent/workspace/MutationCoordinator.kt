package com.codingagent.workspace

import java.util.UUID
import com.codingagent.agent.AgentAction
import com.codingagent.agent.AgentActionCategory
import com.codingagent.agent.AgentConstitution
import com.codingagent.agent.ApprovalLedger
import com.codingagent.agent.ApprovalRecord
import com.codingagent.agent.ConstitutionRule
import com.codingagent.agent.SelfEvolution
import com.codingagent.agent.SelfRepair
import com.codingagent.intake.TaskOperation

/**
 * ONE JOB: Dual-approval staging, constitution checks, and apply/reject of code changes.
 */
sealed class MutationProposeResult {
    data class Proposed(val proposal: PendingChangeProposal) : MutationProposeResult()
    data class Rejected(val reason: String) : MutationProposeResult()
}

sealed class MutationApprovalResult {
    data class AwaitingSecond(
        val proposal: PendingChangeProposal,
        val approval: ApprovalRecord,
        val missingType: ApprovalType? = null
    ) : MutationApprovalResult()
    data class Applied(val proposal: PendingChangeProposal, val changeSet: ChangeSet) : MutationApprovalResult()
    data class Rejected(val reason: String) : MutationApprovalResult()
}

data class PendingChangeProposal(
    val id: String,
    val request: String,
    val changeSet: ChangeSet,
    val verification: VerificationReport,
    val createdAt: Long,
    val expiresAt: Long,
    val approvals: List<ApprovalRecord> = emptyList()
) {
    val approvalCount: Int get() = approvals.size
}

class MutationCoordinator(
    internal val workspace: ProjectWorkspace,
    private val ledger: ApprovalLedger = ApprovalLedger(),
    private val now: () -> Long = { System.currentTimeMillis() }
) {
    private val pending = linkedMapOf<String, PendingChangeProposal>()
    private val approvalTypes = mutableMapOf<String, MutableList<String>>()
    private val evolution = SelfEvolution(workspace.projectRoot())

    init {
        OpenJobStore.bind(workspace.projectRoot())
        PendingProposalStore.load(workspace.projectRoot()).forEach { pending[it.id] = it }
        PendingProposalStore.loadTypes(workspace.projectRoot()).forEach { (id, types) ->
            approvalTypes[id] = types.toMutableList()
        }
    }

    @Synchronized
    fun propose(
        request: String,
        operations: List<TaskOperation>,
        reason: String = request
    ): MutationProposeResult {
        if (request.isBlank()) return MutationProposeResult.Rejected("A mutation request is required")
        if (operations.isEmpty()) return MutationProposeResult.Rejected("At least one mutation operation is required")

        val changeSet = runCatching { workspace.preview(operations, reason) }
            .getOrElse { ex ->
                return MutationProposeResult.Rejected(
                    "Preview failed: ${ex.message.orEmpty().ifBlank { ex.javaClass.simpleName }}"
                )
            }

        if (changeSet.changes.isEmpty()) return MutationProposeResult.Rejected("Mutation proposal contains no changes")

        val verification = runCatching { workspace.verifyProposal(changeSet) }
            .getOrElse { ex ->
                return MutationProposeResult.Rejected(
                    "Verification failed: ${ex.message.orEmpty().ifBlank { ex.javaClass.simpleName }}"
                )
            }

        if (!verification.passed) {
            return MutationProposeResult.Rejected(
                "Mutation proposal failed verification: ${verification.issues.joinToString { it.message }}"
            )
        }

        val timestamp = now()
        val proposal = PendingChangeProposal(
            id = UUID.randomUUID().toString(),
            request = request,
            changeSet = changeSet,
            verification = verification,
            createdAt = timestamp,
            expiresAt = timestamp + AgentConstitution.APPROVAL_EXPIRATION_MS
        )
        pending[proposal.id] = proposal
        persist()
        OpenJobStore.markWaiting(
            workspace.projectRoot(),
            proposal.id,
            proposal.changeSet.changes.map { it.path }.distinct(),
            request
        )
        return MutationProposeResult.Proposed(proposal)
    }

    @Synchronized
    fun get(id: String): PendingChangeProposal? = pending[id]

    @Synchronized
    fun approve(
        id: String,
        ownerVerified: Boolean,
        ownerLabel: String,
        approvalType: ApprovalType
    ): MutationApprovalResult {
        val proposal = pending[id] ?: return MutationApprovalResult.Rejected("Change proposal does not exist")
        val timestamp = now()
        if (timestamp > proposal.expiresAt) {
            return MutationApprovalResult.Rejected(
                "Change proposal approval window expired. Open Review, reject, and the agent will restage the same files."
            )
        }
        if (!ownerVerified) return MutationApprovalResult.Rejected("Owner verification is required for every approval")
        val approval = ledger.record(id, ownerLabel, timestamp)
        val candidate = proposal.copy(approvals = proposal.approvals + approval)
        val action = AgentAction(
            description = proposal.request,
            category = AgentActionCategory.CODE_CHANGE,
            ownerVerified = ownerVerified,
            approvalCount = candidate.approvalCount,
            sandboxPassed = proposal.verification.passed,
            clearPermission = true
        )
        val violations = AgentConstitution.check(action, timestamp, proposal.createdAt)
        // The owner's law: one tap plus one typed word — two genuinely different acts.
        // Legacy approvals predate types and satisfy neither side of the pair.
        val types = approvalTypes.getOrPut(id) { mutableListOf() }
        while (types.size < proposal.approvals.size) types += "UNKNOWN"
        types += approvalType.name
        persistTypes()
        val haveTap = types.contains(ApprovalType.TAP.name)
        val haveWord = types.contains(ApprovalType.WORD.name)
        val missingType = when {
            haveTap && haveWord -> null
            haveTap -> ApprovalType.WORD
            haveWord -> ApprovalType.TAP
            else -> approvalType // unreachable: a type was just recorded
        }
        if (violations.isNotEmpty()) {
            pending[id] = candidate
            persist()
            return if (candidate.approvalCount < 2 && violations.none {
                    it.rule == ConstitutionRule.OWNER_LOCK ||
                        it.rule == ConstitutionRule.SANDBOX_FIRST ||
                        it.rule == ConstitutionRule.PERMISSION_EXPIRATION
                }
            ) {
                MutationApprovalResult.AwaitingSecond(candidate, approval, missingType)
            } else {
                MutationApprovalResult.Rejected(violations.joinToString("; ") { "${it.rule}: ${it.message}" })
            }
        }
        if (missingType != null) {
            pending[id] = candidate
            persist()
            return MutationApprovalResult.AwaitingSecond(candidate, approval, missingType)
        }
        return try {
            val applied = workspace.applyApproved(proposal.changeSet)
            pending.remove(id)
            approvalTypes.remove(id)
            persist()
            persistTypes()
            OpenJobStore.markApplied(workspace.projectRoot())
            recordEvolution(candidate, applied)
            MutationApprovalResult.Applied(candidate, applied)
        } catch (error: Exception) {
            MutationApprovalResult.Rejected("Approved change could not be applied: ${error.message.orEmpty()}")
        }
    }

    @Synchronized
    fun pending(): List<PendingChangeProposal> = pending.values.toList()

    @Synchronized
    fun clear(id: String): Boolean {
        val gone = pending.remove(id) != null
        if (gone) {
            approvalTypes.remove(id)
            persist()
            persistTypes()
        }
        return gone
    }

    @Synchronized
    fun reject(id: String): Boolean {
        val gone = pending.remove(id) != null
        if (gone) {
            approvalTypes.remove(id)
            persist()
            persistTypes()
        }
        return gone
    }

    private fun persistTypes() {
        PendingProposalStore.saveTypes(workspace.projectRoot(), approvalTypes)
    }

    @Synchronized
    fun clearExpired() {
    }

    @Synchronized
    fun refreshExpiry(id: String): PendingChangeProposal? {
        val current = pending[id] ?: return null
        val refreshed = current.copy(expiresAt = now() + AgentConstitution.APPROVAL_EXPIRATION_MS)
        pending[id] = refreshed
        persist()
        return refreshed
    }

    private fun recordEvolution(proposal: PendingChangeProposal, changeSet: ChangeSet) {
        runCatching {
            val latestApproval = proposal.approvals.maxOfOrNull { it.approvedAt }
            val kind = if (SelfRepair.isRequest(proposal.request)) "self-repair" else "code-change"
            changeSet.changes.forEach { change ->
                val file = workspace.projectRoot().resolve(change.path)
                if (!file.isFile) return@forEach
                val staged = evolution.stageSource(file, kind)
                val action = AgentAction(
                    description = proposal.request,
                    category = AgentActionCategory.CODE_CHANGE,
                    ownerVerified = true,
                    approvalCount = proposal.approvalCount,
                    sandboxPassed = proposal.verification.passed,
                    clearPermission = true
                )
                evolution.promoteSource(staged, kind, proposal.verification, action, latestApproval)
            }
        }
    }

    private fun persist() {
        runCatching { PendingProposalStore.save(workspace.projectRoot(), pending.values.toList()) }
    }
}
