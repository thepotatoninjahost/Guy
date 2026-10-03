package com.codingagent.workspace

import java.io.File

/**
 * ONE JOB: Run the MODEL's run_command tool with no shell and no escape.
 *
 * The owner's own terminal (TerminalSession) keeps full `sh -c`. This class is
 * ONLY for model-issued commands, and it is strict on purpose:
 * - No shell: argv goes straight to ProcessBuilder. Pipes, redirects,
 *   chaining, expansions, and quotes are rejected before anything runs.
 * - Read-only allowlist: ls, find, grep, cat, head, tail, wc, file, stat, du,
 *   pwd, echo, printf, true — plus exactly `git status`.
 * - Builds allowed: gradle / gradlew with plain task names only (letters,
 *   digits, colon, underscore, dash, dot). Init scripts, alternate settings,
 *   project dirs, and included builds are rejected, so a build always runs
 *   the owner's own project as-is. Builds get a 600s timeout.
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
        val raw = trimmed.split(Regex("\\s+"))
        val program = if (raw[0] == "./gradlew") "gradlew" else raw[0]
        val argv = listOf(program) + raw.drop(1)
        val pathArgs: List<String>
        val timeout: Long
        if (program == "git") {
            require(argv.size > 1 && argv[1] == "status") { "run_command allows 'git status' only" }
            pathArgs = argv.drop(2)
            timeout = timeoutSeconds
        } else if (program in GRADLE) {
            checkGradleArgs(argv.drop(1))
            pathArgs = emptyList()
            timeout = maxOf(timeoutSeconds, GRADLE_TIMEOUT_SECONDS)
        } else {
            require(program in ALLOWED) {
                "run_command allows read-only checks, git status, and gradle builds only; got '$program'"
            }
            if (program == "find") {
                require(argv.none { it in DANGEROUS_FIND }) {
                    "run_command find cannot use write primaries (${DANGEROUS_FIND.sorted().joinToString()})"
                }
            }
            pathArgs = argv.drop(1)
            timeout = timeoutSeconds
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
        return runner.run(argv, timeout)
    }

    private fun checkGradleArgs(args: List<String>) {
        for (arg in args) {
            if (arg.startsWith("-")) {
                require(!isDeniedGradleFlag(arg)) {
                    "run_command gradle cannot use '$arg' (builds run the owner's project as-is)"
                }
            } else {
                require(TASK_NAME.matches(arg)) {
                    "run_command gradle task names must be plain words (letters, digits, :, _, -, .)"
                }
            }
        }
    }

    private fun isDeniedGradleFlag(arg: String): Boolean {
        for (denied in DENIED_GRADLE_FLAGS) {
            if (arg == denied) return true
            if (arg.startsWith("$denied=")) return true
            // Short flags also come glued to their value (-Ievil.init).
            if (denied.length == 2 && denied.startsWith("-") && !denied.startsWith("--") &&
                arg.startsWith(denied) && arg.length > denied.length
            ) return true
        }
        return false
    }

    companion object {
        private val ALLOWED = setOf(
            "ls", "find", "grep", "cat", "head", "tail", "wc", "file",
            "stat", "du", "pwd", "echo", "printf", "true"
        )
        private val GRADLE = setOf("gradle", "gradlew")
        private const val GRADLE_TIMEOUT_SECONDS = 600L
        private val DENIED_GRADLE_FLAGS = setOf(
            "-I", "--init-script",
            "-c", "--settings-file",
            "-p", "--project-dir",
            "-g", "--gradle-user-home",
            "--project-cache-dir",
            "--include-build"
        )
        private val TASK_NAME = Regex("^[A-Za-z0-9:_.-]+$")
        private val DANGEROUS_FIND = setOf(
            "-delete", "-exec", "-execdir", "-ok", "-okdir", "-fls", "-fprint", "-fprintf"
        )
        private val META = Regex("[;|&\$`(){}\\[\\]!#*?~^\"'\\\\<>]")
    }
}
