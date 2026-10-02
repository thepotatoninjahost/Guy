package com.codingagent.workspace

import java.io.File

/**
 * ONE JOB: Run the MODEL's run_command tool with no shell, no writes, no escape.
 *
 * The owner's own terminal (TerminalSession) keeps full `sh -c`. This class is
 * ONLY for model-issued commands, and it is strict on purpose:
 * - No shell: argv goes straight to ProcessBuilder.bedded pipes, redirects,
 *   chaining, expansions, and quotes are rejected before anything runs.
 * - Read-only allowlist: ls, find, grep, cat, head, tail, wc, file, stat, du,
 *   pwd, echo, printf, true — plus exactly `git status`. Everything else
 *   (rm, curl, sh, gradle, git fetch, ...) is rejected.
 * - find's write primaries (-delete, -exec, ...) are rejected: flags alone
 *   would otherwise smuggle a delete past the read-only rule.
 * - Path containment: no absolute paths, no `..` segments, and every relative
 *   path must canonicalize inside the project root (symlink escape included).
 * - The app's private notebook (.coding-agent) is refused, same as the dispatch guard.
 *
 * Policy violations throw IllegalArgumentException, which the dispatch formats
 * as an ERROR tool result the model can read and adapt to.
 */
class RestrictedShell(
    private val directory: File,
    private val timeoutSeconds: Long = 30
) {
    private val runner = CommandRunner(directory)

    fun execute(command: String): CommandResult {
        val trimmed = command.trim()
        require(trimmed.isNotEmpty()) { "A command is required" }
        require(!META.containsMatchIn(trimmed)) {
            "run_command allows one simple command only — no pipes, redirects, chaining, or expansions"
        }
        require(".coding-agent" !in trimmed) { NotebookGuard.refusal() }
        val argv = trimmed.split(Regex("\\s+"))
        val program = argv[0]
        val pathArgs = if (program == "git") {
            require(argv.size > 1 && argv[1] == "status") { "run_command allows 'git status' only" }
            argv.drop(2)
        } else {
            require(program in ALLOWED) {
                "run_command allows read-only checks only (${((ALLOWED + "git status").sorted()).joinToString()}); got '$program'"
            }
            if (program == "find") {
                require(argv.none { it in DANGEROUS_FIND }) {
                    "run_command find cannot use write primaries (${DANGEROUS_FIND.sorted().joinToString()})"
                }
            }
            argv.drop(1)
        }
        val root = directory.canonicalPath
        for (arg in pathArgs) {
            if (arg.startsWith("-")) continue
            require(arg.split('/').none { it == ".." }) { "run_command paths must stay inside the project" }
            require(!arg.startsWith("/")) { "run_command paths must stay inside the project" }
            val canon = runCatching { File(directory, arg).canonicalPath }.getOrNull()
            require(canon != null && (canon == root || canon.startsWith(root + File.separator))) {
                "run_command paths must stay inside the project"
            }
        }
        return runner.run(argv, timeoutSeconds)
    }

    companion object {
        private val ALLOWED = setOf(
            "ls", "find", "grep", "cat", "head", "tail", "wc", "file",
            "stat", "du", "pwd", "echo", "printf", "true"
        )
        private val DANGEROUS_FIND = setOf(
            "-delete", "-exec", "-execdir", "-ok", "-okdir", "-fls", "-fprint", "-fprintf"
        )
        private val META = Regex("[;|&\$`(){}\\[\\]!#*?~^\"'\\\\<>]")
    }
}
