package com.codingagent.workspace

/**
 * Plain-word static notes about generated code, shown on the Review screen.
 * Warnings only — they never block approval.
 */
object CodeQualityNotes {
    private val sourceExtensions = setOf(
        "kt", "kts", "java", "py", "js", "jsx", "ts", "tsx",
        "swift", "go", "rs", "c", "cc", "cpp", "h", "hpp", "cs", "php", "rb"
    )
    private val markerWords =
        Regex("\\b(TODO|FIXME|XXX|HACK|PLACEHOLDER|STUB|LOREM)\\b", RegexOption.IGNORE_CASE)
    private val emptyBody =
        Regex(".*\\b(fun|class|object|def|function)\\b.*\\{\\s*\\}\\s*;?\\s*$")
    private val identityFun =
        Regex("\\b(fun|def)\\b[^\\n]*=\\s*[A-Za-z_]\\w*\\s*$")
    private val identityArrow =
        Regex("=>\\s*[A-Za-z_]\\w*\\s*;?\\s*$")
    private val bareIdentifier = Regex("[A-Za-z_]\\w*")

    fun analyze(path: String, content: String?): List<String> {
        if (content.isNullOrBlank()) return emptyList()
        val ext = path.substringAfterLast('.', "").lowercase()
        if (ext !in sourceExtensions) return emptyList()
        val notes = mutableListOf<String>()
        val markers = markerWords.findAll(content).map { it.value.uppercase() }.distinct().take(3).toList()
        if (markers.isNotEmpty()) notes += "Contains unfinished markers: ${markers.joinToString(", ")}."
        val lines = content.lines()
        if (lines.any { it.trim().matches(emptyBody) }) notes += "Has an empty function or class body."
        val nonBlank = lines.asSequence().map { it.trim() }.filter { it.isNotEmpty() }.toList()
        val identityHit = nonBlank.any { it.matches(identityFun) || it.matches(identityArrow) } ||
            nonBlank.zipWithNext().any { (a, b) -> a.endsWith("=") && b.matches(bareIdentifier) }
        if (identityHit) notes += "Looks like a pass-through: a function that returns its input unchanged."
        return notes.take(3)
    }
}
