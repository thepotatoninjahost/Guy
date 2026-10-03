package com.codingagent.agent

import com.codingagent.intake.TaskIntent

/**
 * ONE JOB: Turn model-written code into staged proposals. Free models often write
 * code as chat text instead of tool calls; without this, asked-for code is never
 * written anywhere. Only stages when the target is unambiguous — never invents paths.
 */
object ModelCodeExtractor {
    data class CodeFence(val info: String, val code: String)
    data class StagedCode(val path: String, val content: String)

    fun extractFences(text: String): List<CodeFence> {
        val fences = mutableListOf<CodeFence>()
        val regex = Regex("(?s)```([^\\n`]*)\\n(.*?)```")
        regex.findAll(text).forEach { m ->
            val code = m.groupValues[2]
            if (code.isNotBlank()) fences += CodeFence(m.groupValues[1].trim(), code.trimEnd())
        }
        return fences
    }

    /** Complete, finished code only — truncated blocks are never staged. */
    fun isCompleteBlock(code: String): Boolean {
        if (code.contains("…")) return false
        val bareDots = Regex("(?m)^\\s*(//|#)\\s*\\.\\.\\.\\s*$")
        if (bareDots.containsMatchIn(code)) return false
        return true
    }

    /**
     * Decides the single file operation implied by [reply], or null when anything
     * is ambiguous (many blocks, many targets, unknown path, truncated code).
     * [knownTargets] = files the turn already established (intake targets + files read).
     */
    fun decide(reply: String, intent: TaskIntent, knownTargets: List<String>): StagedCode? {
        if (intent != TaskIntent.CREATE && intent != TaskIntent.CHANGE && intent != TaskIntent.REFACTOR) return null
        val fences = extractFences(reply).filter { isCompleteBlock(it.code) }
        if (fences.size != 1) return null
        val rawTargets = knownTargets.map { it.trim() }.filter { it.isNotBlank() }.distinct()
        if (rawTargets.size != 1) return null
        // Traversal is rejected on the RAW target: normalizing first would turn
        // "../evil.txt" into the innocent-looking "evil.txt" and hide the escape.
        val raw = rawTargets.single()
        if (raw.startsWith("/") || ".." in raw || "\\" in raw) return null
        val path = raw.trimStart('.', '/')
        if (path.isBlank()) return null
        return StagedCode(path, fences.single().code)
    }
}
