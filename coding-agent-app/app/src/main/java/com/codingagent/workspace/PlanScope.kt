package com.codingagent.workspace

import java.io.File

/**
 * ONE JOB: The owner's plan lock. The agent presents a plan, the owner approves
 * it once, and file changes stay inside it. Anything outside comes back to the
 * owner (one single approval to amend). Owner-typed commands and owner editor
 * saves never pass through here — only the model's own tool calls and staged text.
 */
object PlanScope {
    /** File paths named in a plan or amend message. */
    fun extractPlanPaths(text: String): List<String> {
        val paths = linkedSetOf<String>()
        Regex(
            "(?:[A-Za-z0-9_.\\-]+/)+[A-Za-z0-9_.\\-]+|[A-Za-z0-9_\\-]+\\.(?:kt|kts|java|py|js|ts|tsx|jsx|json|xml|md|txt|toml|yaml|yml|gradle|sh)",
            RegexOption.IGNORE_CASE
        ).findAll(text).forEach { paths += it.value.trim().trimStart('.', '/') }
        return paths.filter { it.isNotBlank() && it != "100%" }.distinct()
    }

    /**
     * Returns null when [paths] may proceed, or the full guidance message for
     * the model when the plan lock blocks them.
     */
    fun check(root: File, paths: List<String>): String? {
        val job = runCatching { OpenJobStore.load(root) }.getOrNull() ?: return null
        if (!job.planLocked) {
            return "No approved plan covers this change yet. Present your PLAN as numbered steps " +
                "plus the files you will touch, then STOP — end your turn with " +
                "'Say approve plan and I will do it.' Do not call change tools again until the owner approves the plan."
        }
        // Plan approved in spirit but no file names were captured: proceed, with every
        // write still guarded by the tap-plus-word dual approval.
        if (job.planPaths.isEmpty()) return null
        val normalized = paths.map { it.trim().trimStart('.', '/') }
        val outside = normalized.filter { p -> job.planPaths.none { scope -> scope.equals(p, ignoreCase = true) } }
        if (outside.isEmpty()) return null
        return "Blocked: ${outside.joinToString()} is outside the approved plan " +
            "(${job.planPaths.joinToString().take(300)}). Tell the owner in plain words what you want to add " +
            "and ask them to say 'amend plan'. Do not call change tools again until they do."
    }
}
