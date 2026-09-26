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
    val updatedAt: Long
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
        return runCatching {
            val o = JSONObject(f.readText())
            OpenJob(
                id = o.getString("id"),
                goal = o.getString("goal"),
                status = o.getString("status"),
                proposalId = o.optString("proposalId").takeIf { it.isNotBlank() && it != "null" },
                paths = o.optJSONArray("paths")?.let { arr ->
                    (0 until arr.length()).map { arr.getString(it) }
                } ?: emptyList(),
                updatedAt = o.optLong("updatedAt", 0L)
            )
        }.getOrNull()
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
        val paths = JSONArray()
        job.paths.forEach { paths.put(it) }
        o.put("paths", paths)
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
            updatedAt = System.currentTimeMillis()
        )
        save(root, job)
    }

    @Synchronized
    fun markApplied(root: File) {
        bind(root)
        val current = load(root) ?: return
        save(root, current.copy(status = "applied", updatedAt = System.currentTimeMillis()))
    }

    @Synchronized
    fun clear(root: File) {
        file(root).delete()
    }
}
