package com.codingagent.workspace

import java.io.File
import java.util.UUID
import org.json.JSONArray
import org.json.JSONObject

/**
 * ONE JOB: Persist the owner's open coding job on disk so later turns attach to it.
 */
data class OpenJob(
    val id: String,
    val goal: String,
    val status: String,
    val proposalId: String?,
    val paths: List<String>,
    val updatedAt: Long,
    val planLocked: Boolean = false,
    val planPaths: List<String> = emptyList()
) {
    fun promptBlock(): String = buildString {
        append("OPEN JOB (do not claim there is no prior task):\n")
        append("- id: ").append(id).append('\n')
        append("- status: ").append(status).append('\n')
        append("- goal: ").append(goal.take(1_200)).append('\n')
        if (!proposalId.isNullOrBlank()) append("- proposal: ").append(proposalId).append('\n')
        if (paths.isNotEmpty()) {
            append("- staged paths:\n")
            paths.forEach { append("  - ").append(it).append('\n') }
        }
        if (planLocked) {
            val scope = if (planPaths.isEmpty()) "(approved in spirit, no file names captured)" else planPaths.take(12).joinToString()
            append("- plan: LOCKED files: ").append(scope).append('\n')
        }
        append("\"try again\" / \"continue\" / \"show the file\" means this job, not a new empty project.\n")
    }
}

object OpenJobStore {
    @Volatile
    private var lastRoot: File? = null

    fun file(root: File): File = File(root, ".coding-agent/open-job.json")

    @Synchronized
    fun bind(root: File) {
        lastRoot = root
    }

    @Synchronized
    fun boundRoot(): File? = lastRoot

    @Synchronized
    fun loadBound(): OpenJob? = lastRoot?.let { load(it) }

    @Synchronized
    fun load(root: File): OpenJob? {
        bind(root)
        val f = file(root)
        if (!f.isFile) return null
        try {
            val o = JSONObject(f.readText())
            return OpenJob(
                id = o.getString("id"),
                goal = o.getString("goal"),
                status = o.getString("status"),
                proposalId = o.optString("proposalId").takeIf { it.isNotBlank() && it != "null" },
                paths = o.optJSONArray("paths")?.let { arr ->
                    (0 until arr.length()).map { arr.getString(it) }
                } ?: emptyList(),
                updatedAt = o.optLong("updatedAt", 0L),
                planLocked = o.optBoolean("planLocked", false),
                planPaths = o.optJSONArray("planPaths")?.let { arr ->
                    (0 until arr.length()).map { arr.getString(it) }
                } ?: emptyList()
            )
        } catch (_: Exception) {
            val kept = FailureJournal.backupCorrupt(f)
            FailureJournal.note(
                if (kept) "Job notebook was scrambled, so I set it aside (backup kept) and started fresh."
                else "Job notebook was scrambled and the backup failed too — starting fresh."
            )
            return null
        }
    }

    @Synchronized
    fun save(root: File, job: OpenJob) {
        bind(root)
        val f = file(root)
        f.parentFile?.mkdirs()
        val o = JSONObject()
            .put("id", job.id)
            .put("goal", job.goal)
            .put("status", job.status)
            .put("proposalId", job.proposalId ?: JSONObject.NULL)
            .put("updatedAt", job.updatedAt)
            .put("planLocked", job.planLocked)
        val paths = JSONArray()
        job.paths.forEach { paths.put(it) }
        o.put("paths", paths)
        val planPaths = JSONArray()
        job.planPaths.forEach { planPaths.put(it) }
        o.put("planPaths", planPaths)
        f.writeText(o.toString())
    }

    /**
     * Phrases that refer back to the current job instead of starting a new one.
     * (Mirrors the agent-side resume list without a workspace→agent dependency.)
     */
    private val continuationHints = listOf(
        "try again", "try it again", "retry", "continue", "keep going", "resume",
        "show the file", "show the files", "show file", "show files",
        "the proposal", "review proposal", "pending proposal",
        "what did you propose", "what did you change",
        "same session", "same conversation", "you already know", "look back"
    )

    @Synchronized
    fun openOrKeep(root: File, goal: String): OpenJob {
        bind(root)
        val existing = load(root)
        if (existing != null && existing.status != "applied" && existing.status != "abandoned") {
            // A live proposal waiting on the owner must survive new chatter.
            // So must continuations ("try again") and repeats of the same goal.
            // But a genuinely NEW goal supersedes a stale open job — otherwise the
            // old project bleeds into every later request forever.
            if (existing.status == "waiting-approval" ||
                isContinuation(goal) ||
                existing.goal.trim().equals(goal.trim(), ignoreCase = true)
            ) {
                return existing
            }
        }
        val job = OpenJob(
            id = UUID.randomUUID().toString(),
            goal = goal.trim(),
            status = "open",
            proposalId = null,
            paths = emptyList(),
            updatedAt = System.currentTimeMillis()
        )
        save(root, job)
        return job
    }

    private fun isContinuation(goal: String): Boolean {
        val t = goal.lowercase().trim()
        if (t.isEmpty()) return false
        if (t.length <= 24 && (t == "continue" || t == "retry" || t == "again" || t == "resume")) return true
        return continuationHints.any { t.contains(it) }
    }

    /**
     * Drop the open job entirely ("forget this job"). It stops attaching to new requests.
     */
    @Synchronized
    fun abandon(root: File) {
        bind(root)
        file(root).delete()
    }

    @Synchronized
    fun markWaiting(root: File, proposalId: String, paths: List<String>, goal: String?) {
        bind(root)
        val current = load(root)
        val job = OpenJob(
            id = current?.id ?: UUID.randomUUID().toString(),
            goal = goal?.takeIf { it.isNotBlank() } ?: current?.goal ?: "",
            status = "waiting-approval",
            proposalId = proposalId,
            paths = paths.ifEmpty { current?.paths ?: emptyList() },
            updatedAt = System.currentTimeMillis(),
            planLocked = current?.planLocked ?: false,
            planPaths = current?.planPaths ?: emptyList()
        )
        save(root, job)
    }

    @Synchronized
    fun markApplied(root: File) {
        bind(root)
        val current = load(root) ?: return
        save(root, current.copy(status = "applied", updatedAt = System.currentTimeMillis()))
    }

    /**
     * ONE JOB: The owner's plan lock. "Approve plan" freezes the file scope; model
     * change tools stay inside it until "amend plan" widens it or "unlock plan"
     * releases it. A fresh job is created when none exists so the lock has a home.
     */
    @Synchronized
    fun lockPlan(root: File, paths: List<String>) {
        bind(root)
        val current = load(root)
        val base = current ?: OpenJob(
            id = UUID.randomUUID().toString(),
            goal = "(plan approved)",
            status = "open",
            proposalId = null,
            paths = emptyList(),
            updatedAt = System.currentTimeMillis()
        )
        save(root, base.copy(planLocked = true, planPaths = paths.distinct(), updatedAt = System.currentTimeMillis()))
    }

    @Synchronized
    fun addPlanPaths(root: File, paths: List<String>) {
        bind(root)
        val current = load(root)
        if (current == null) {
            lockPlan(root, paths)
            return
        }
        save(
            root,
            current.copy(
                planLocked = true,
                planPaths = (current.planPaths + paths).distinct(),
                updatedAt = System.currentTimeMillis()
            )
        )
    }

    @Synchronized
    fun unlockPlan(root: File) {
        bind(root)
        val current = load(root) ?: return
        save(root, current.copy(planLocked = false, updatedAt = System.currentTimeMillis()))
    }

    @Synchronized
    fun clear(root: File) {
        file(root).delete()
    }

    const val BANNED_REPLY_NOTICE =
        "I broke your hello-world ban in my reply, so it was withheld. Nothing was created. Tell me what to build and I'll do it properly."

    @Volatile
    private var pendingGoal: String? = null

    @Volatile
    private var pendingQuestion: String? = null

    /**
     * ONE JOB: Remember what the agent asked the owner so the answer is fused
     * back onto the ORIGINAL goal. The goal is never replaced by the answer.
     */
    @Synchronized
    fun peekPending(): Pair<String, String>? {
        val goal = pendingGoal
        val question = pendingQuestion
        return if (goal != null && question != null) goal to question else null
    }

    @Synchronized
    fun noteQuestion(goal: String, question: String) {
        if (pendingGoal.isNullOrBlank()) pendingGoal = goal
        pendingQuestion = question
    }

    @Synchronized
    fun clearPending() {
        pendingGoal = null
        pendingQuestion = null
    }

    @Synchronized
    fun fuseAnswer(goal: String, question: String, answer: String): String = buildString {
        append("ORIGINAL GOAL - do this and nothing else:\n")
        append(goal.take(1_200).trim()).append("\n\n")
        append("You asked the owner this question:\n")
        append(question.take(800).trim()).append("\n\n")
        append("The owner answered:\n")
        append(answer.take(800).trim()).append("\n\n")
        append("Use the answer and keep working on the ORIGINAL GOAL. Do not replace it.")
    }

    /**
     * ONE JOB: Withhold any agent reply that breaks the owner's hello-world ban.
     * Returns the original text when clean.
     */
    @Synchronized
    fun scrubReply(text: String): String {
        if (!OwnerLaws.containsHelloWorld(text)) return text
        FailureJournal.note("Withheld an agent reply that broke your hello-world ban. Nothing was created.")
        return BANNED_REPLY_NOTICE
    }
}
