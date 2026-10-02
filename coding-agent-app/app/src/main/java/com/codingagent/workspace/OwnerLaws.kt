package com.codingagent.workspace

import java.io.File
import org.json.JSONArray

/**
 * ONE JOB: The owner's standing laws ("never X", "always Y"). Laws are set by
 * plain chat messages, stored in the app's private notebook (the model cannot
 * touch them), and injected into every prompt. Nothing is hardcoded — every
 * law comes from the owner's own messages. Laws are stored per project AND in
 * one global file, so they follow the owner across projects.
 */
object OwnerLaws {
    private const val MAX_STORED = 20
    private const val MAX_LAW_CHARS = 300
    private val LAW_START = Regex("""^\s*(never|always|from now on)\b""", RegexOption.IGNORE_CASE)
    private val NEVER_MIND = Regex("""^\s*never\s*mind\b""", RegexOption.IGNORE_CASE)
    private var globalDir: File? = null

    fun file(root: File): File = File(root, ".coding-agent/owner-laws.json")

    /** Wired once at startup to the app's private dir; null disables global laws (tests). */
    fun setGlobalDir(dir: File?) {
        globalDir = dir
    }

    private fun globalFile(): File? = globalDir?.let { File(it, "owner-laws.json") }

    /** True when [text] sets a standing law rather than asking for work. */
    fun isLawMessage(text: String): Boolean {
        val t = text.trim()
        if (t.length <= 12) return false
        if (NEVER_MIND.containsMatchIn(t)) return false
        return LAW_START.containsMatchIn(t)
    }


    /** All laws — only what the owner has typed. Nothing hardcoded. */
    fun list(root: File? = OpenJobStore.boundRoot()): List<String> = stored(root)

    fun stored(root: File? = OpenJobStore.boundRoot()): List<String> {
        val project = if (root == null) emptyList() else readFile(file(root))
        val global = globalFile()?.let { readFile(it) } ?: emptyList()
        return (project + global).distinctBy { it.lowercase() }
    }

    private fun readFile(f: File): List<String> {
        if (!f.isFile) return emptyList()
        return runCatching {
            val arr = JSONArray(f.readText().trim().ifEmpty { "[]" })
            (0 until arr.length()).mapNotNull { arr.optString(it).trim().takeIf { it.isNotEmpty() } }
        }.getOrDefault(emptyList())
    }

    /** Stores [text] as a law. Returns false when it was already stored. */
    fun add(root: File?, text: String): Boolean {
        val clean = text.trim().replace(Regex("\\s+"), " ").take(MAX_LAW_CHARS)
        if (clean.isEmpty()) return false
        var fresh = false
        if (root != null) fresh = addToFile(file(root), clean) || fresh
        globalFile()?.let { fresh = addToFile(it, clean) || fresh }
        return fresh
    }

    private fun addToFile(f: File, clean: String): Boolean {
        val current = readFile(f).toMutableList()
        if (current.any { it.equals(clean, ignoreCase = true) }) return false
        current.add(clean)
        val trimmed = current.takeLast(MAX_STORED)
        f.parentFile?.mkdirs()
        val arr = JSONArray()
        trimmed.forEach { arr.put(it) }
        f.writeText(arr.toString())
        return true
    }
}
