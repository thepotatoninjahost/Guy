package com.codingagent.core

import com.codingagent.agent.AgentKnowledge
import com.codingagent.agent.AgentModelProtocol
import com.codingagent.agent.AutonomousAgent
import com.codingagent.agent.AutonomousAgentConfig
import com.codingagent.agent.AutonomousAgentEvent
import com.codingagent.agent.ModelCodeExtractor
import com.codingagent.intake.OperationKind
import com.codingagent.intake.TaskIntent
import com.codingagent.intake.TaskOperation
import com.codingagent.model.ModelGateway
import com.codingagent.model.ModelRequest
import com.codingagent.model.ModelResponse
import com.codingagent.workspace.ApprovalType
import com.codingagent.workspace.KnowledgeHit
import com.codingagent.workspace.MutationApprovalResult
import com.codingagent.workspace.MutationCoordinator
import com.codingagent.workspace.MutationProposeResult
import com.codingagent.workspace.OpenJobStore
import com.codingagent.workspace.PlanScope
import com.codingagent.workspace.ProjectWorkspace
import java.io.File
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The owner's operating law: one approved plan, tap-plus-word approvals the agent
 * can never fake, research without permission slips, and model-written code that
 * actually becomes proposals.
 */
class OwnerLawTest {
    private fun scripted(script: List<ModelResponse>) = object : ModelGateway {
        private var index = 0
        override fun complete(request: ModelRequest): ModelResponse =
            script.getOrElse(index++) { ModelResponse.Text("done") }
        override fun stream(request: ModelRequest, onDelta: (String) -> Unit): ModelResponse =
            complete(request).also { if (it is ModelResponse.Text) onDelta(it.content) }
    }

    private fun knowledge() = object : AgentKnowledge {
        override fun search(query: String, limit: Int) = emptyList<KnowledgeHit>()
    }

    private fun agent(root: File, gateway: ModelGateway) =
        AutonomousAgent(root, knowledge(), gateway, AutonomousAgentConfig(maxTurns = 4))

    private fun proposeChange(root: File): Pair<MutationCoordinator, String> {
        val workspace = ProjectWorkspace(root)
        val coordinator = MutationCoordinator(workspace)
        val result = coordinator.propose(
            "add helper",
            listOf(TaskOperation(OperationKind.CREATE_FILE, "src/New.kt", text = "class New\n")),
            "tests"
        )
        assertTrue("Proposal should succeed", result is MutationProposeResult.Proposed)
        return coordinator to (result as MutationProposeResult.Proposed).proposal.id
    }

    // ---- Plan lock ----

    @Test
    fun planPathsAreExtractedFromPlanText() {
        val paths = PlanScope.extractPlanPaths("1. Update src/Main.kt\n2. Add src/Helper.kt and notes.md")
        assertTrue(paths.contains("src/Main.kt"))
        assertTrue(paths.contains("src/Helper.kt"))
        assertTrue(paths.contains("notes.md"))
    }

    @Test
    fun changeWithoutAnyJobIsNotBlocked() {
        val root = Files.createTempDirectory("plan-no-job").toFile()
        assertNull(PlanScope.check(root, listOf("src/A.kt")))
    }

    @Test
    fun unlockedJobDemandsAPlanFirst() {
        val root = Files.createTempDirectory("plan-unlocked").toFile()
        OpenJobStore.openOrKeep(root, "some work")
        val message = PlanScope.check(root, listOf("src/A.kt"))
        assertNotNull(message)
        assertTrue(message!!.contains("approve plan", ignoreCase = true))
    }

    @Test
    fun lockedPlanAllowsCoveredFilesAndBlocksOutsiders() {
        val root = Files.createTempDirectory("plan-locked").toFile()
        OpenJobStore.openOrKeep(root, "some work")
        OpenJobStore.lockPlan(root, listOf("src/A.kt"))
        assertNull(PlanScope.check(root, listOf("src/A.kt")))
        val message = PlanScope.check(root, listOf("src/Other.kt"))
        assertNotNull(message)
        assertTrue(message!!.contains("amend plan", ignoreCase = true))
    }

    // ---- Model-written code ----

    @Test
    fun fencesAreExtractedAndTruncatedBlocksRejected() {
        val fences = ModelCodeExtractor.extractFences("Here:\n```kt\nfun a() = 1\n```\nDone.")
        assertEquals(1, fences.size)
        assertEquals("fun a() = 1", fences.single().code)
        assertTrue(ModelCodeExtractor.isCompleteBlock("fun a() = 1"))
        assertFalse(ModelCodeExtractor.isCompleteBlock("fun a() = 1\n// ..."))
        assertFalse(ModelCodeExtractor.isCompleteBlock("fun a() = …"))
    }

    @Test
    fun decideNeedsOneBlockAndOneKnownTarget() {
        val reply = "Here:\n```txt\nhello\n```"
        assertEquals("notes.txt", ModelCodeExtractor.decide(reply, TaskIntent.CHANGE, listOf("notes.txt"))!!.path)
        assertNull(ModelCodeExtractor.decide(reply, TaskIntent.INSPECT, listOf("notes.txt")))
        assertNull(ModelCodeExtractor.decide(reply, TaskIntent.CHANGE, listOf("a.txt", "b.txt")))
        assertNull(ModelCodeExtractor.decide(reply, TaskIntent.CHANGE, emptyList()))
        assertNull(ModelCodeExtractor.decide("no code here", TaskIntent.CHANGE, listOf("notes.txt")))
        assertNull(ModelCodeExtractor.decide(reply, TaskIntent.CHANGE, listOf("../evil.txt")))
    }

    // ---- Tap plus word ----

    @Test
    fun twoTapsDoNotApply() {
        val root = Files.createTempDirectory("law-taps").toFile()
        val (coordinator, id) = proposeChange(root)
        val first = coordinator.approve(id, ownerVerified = true, ownerLabel = "owner", approvalType = ApprovalType.TAP)
        assertTrue(first is MutationApprovalResult.AwaitingSecond)
        assertEquals(ApprovalType.WORD, (first as MutationApprovalResult.AwaitingSecond).missingType)
        val second = coordinator.approve(id, ownerVerified = true, ownerLabel = "owner", approvalType = ApprovalType.TAP)
        assertTrue("two taps must not apply", second is MutationApprovalResult.AwaitingSecond)
        assertFalse(root.resolve("src/New.kt").exists())
    }

    @Test
    fun tapPlusWordAppliesInEitherOrder() {
        val root = Files.createTempDirectory("law-pairs").toFile()
        val (firstCo, firstId) = proposeChange(root)
        assertTrue(firstCo.approve(firstId, true, "owner", ApprovalType.TAP) is MutationApprovalResult.AwaitingSecond)
        assertTrue(firstCo.approve(firstId, true, "owner", ApprovalType.WORD) is MutationApprovalResult.Applied)
        assertTrue(root.resolve("src/New.kt").exists())

        val (secondCo, secondId) = proposeChange(root)
        assertTrue(secondCo.approve(secondId, true, "owner", ApprovalType.WORD) is MutationApprovalResult.AwaitingSecond)
        assertTrue(secondCo.approve(secondId, true, "owner", ApprovalType.TAP) is MutationApprovalResult.Applied)
    }

    @Test
    fun approvalTypesSurviveReload() {
        val root = Files.createTempDirectory("law-reload").toFile()
        val (coordinator, id) = proposeChange(root)
        assertTrue(coordinator.approve(id, true, "owner", ApprovalType.TAP) is MutationApprovalResult.AwaitingSecond)
        val reloaded = MutationCoordinator(ProjectWorkspace(root))
        assertTrue(reloaded.approve(id, true, "owner", ApprovalType.WORD) is MutationApprovalResult.Applied)
        assertTrue(root.resolve("src/New.kt").exists())
    }

    // ---- The agent cannot fake approval, and researches freely ----

    @Test
    fun modelHasNoApprovalTool() {
        val names = AgentModelProtocol.tools().map { it.name }
        assertFalse(names.contains("approve_change"))
        assertFalse(AgentModelProtocol.toolsForIntent(TaskIntent.CHANGE).map { it.name }.contains("approve_change"))
    }

    @Test
    fun researchNeedsNoPermission() {
        assertTrue(
            AgentModelProtocol.DEFAULT_SYSTEM.contains("never ask permission to research", ignoreCase = true)
        )
    }

    // ---- Model-written code becomes proposals under a locked plan ----

    @Test
    fun modelWrittenCodeBecomesProposalUnderLockedPlan() {
        val root = Files.createTempDirectory("law-staged").toFile()
        root.resolve("notes.txt").writeText("old\n")
        OpenJobStore.openOrKeep(root, "edit notes")
        OpenJobStore.lockPlan(root, listOf("notes.txt"))
        val gateway = scripted(
            listOf(
                ModelResponse.ToolCall("read_file", """{"path":"notes.txt"}"""),
                ModelResponse.Text("Updated the note:\n```txt\nhello\n```")
            )
        )
        val events = agent(root, gateway).run("edit notes.txt to say hello")
        assertTrue("expected staged proposal, got ${events.last()}", events.last() is AutonomousAgentEvent.ApprovalRequired)
    }

    @Test
    fun modelWrittenCodeStaysTextWithoutAPlan() {
        val root = Files.createTempDirectory("law-unplanned").toFile()
        root.resolve("notes.txt").writeText("old\n")
        OpenJobStore.openOrKeep(root, "edit notes")
        val gateway = scripted(
            listOf(
                ModelResponse.ToolCall("read_file", """{"path":"notes.txt"}"""),
                ModelResponse.Text("Updated the note:\n```txt\nhello\n```")
            )
        )
        val events = agent(root, gateway).run("edit notes.txt to say hello")
        assertTrue(events.last() is AutonomousAgentEvent.Completed)
        assertTrue(MutationCoordinator(ProjectWorkspace(root)).pending().isEmpty())
    }
}
