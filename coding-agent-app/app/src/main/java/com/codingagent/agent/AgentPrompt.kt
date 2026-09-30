package com.codingagent.agent

import com.codingagent.intake.TaskIntake
import com.codingagent.intake.TaskIntent
import com.codingagent.workspace.ProjectFileService
import com.codingagent.workspace.ProjectWorkspace
import com.codingagent.workspace.VerificationReport

/**
 * ONE JOB: Build the model prompt and the compact repo map.
 */
object AgentPrompt {
    fun repoMap(files: ProjectFileService, workspace: ProjectWorkspace, maxPaths: Int = 100): String {
        val paths = files.listSourceFilePaths()
        val summary = workspace.summary()
        return buildString {
            append("Repo map — indexed sources: ${paths.size}")
            append(" (extension whitelist; not every file on disk).")
            if (summary.languages.isNotEmpty()) {
                append(" Languages: ")
                append(summary.languages.entries.sortedByDescending { it.value }.joinToString { "${it.key}=${it.value}" })
            }
            append('\n')
            if (paths.isEmpty()) {
                append("(no indexed source files)\n")
            } else {
                paths.take(maxPaths).forEach { path ->
                    append(path)
                    append('\n')
                }
                if (paths.size > maxPaths) {
                    append("… and ${paths.size - maxPaths} more (use list_files / search_project)\n")
                }
            }
        }
    }

    fun build(
        request: String,
        intake: TaskIntake,
        evidence: String,
        maxEvidenceChars: Int,
        lessons: String = LessonContext.prompt()
    ): String = buildString {
        appendLine("You are the Coding-Agent on this device. You extend the model with tools and real evidence — never invent paths or file contents.")
        appendLine("The owner speaks plain English and is not a programmer. Never ask for code, error text, stack traces, file operations, or \"code shape\" — translate plain words into a plan and do the work with tools yourself.")
        appendLine("Never argue with the owner and never say they are wrong. If a request cannot be done as asked, say what CAN be done in plain words and do that (or ask one short plain-English question).")
        appendLine("A brand-new project has no files and no error messages yet. That is normal, not a blocker: scaffold from the description.")
        appendLine()
        appendLine("Request:")
        appendLine(request)
        appendLine()
        val targets = intake.contract.targetPaths.joinToString().ifBlank { "none yet" }
        appendLine("Intent: ${intake.intent}")
        appendLine("Target paths: $targets")
        appendLine()
        appendLine("Operating rules for this turn:")
        appendLine("1. Gather real evidence with tools. Never invent file contents or paths.")
        appendLine("2. If the user names a file, call read_file on it before analysis or final answer.")
        appendLine("3. Exactly one tool call this turn. Observe the full result before the next step.")
        appendLine("4. Code changes only stage a proposal. The owner approves with a tap plus a typed word. You cannot approve anything — never call approve_change.")
        appendLine("5. After every code change, call verify. If it fails: diagnose, fix, verify again (up to 3 times). Never report a fake pass.")
        appendLine("6. Use research_web when you lack current docs, APIs, errors, or practices not in the project.")
        appendLine("7. Persist until the goal is met. Only stop early for one short plain-English question. Never stop to demand code, errors, or file paths.")
        appendLine("8. After real file reads or project search hits, WRITE THE ANSWER. Do not keep listing.")
        appendLine("9. Prefer research_web over guessing external APIs. Prefer project files over inventing local paths.")
        appendLine("12. Lead with the conclusion. Do not dump chain-of-thought or <think> blocks. Every project claim must appear in the evidence below.")
        appendLine("13. Never list, read, run commands on, or change anything under .coding-agent/ — that folder is the app's private notebook and is off limits to you.")
        val standingLaws = com.codingagent.workspace.OwnerLaws.list()
        if (standingLaws.isNotEmpty()) {
            appendLine("Standing owner laws:")
            standingLaws.take(5).forEach { appendLine("- $it") }
        }
        if (AgentRequestKind.isWholeProjectReview(request)) {
            appendLine("10. This is a whole-project review. After real evidence, write concrete improvements.")
        }
        if (intake.intent in setOf(TaskIntent.CHANGE, TaskIntent.CREATE, TaskIntent.REFACTOR, TaskIntent.DEBUG)) {
            appendLine("11. This is change work. A review alone is not the work. If no plan is approved yet, present your PLAN first (numbered steps plus the files you will touch) and stop for 'approve plan'. Under a locked plan, stay inside its files; anything outside needs 'amend plan' first.")
        }
        if (lessons.isNotBlank()) {
            appendLine()
            appendLine("Lessons from recent runs (self-correction context):")
            appendLine(lessons)
        }
        appendLine()
        appendLine("Evidence so far:")
        append(evidence.take(maxEvidenceChars.coerceAtMost(6_000)))
    }

    fun listingSummary(listing: String, report: VerificationReport, namesOnly: Boolean = true): String {
        return buildString {
            if (namesOnly) {
                append("Indexed source files (extension whitelist — not a full disk listing):\n")
            } else {
                append("Directory listing:\n")
            }
            append(listing.trim().ifBlank { "(none)" })
            append("\n\nVerification: ")
            if (report.passed) {
                append("passed (static unfinished-work marker scan)")
            } else {
                append("FAILED; ")
                append(report.issues.size)
                append(" issue(s)")
                report.issues.take(20).forEach { issue ->
                    append("\n- ")
                    append(issue.path)
                    append(":")
                    append(issue.line)
                    append(" — ")
                    append(issue.message)
                }
            }
        }
    }

    fun synthesizeFromEvidence(
        request: String,
        evidence: String,
        report: VerificationReport,
        maxChars: Int
    ): String {
        val draft = buildString {
            append("Review from gathered evidence (model did not write a final after tools were closed).\n\n")
            append("Request: ").append(request.trim()).append("\n\n")
            append(evidence.take(maxChars))
            append("\n\nVerification: ")
            if (report.passed) {
                append("passed (static unfinished-work marker scan)")
            } else {
                append("FAILED (").append(report.issues.size).append(" issue(s))")
                report.issues.take(20).forEach { issue ->
                    append("\n- ").append(issue.path).append(":").append(issue.line).append(" — ").append(issue.message)
                }
            }
            append("\n\nIf this is thinner than you wanted, retry once. The next run starts with this evidence already in context.")
        }
        return LogicReasoning.inspect(draft, evidence).displayText
    }
}
