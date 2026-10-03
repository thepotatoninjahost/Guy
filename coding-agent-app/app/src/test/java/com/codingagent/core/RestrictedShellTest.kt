package com.codingagent.core

import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import com.codingagent.workspace.RestrictedShell

class RestrictedShellTest {
    private fun shell(): Pair<java.io.File, RestrictedShell> {
        val root = Files.createTempDirectory("rsh").toFile()
        return root to RestrictedShell(root)
    }

    private fun rejects(shell: RestrictedShell, command: String) {
        try {
            shell.execute(command)
            fail("should reject: $command")
        } catch (e: IllegalArgumentException) {
            // Expected: policy violation surfaces as a readable ERROR result.
        }
    }

    @Test
    fun allowsASimpleReadOnlyCheck() {
        val (_, shell) = shell()
        val result = shell.execute("echo hi")
        assertEquals(0, result.exitCode)
        assertEquals("hi", result.stdout)
    }

    @Test
    fun allowsAContainedRelativePath() {
        val (root, shell) = shell()
        root.resolve("sub").mkdir()
        root.resolve("sub/n.txt").writeText("n")
        val result = shell.execute("ls sub")
        assertEquals(0, result.exitCode)
        assertTrue(result.stdout.contains("n.txt"))
    }

    @Test
    fun rejectsShellMetacharacters() {
        val (_, shell) = shell()
        for (command in listOf(
            "echo a; echo b",
            "echo a | grep b",
            "echo a & echo b",
            "echo \$HOME",
            "echo `id`",
            "echo (a)",
            "echo a > b",
            "echo a < b",
            "echo a*b"
        )) {
            rejects(shell, command)
        }
    }

    @Test
    fun rejectsWriteCapablePrograms() {
        val (_, shell) = shell()
        for (command in listOf("rm x", "curl example.com", "sh -c echo", "git fetch", "gradle test", "python3 x.py")) {
            rejects(shell, command)
        }
    }

    @Test
    fun allowsGitStatus() {
        val (_, shell) = shell()
        // Runs anywhere (fails honest when this is not a repo); must not throw policy.
        val result = shell.execute("git status")
        assertTrue(!result.timedOut)
        assertTrue((result.stdout + result.stderr).isNotBlank())
    }

    @Test
    fun rejectsPathsEscapingTheProject() {
        val (_, shell) = shell()
        for (command in listOf("ls ..", "cat /etc/hostname", "ls ../..", "ls sub/../../..")) {
            rejects(shell, command)
        }
    }

    @Test
    fun rejectsFindDeleteAndExecPrimaries() {
        val (_, shell) = shell()
        rejects(shell, "find . -delete")
        rejects(shell, "find . -exec echo hi")
    }

    @Test
    fun rejectsThePrivateNotebook() {
        val (_, shell) = shell()
        rejects(shell, "cat .coding-agent/x")
    }

    @Test
    fun allowsGradleWithPlainTasks() {
        val (_, shell) = shell()
        // No gradle binary in the unit-test sandbox: policy passes, spawn fails honest.
        for (command in listOf("gradle --version", "gradlew assembleDebug", "./gradlew :app:testDebugUnitTest")) {
            val result = shell.execute(command)
            assertTrue(!result.timedOut)
        }
    }

    @Test
    fun rejectsGradleEscapeArgs() {
        val (_, shell) = shell()
        for (command in listOf(
            "gradle build -I evil.init",
            "gradle --init-script=x build",
            "gradle -p /tmp build",
            "gradle build --include-build ../other",
            "gradle build; echo hi",
            "gradle ../evil"
        )) {
            rejects(shell, command)
        }
    }
}
