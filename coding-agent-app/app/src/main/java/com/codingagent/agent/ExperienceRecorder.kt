package com.codingagent.agent

import java.io.File

/**
 * ONE JOB: Persist per-task outcomes to experience.tsv for later sessions.
 */
class ExperienceRecorder(private val root: File) {
    private val file = root.resolve(".coding-agent/experience.tsv")

    init {
        LessonContext.bindExperience(::all)
    }

    @Synchronized
    fun record(task: String, operation: String, result: String, evidence: String, passed: Boolean) {
        file.parentFile?.mkdirs()
        file.appendText(
            listOf(System.currentTimeMillis(), passed, task, operation, result, evidence)
                .joinToString("\t") { it.toString().replace('\t', ' ').replace('\n', ' ') } + "\n"
        )
    }

    fun all(): List<String> = if (!file.isFile) emptyList() else file.readLines().map(::repairLegacyLine)

    /**
     * Older builds recorded failed jobs as passed=true. A line whose status
     * column says failed/stopped is a failure no matter what the flag says,
     * so repair it on read instead of letting poisoned history linger.
     */
    private fun repairLegacyLine(line: String): String {
        val cols = line.split('\t').toMutableList()
        if (cols.size > 3 && cols[1].trim().equals("true", ignoreCase = true) &&
            (cols[3].trim() == "failed" || cols[3].trim() == "stopped")
        ) {
            cols[1] = "false"
            return cols.joinToString("\t")
        }
        return line
    }
}
