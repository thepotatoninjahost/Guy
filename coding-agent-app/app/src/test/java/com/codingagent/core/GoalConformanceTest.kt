package com.codingagent.core

import com.codingagent.agent.GoalConformance
import com.codingagent.intake.TaskIntent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Proves the agent checks its own work against the owner's ORIGINAL goal:
 * off-goal replies are caught (so rotation can step in), on-goal work passes.
 */
class GoalConformanceTest {
    @Test fun `compiler plan conforms to compiler goal`() {
        assertTrue(GoalConformance.conforms("Here is the plan to build the compiler: lexer, parser, codegen.", "Build me a compiler"))
    }

    @Test fun `example plan misses compiler goal`() {
        assertFalse(GoalConformance.conforms("Here is my plan to add Kotlin and Python support with examples.", "Build me a compiler"))
    }

    @Test fun `fix summary conforms on word stem`() {
        assertTrue(GoalConformance.conforms("Fixed the null crash in Auth.", "fix the bug"))
    }

    @Test fun `goal terms skip stopwords and short words`() {
        assertEquals(listOf("build", "compiler"), GoalConformance.goalTerms("Build me a compiler"))
        assertEquals(listOf("fix", "bug"), GoalConformance.goalTerms("fix the bug"))
    }

    @Test fun `empty terms always pass`() {
        assertTrue(GoalConformance.conforms("anything at all", "hi"))
    }

    @Test fun `only build intents are judged`() {
        assertTrue(GoalConformance.judgesIntent(TaskIntent.CHANGE))
        assertTrue(GoalConformance.judgesIntent(TaskIntent.CREATE))
        assertTrue(GoalConformance.judgesIntent(TaskIntent.REFACTOR))
        assertTrue(GoalConformance.judgesIntent(TaskIntent.DEBUG))
        assertFalse(GoalConformance.judgesIntent(TaskIntent.EXPLAIN))
        assertFalse(GoalConformance.judgesIntent(TaskIntent.INSPECT))
        assertFalse(GoalConformance.judgesIntent(TaskIntent.UNKNOWN))
    }
}
