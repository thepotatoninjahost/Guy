package com.codingagent.agent

/**
 * Detects when the owner is asking for a BETTER plan (revising the plan already
 * presented in this conversation) and injects that earlier plan back into the
 * request — so the model revises the conversation plan instead of searching the
 * project for plan files that do not exist.
 */
object PlanRevision {
    private val wantsBetter =
        Regex("\\b(better|new|revise|revised|revision|improve|improved|improvement|rewrite|rewritten|redo|change|different)\\b")
    private val hatesIt =
        Regex("\\b(shit|sucks|suck|bad|terrible|awful|horrible|wrong|garbage|trash|stupid)\\b")

    /**
     * @param request the owner's current message
     * @param agentTexts recent AGENT messages, newest first
     * @return instruction + earlier plan to append, or null when this is not a plan revision
     */
    fun contextFor(request: String, agentTexts: List<String>): String? {
        val t = request.lowercase()
        val mentionsPlan = "plan" in t
        val revisionAsked = (mentionsPlan && wantsBetter.containsMatchIn(t)) ||
            ("this one" in t && hatesIt.containsMatchIn(t))
        if (!revisionAsked) return null
        val lastPlan = agentTexts.firstOrNull { it.contains("plan", ignoreCase = true) } ?: return null
        return buildString {
            append("\nPLAN REVISION — the owner is talking about the plan you already presented in this conversation (pasted below). ")
            append("Do NOT search the project for plan files: the plan lives HERE, not in the project. ")
            append("Read it, fix what the owner dislikes, and present the full better plan as numbered steps plus the files you will touch. ")
            append("Do not call change tools on this turn. ")
            append("End your turn with 'Say approve plan and I will do it.'\n")
            append("Your earlier plan:\n")
            append(lastPlan.take(3000))
            append('\n')
        }
    }
}
