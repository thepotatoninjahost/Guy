package com.codingagent.workspace

import java.io.File

/**
 * ONE JOB: Nothing fails silently. Non-fatal failures (model rotations, healed
 * state files) get noted here in plain words; ChatWorkspace drains the journal
 * into every turn's work log so the owner always sees what went wrong.
 */
object FailureJournal {
    private const val MAX_ENTRIES = 30

    @Volatile
    private var entries: List<String> = emptyList()

    @Synchronized
    fun note(line: String) {
        val clean = line.trim().take(300)
        if (clean.isEmpty()) return
        entries = (entries + clean).takeLast(MAX_ENTRIES)
    }

    @Synchronized
    fun drain(): List<String> {
        val out = entries
        entries = emptyList()
        return out
    }

    /** Copy a corrupt state file aside. Returns true when the backup landed. */
    fun backupCorrupt(file: File): Boolean = runCatching {
        val bak = file.resolveSibling("${file.name}.corrupt-${System.currentTimeMillis()}.bak")
        file.copyTo(bak, overwrite = true)
        true
    }.getOrDefault(false)
}
