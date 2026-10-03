package com.codingagent.agent

import java.util.UUID
import com.codingagent.workspace.AgentPlan
import com.codingagent.workspace.AgentTask
import com.codingagent.workspace.ChangeDiff
import com.codingagent.workspace.OpenJobStore
import com.codingagent.workspace.VerificationReport

/**
 * ONE JOB: Chat turn → agent execution → persisted history.
 */
enum class ChatRole { USER, AGENT, SYSTEM }

data class ChatMessage(
    val id: String = UUID.randomUUID().toString(),
    val role: ChatRole,
    val content: String,
    val createdAt: Long = System.currentTimeMillis(),
    val taskId: String? = null
)

interface ChatMessageStore {
    fun recordChatMessage(message: ChatMessage)
    fun recentChatMessages(limit: Int = 100): List<ChatMessage>
}

fun interface CodingAgentExecutor {
    fun execute(request: String): AgentRuntimeResult
}

fun interface AgentProgressListener {
    fun onProgress(phase: String, detail: String)
}

class ChatWorkspace(
    private val store: ChatMessageStore,
    private val unavailableMessageProvider: () -> String = { "Model unavailable. Finish model setup before sending coding requests." },
    private val progressListener: AgentProgressListener? = null,
    private val runtimeProvider: () -> AutonomousAgent?
) {
    companion object {
        /** System marker recorded on project switch; memory before it belongs to another project. */
        const val PROJECT_SWITCH_MARKER = "PROJECT SWITCH —"

        /** Drops conversation from before the most recent project switch (marker itself kept). */
        fun scopeToCurrentProject(prior: List<ChatMessage>): List<ChatMessage> {
            val idx = prior.indexOfLast { it.role == ChatRole.SYSTEM && it.content.startsWith(PROJECT_SWITCH_MARKER) }
            return if (idx >= 0) prior.drop(idx) else prior
        }
    }
    fun history(limit: Int = 100): List<ChatMessage> = store.recentChatMessages(limit).asReversed()

    fun send(request: String): ChatTurn {
        var trimmed = request.trim()
        require(trimmed.isNotEmpty()) { "A message is required" }
        store.recordChatMessage(ChatMessage(role = ChatRole.USER, content = trimmed))
        if (com.codingagent.workspace.OwnerLaws.isLawMessage(trimmed)) {
            val workPart = extractTrailingWork(trimmed)
            if (workPart == null) {
                val fresh = com.codingagent.workspace.OwnerLaws.add(OpenJobStore.boundRoot(), trimmed)
                val ack = when {
                    !fresh -> "That's already one of my standing laws. I won't break it."
                    else -> "Locked in — standing law: \"$trimmed\". I won't break it."
                }
                val task = AgentTask(
                    UUID.randomUUID().toString(), trimmed, "completed",
                    AgentPlan(trimmed, emptyList(), emptyList()), emptyList(),
                    VerificationReport(true, emptyList()),
                    listOf("${java.time.Instant.now()}: owner law recorded"),
                    ack
                )
                return persist(result = AgentRuntimeResult.Completed(task))
            }
            // Mixed "law + work" order: store the law part, then fall through
            // and run the work part below. The law is never swallowed, and the
            // work is never swallowed either.
            val lawPart = trimmed.substring(0, trimmed.length - workPart.length).trim().trimEnd(',', ';', '.', '!', '?').trim()
            com.codingagent.workspace.OwnerLaws.add(OpenJobStore.boundRoot(), lawPart)
            store.recordChatMessage(ChatMessage(role = ChatRole.AGENT, content = "Locked in — standing law: \"$lawPart\". Now on with the work."))
            trimmed = workPart
        } else {
            // Work-shaped messages can still carry law clauses ("build it, never use red"):
            // store those too; the full text still runs as work below.
            storeLawClauses(trimmed)
        }
        val agent = runtimeProvider()
        if (agent != null && looksLikeNewGoal(trimmed)) {
            OpenJobStore.boundRoot()?.let { OpenJobStore.openOrKeep(it, trimmed) }
        }
        val approval = agent?.let { ChatApproval.tryApprove(it, trimmed) }
        if (approval != null) {
            progressListener?.onProgress("APPROVAL", approval.toString().take(80))
            return persist(result = approval)
        }
        val lastAgent = store.recentChatMessages(20).firstOrNull { it.role == ChatRole.AGENT }?.content
        val resumed = agent?.let { PendingWorkResume.tryResume(it, trimmed, lastAgent) }
        if (resumed != null) {
            progressListener?.onProgress("RESUME", "Local pending work / rate-limit gate")
            return persist(result = resumed)
        }
        progressListener?.onProgress("PLANNING", "Starting request")
        val pending = OpenJobStore.peekPending()
        val fused = if (pending != null) OpenJobStore.fuseAnswer(pending.first, pending.second, trimmed) else trimmed
        val packaged = packageWithMemory(fused)
        val workLog = mutableListOf<String>()
        val result = if (agent == null) {
            null
        } else {
            val events = agent.run(packaged) { event ->
                when (event) {
                    is AutonomousAgentEvent.Phase -> {
                        if (event.name == "PURPOSE" && event.detail.isNotBlank()) workLog += event.detail
                        progressListener?.onProgress(event.name, event.detail)
                    }
                    is AutonomousAgentEvent.ToolStarted -> {
                        val purpose = event.purpose.ifBlank { "${event.name}: ${event.arguments.take(80)}" }
                        workLog += purpose
                        progressListener?.onProgress("TOOL", purpose.take(120))
                    }
                    is AutonomousAgentEvent.ToolFinished -> progressListener?.onProgress(
                        "TOOL",
                        if (event.success) "${event.name} ok" else "${event.name} failed"
                    )
                    is AutonomousAgentEvent.ModelDelta -> progressListener?.onProgress("MODEL", "Streaming… ${event.text.take(40)}")
                    is AutonomousAgentEvent.ModelMessage -> progressListener?.onProgress("MODEL", "Writing reply")
                    is AutonomousAgentEvent.Started -> progressListener?.onProgress("STARTED", event.request.take(60))
                    is AutonomousAgentEvent.Completed -> progressListener?.onProgress("DONE", "Completed")
                    is AutonomousAgentEvent.Failed -> progressListener?.onProgress("FAILED", event.message.take(120))
                    is AutonomousAgentEvent.Stopped -> progressListener?.onProgress("STOPPED", event.message.take(120))
                    is AutonomousAgentEvent.ApprovalRequired -> progressListener?.onProgress("APPROVAL", "Waiting for owner approval")
                }
            }
            when (val terminal = events.lastOrNull()) {
                is AutonomousAgentEvent.ApprovalRequired -> AgentRuntimeResult.NeedsApproval(
                    terminal.task,
                    ChangeDiff.ownerReviewText(terminal.proposal),
                    terminal.proposal.id
                )
                is AutonomousAgentEvent.Completed -> asRuntime(agent, terminal.task)
                is AutonomousAgentEvent.Stopped -> AgentRuntimeResult.Failed(terminal.task)
                is AutonomousAgentEvent.Failed -> terminal.task?.let { AgentRuntimeResult.Failed(it) }
                    ?: AgentRuntimeResult.Failed(
                        AgentTask(
                            id = UUID.randomUUID().toString(),
                            request = trimmed,
                            status = "failed",
                            plan = AgentPlan(trimmed, emptyList(), emptyList()),
                            changes = emptyList(),
                            verification = VerificationReport(false, emptyList()),
                            events = emptyList(),
                            summary = terminal.message
                        )
                    )
                else -> asRuntime(agent, null) ?: agent.execute(packaged)
            }
        }
        return persist(result, workLog)
    }

    private fun asRuntime(agent: AutonomousAgent, task: AgentTask?): AgentRuntimeResult? {
        if (task == null) return null
        if (task.status == "needs-approval" || task.status == "waiting-approval") {
            val proposal = agent.pendingProposals().firstOrNull()
            if (proposal != null) {
                return AgentRuntimeResult.NeedsApproval(task, ChangeDiff.ownerReviewText(proposal), proposal.id)
            }
        }
        return AgentRuntimeResult.Completed(task)
    }

    private fun persist(result: AgentRuntimeResult?, workLog: List<String> = emptyList()): ChatTurn {
        val journaled = workLog + com.codingagent.workspace.FailureJournal.drain().map { "Notice: $it" }
        val root = OpenJobStore.boundRoot()
        if (root != null) {
            when (result) {
                is AgentRuntimeResult.NeedsApproval -> {
                    OpenJobStore.clearPending()
                    OpenJobStore.markWaiting(
                        root,
                        result.proposalId,
                        result.task.changes.map { it.path }.distinct(),
                        result.task.request
                    )
                }
                is AgentRuntimeResult.NeedsInput -> {
                    val goal = OpenJobStore.loadBound()?.goal?.takeIf { it.isNotBlank() } ?: result.task.request
                    OpenJobStore.noteQuestion(goal, result.question)
                }
                is AgentRuntimeResult.Completed -> {
                    OpenJobStore.clearPending()
                    if (result.task.status.contains("applied", ignoreCase = true)) {
                        OpenJobStore.markApplied(root)
                    }
                }
                else -> OpenJobStore.clearPending()
            }
        }
        val response = when (result) {
            is AgentRuntimeResult.Completed -> ChatMessage(role = ChatRole.AGENT, content = formatTask(result.task, journaled), taskId = result.task.id)
            is AgentRuntimeResult.NeedsInput -> ChatMessage(role = ChatRole.AGENT, content = result.question, taskId = result.task.id)
            is AgentRuntimeResult.NeedsApproval -> ChatMessage(role = ChatRole.AGENT, content = result.question, taskId = result.task.id)
            is AgentRuntimeResult.Failed -> ChatMessage(role = ChatRole.AGENT, content = formatTask(result.task, journaled), taskId = result.task.id)
            null -> ChatMessage(role = ChatRole.SYSTEM, content = unavailableMessageProvider())
        }
        store.recordChatMessage(response)
        return ChatTurn(response, result)
    }

    /**
     * Splits a law-shaped message ("never X, build Y") into its trailing work
     * request. Returns null for pure laws. A trailing clause counts as work
     * when it is not itself law-shaped and reads as a new goal.
     */
    private fun extractTrailingWork(text: String): String? {
        val sentences = text.split(Regex("[.!?;\n]+")).map { it.trim() }.filter { it.isNotEmpty() }
        if (sentences.size > 1) {
            val tail = sentences.last()
            if (!com.codingagent.workspace.OwnerLaws.isLawMessage(tail) && looksLikeNewGoal(tail)) return tail
            return null
        }
        val idx = text.indexOf(',')
        if (idx < 0) return null
        val tail = text.substring(idx + 1).trim().trimEnd(',', '.', '!', '?', ';').trim()
        if (tail.isEmpty() || com.codingagent.workspace.OwnerLaws.isLawMessage(tail)) return null
        return if (looksLikeNewGoal(tail)) tail else null
    }

    /** Stores any law-shaped clauses inside work text ("build it, never use red"). */
    private fun storeLawClauses(text: String) {
        val clauses = text.split(Regex("[.!?;\n,]+")).map { it.trim() }.filter { it.isNotEmpty() }
        val fresh = clauses.filter { com.codingagent.workspace.OwnerLaws.isLawMessage(it) }
            .filter { com.codingagent.workspace.OwnerLaws.add(OpenJobStore.boundRoot(), it) }
        if (fresh.isNotEmpty()) {
            store.recordChatMessage(ChatMessage(role = ChatRole.AGENT, content = "Noted — also saved as a standing law: \"${fresh.joinToString("; ")}\"."))
        }
    }

    private fun looksLikeNewGoal(text: String): Boolean {
        val t = text.lowercase()
        if (PendingWorkResume.isResumeRequest(text)) return false
        if (t.length <= 24 && t in setOf("hello", "hi", "status", "list", "list files")) return false
        return t.contains("create") || t.contains("build") || t.contains("implement") ||
            t.contains("fix") || t.contains("add") || t.contains("write") ||
            t.contains("improve") || t.contains("change") || t.contains("edit")
    }

    private fun packageWithMemory(current: String): String {
        val job = OpenJobStore.loadBound()
        // Chat history is global across projects: cut everything before the last switch
        // so the previous project stops bleeding into this one. Keep the marker itself —
        // it tells the model a switch happened.
        val prior = scopeToCurrentProject(
            store.recentChatMessages(16)
                .asReversed()
                .filter { it.role != ChatRole.SYSTEM || it.content.startsWith(PROJECT_SWITCH_MARKER) }
                .takeLast(10)
        )
        val liveJob = job?.takeUnless { it.status == "applied" || it.status == "abandoned" }
        if (prior.size <= 1 && liveJob == null) return current
        return buildString {
            if (liveJob != null) {
                append(liveJob.promptBlock())
                append('\n')
            }
            if (prior.size > 1) {
                append("Conversation so far (oldest first). The last Current request is what to do now.\n")
                for (msg in prior.dropLast(1)) {
                    val who = when (msg.role) {
                        ChatRole.USER -> "OWNER"
                        ChatRole.SYSTEM -> "SYSTEM"
                        else -> "AGENT"
                    }
                    append(who).append(": ").append(msg.content.take(700)).append('\n')
                }
            }
            append("Current request:\n")
            append(current)
            append('\n')
            PlanRevision.contextFor(current, recentAgentTexts())?.let { append(it) }
        }
    }

    private fun recentAgentTexts(): List<String> =
        store.recentChatMessages(20).filter { it.role == ChatRole.AGENT }.map { it.content }

    private fun formatTask(task: AgentTask, workLog: List<String> = emptyList()): String = buildString {
        if (workLog.isNotEmpty()) {
            append("Work:\n")
            workLog.distinct().take(16).forEach { line ->
                append("- ")
                append(line)
                append('\n')
            }
            append('\n')
        }

        val summary = sanitizeSummary(task.summary)
        if (task.status == "failed" || task.status == "stopped") {
            append(summary)
            return@buildString
        }
        if (task.status == "needs-approval" || task.status == "waiting-approval") {
            append(summary)
            return@buildString
        }
        val isDirect =
            task.status == "needs-input" ||
                summary.startsWith("PROPOSED CHANGES") ||
                summary.startsWith("Hello.") ||
                summary.startsWith("Status report") ||
                summary.startsWith("Project files:") ||
                summary.startsWith("Source files:") ||
                summary.startsWith("Indexed source files") ||
                summary.startsWith("Directory listing:") ||
                summary.startsWith("File:") ||
                summary.startsWith("APPLIED") ||
                summary.startsWith("First approval") ||
                summary.startsWith("No pending proposal") ||
                summary.startsWith("There is no pending") ||
                summary.startsWith("OPEN JOB") ||
                summary.startsWith("Open job is still")

        if (isDirect) {
            append(summary)
            return@buildString
        }

        if (task.changes.isEmpty()) {
            append(summary)
            return@buildString
        }

        append("Proposed files:\n")
        task.changes.distinctBy { it.path }.forEach { change ->
            append("- ")
            append(change.path)
            append('\n')
        }
        append("\n")
        append(summary)
    }

    private fun sanitizeSummary(text: String): String {
        if (text.isBlank()) return "(empty)"
        val head = text.trimStart()
        if (head.startsWith("Project files:") ||
            head.startsWith("Source files:") ||
            head.startsWith("Indexed source files") ||
            head.startsWith("Directory listing:") ||
            head.startsWith("File:") ||
            head.startsWith("Hello.") ||
            head.startsWith("Status report") ||
            head.startsWith("APPLIED") ||
            head.startsWith("PROPOSED CHANGES") ||
            head.startsWith("OPEN JOB") ||
            head.startsWith("Open job is still")
        ) {
            return text.take(12_000)
        }
        if (text.contains("<tool_call", ignoreCase = true) || text.contains("<function=", ignoreCase = true)) {
            return "The model printed a raw tool call instead of a review. That is not an answer."
        }
        if (DegenerateOutput.isDegenerate(text)) {
            return DegenerateOutput.sanitize(text)
        }
        return text.take(12_000)
    }
}

data class ChatTurn(
    val response: ChatMessage,
    val result: AgentRuntimeResult?
)
