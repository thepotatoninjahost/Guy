package com.codingagent.agent

import com.codingagent.intake.TaskIntent

/**
 * ONE JOB: Decide whether a model reply addresses the owner's ORIGINAL goal.
 * Lexical, deterministic, transparent: the reply must contain at least one
 * content word of the goal. Bans nothing — it checks fit, not vocabulary.
 */
object GoalConformance {
    private val STOPWORDS = setOf(
        "the", "a", "an", "me", "my", "mine", "you", "your", "yours", "to", "in",
        "on", "for", "of", "and", "or", "it", "its", "this", "that", "these",
        "those", "please", "just", "with", "from", "into", "over", "under", "is",
        "are", "was", "were", "be", "been", "do", "does", "did", "done", "make",
        "makes", "made", "let", "lets", "s", "t", "ve", "re", "ll", "d", "m"
    )

    /** Content words of the goal: lowercase, len>=3, not stopwords. */
    fun goalTerms(goal: String): List<String> =
        goal.lowercase().split(Regex("[^a-z0-9]+"))
            .filter { it.length >= 3 && it !in STOPWORDS }
            .distinct()

    /**
     * True when the reply contains at least one goal term. A goal with no
     * content words passes (nothing to check).
     */
    fun conforms(reply: String, goal: String): Boolean {
        val terms = goalTerms(goal)
        if (terms.isEmpty()) return true
        val body = reply.lowercase()
        return terms.any { it in body }
    }

    /** Build/change intents are judged; open-ended answers cannot be checked lexically. */
    fun judgesIntent(intent: TaskIntent): Boolean =
        intent == TaskIntent.CHANGE || intent == TaskIntent.CREATE ||
            intent == TaskIntent.REFACTOR || intent == TaskIntent.DEBUG
}
