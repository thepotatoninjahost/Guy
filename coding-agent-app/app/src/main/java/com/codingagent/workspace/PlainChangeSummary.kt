package com.codingagent.workspace

/**
 * ONE JOB: Describe one proposed file change in plain owner words.
 * The Review screen and the chat proposal text lead with this; raw code
 * diffs stay hidden unless the owner taps "Show code details".
 */
object PlainChangeSummary {
    private val symbolDecl = Regex("""\b(class|object|fun|def|function)\s+([A-Za-z_]\w*)""")
    private const val MAX_SYMBOLS = 5

    /** Plain lines describing [record]. Never empty. */
    fun describe(record: ChangeRecord): List<String> {
        fun count(n: Int): String = "$n line" + if (n == 1) "" else "s"
        val diff = ChangeDiff.unified(record)
        val added = diff.count { it.kind == DiffLineKind.ADD }
        val removed = diff.count { it.kind == DiffLineKind.REMOVE }
        val lines = mutableListOf<String>()
        lines += when (record.operation) {
            ChangeOperation.CREATE -> "New file: ${record.path} (${count(added)})."
            ChangeOperation.APPEND -> "Adds to the end of ${record.path} (${count(added)})."
            ChangeOperation.REMOVE -> "Deletes from ${record.path} (${count(removed)})."
            ChangeOperation.REPLACE -> "Edits ${record.path} (${count(added)} in, ${count(removed)} out)."
        }
        val symbols = symbolDecl.findAll(record.after.orEmpty())
            .map { it.groupValues[2] }.distinct().take(MAX_SYMBOLS).toList()
        if (symbols.isNotEmpty()) {
            val verb = if (record.operation == ChangeOperation.CREATE) "It creates" else "It touches"
            lines += "$verb: ${symbols.joinToString()}."
        }
        return lines
    }
}
