package com.codingagent.core

import com.codingagent.agent.AgentKnowledge
import com.codingagent.agent.AutonomousAgent
import com.codingagent.agent.AutonomousAgentConfig
import com.codingagent.agent.AutonomousAgentEvent
import com.codingagent.agent.ModelCodeExtractor
import com.codingagent.intake.OperationKind
import com.codingagent.intake.TaskIntent
import com.codingagent.intake.TaskOperation
import com.codingagent.model.AgentModelProtocol
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
    fun changeWithoutAnyJobDemandsAPlanFirst() {
        val root = Files.createTempDirectory("plan-no-job").toFile()
        val message = PlanScope.check(root, listOf("src/A.kt"))
        assertNotNull(message)
        assertTrue(message!!.contains("approve plan", ignoreCase = true))
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

        val root2 = Files.createTempDirectory("law-pairs2").toFile()
        val (secondCo, secondId) = proposeChange(root2)
        assertTrue(secondCo.approve(secondId, true, "owner", ApprovalType.WORD) is MutationApprovalResult.AwaitingSecond)
        assertTrue(secondCo.approve(secondId, true, "owner", ApprovalType.TAP) is MutationApprovalResult.Applied)
        assertTrue(root2.resolve("src/New.kt").exists())
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

    // ---- Review screen support ----

    @Test
    fun approvalTypesCanBeReadBack() {
        val root = Files.createTempDirectory("law-types-read").toFile()
        val (coordinator, id) = proposeChange(root)
        assertTrue(coordinator.approvalTypesFor(id).isEmpty())
        coordinator.approve(id, true, "owner", ApprovalType.TAP)
        assertEquals(listOf("TAP"), coordinator.approvalTypesFor(id))
    }

    @Test
    fun nextStepGuidanceFollowsThePair() {
        assertEquals(
            "Tap Confirm below, then type approve in chat.",
            com.codingagent.workspace.nextStepGuidance(emptyList())
        )
        assertEquals(
            "Tap recorded. Now type approve in chat.",
            com.codingagent.workspace.nextStepGuidance(listOf("TAP"))
        )
        assertEquals(
            "Word received. Now tap Confirm.",
            com.codingagent.workspace.nextStepGuidance(listOf("WORD"))
        )
        assertEquals(
            "Both approvals recorded.",
            com.codingagent.workspace.nextStepGuidance(listOf("TAP", "WORD"))
        )
    }

    // ---- Wiring audit: expiry cleanup + review binding ----

    @Test
    fun clearExpiredDropsStaleProposalsAndTypes() {
        val root = Files.createTempDirectory("law-expired").toFile()
        var clock = System.currentTimeMillis()
        val coordinator = MutationCoordinator(ProjectWorkspace(root), now = { clock })
        val result = coordinator.propose(
            "stale work",
            listOf(TaskOperation(OperationKind.CREATE_FILE, "src/Stale.kt", text = "class Stale\n")),
            "tests"
        )
        assertTrue(result is MutationProposeResult.Proposed)
        val id = (result as MutationProposeResult.Proposed).proposal.id
        coordinator.approve(id, true, "owner", ApprovalType.TAP)
        assertEquals(1, coordinator.pending().size)
        clock += com.codingagent.agent.AgentConstitution.APPROVAL_EXPIRATION_MS + 1
        coordinator.clearExpired()
        assertTrue(coordinator.pending().isEmpty())
        assertTrue(coordinator.approvalTypesFor(id).isEmpty())
    }

    @Test
    fun reviewBinderShowsLiveProposalAndHidesExpired() {
        val root = Files.createTempDirectory("law-binder").toFile()
        val coordinator = MutationCoordinator(ProjectWorkspace(root))
        val result = coordinator.propose(
            "live work",
            listOf(TaskOperation(OperationKind.CREATE_FILE, "src/Live.kt", text = "class Live\n")),
            "tests"
        )
        val id = (result as MutationProposeResult.Proposed).proposal.id
        val live = com.codingagent.ui.ReviewBinder.bind(coordinator, id)
        assertTrue(live.pendingApproval)
        assertEquals(id, live.proposalId)

        val staleRoot = Files.createTempDirectory("law-binder-stale").toFile()
        val past = System.currentTimeMillis() - com.codingagent.agent.AgentConstitution.APPROVAL_EXPIRATION_MS - 60_000
        val staleCoordinator = MutationCoordinator(ProjectWorkspace(staleRoot), now = { past })
        val staleResult = staleCoordinator.propose(
            "stale work",
            listOf(TaskOperation(OperationKind.CREATE_FILE, "src/Stale.kt", text = "class Stale\n")),
            "tests"
        )
        val staleId = (staleResult as MutationProposeResult.Proposed).proposal.id
        val stale = com.codingagent.ui.ReviewBinder.bind(staleCoordinator, staleId)
        assertTrue(!stale.pendingApproval)
        assertNull(stale.proposalId)
    }
}

class PlanRevisionLawTest {
    @Test fun `better-plan request injects the earlier plan`() {
        val ctx = com.codingagent.agent.PlanRevision.contextFor(
            "make a better plan. this one is shit",
            listOf("Here is your PLAN:\n1. step one\n2. step two")
        )
        assertNotNull(ctx)
        assertTrue(ctx!!.contains("Do NOT search the project"))
        assertTrue(ctx.contains("step one"))
    }

    @Test fun `ordinary request gets no injection`() {
        assertNull(
            com.codingagent.agent.PlanRevision.contextFor(
                "list my files",
                listOf("Here is your PLAN:\n1. step one")
            )
        )
    }

    @Test fun `revision with no earlier plan gets no injection`() {
        assertNull(
            com.codingagent.agent.PlanRevision.contextFor(
                "make a better plan",
                listOf("hello there")
            )
        )
    }
}

class NotebookGuardLawTest {
    @Test fun `notebook paths are detected`() {
        assertTrue(com.codingagent.workspace.NotebookGuard.isNotebookPath(".coding-agent/open-job.json"))
        assertTrue(com.codingagent.workspace.NotebookGuard.isNotebookPath(".coding-agent"))
        assertTrue(com.codingagent.workspace.NotebookGuard.isNotebookPath("./.coding-agent/x.json"))
        assertTrue(com.codingagent.workspace.NotebookGuard.isNotebookPath("/.coding-agent/x.json"))
        assertFalse(com.codingagent.workspace.NotebookGuard.isNotebookPath("src/Main.kt"))
        assertFalse(com.codingagent.workspace.NotebookGuard.isNotebookPath("coding-agent/x.json"))
    }
}

class CodeQualityNotesLawTest {
    @Test fun `identity function is flagged`() {
        val notes = com.codingagent.workspace.CodeQualityNotes.analyze(
            "src/Compiler.kt",
            "fun run(input: String): String = input\n"
        )
        assertEquals(1, notes.size)
        assertTrue(notes[0].contains("pass-through"))
    }

    @Test fun `two-line pass-through is flagged`() {
        val notes = com.codingagent.workspace.CodeQualityNotes.analyze(
            "src/Compiler.kt",
            "fun run(input: String): String =\n    input\n"
        )
        assertTrue(notes.any { it.contains("pass-through") })
    }

    @Test fun `empty body and markers are flagged`() {
        val notes = com.codingagent.workspace.CodeQualityNotes.analyze(
            "src/Widget.kt",
            "class Widget {\n    // TODO: finish this\n    fun render(): String {}\n}\n"
        )
        assertTrue(notes.any { it.contains("TODO") })
        assertTrue(notes.any { it.contains("empty") })
    }

    @Test fun `clean code and non-source files are quiet`() {
        assertTrue(
            com.codingagent.workspace.CodeQualityNotes.analyze(
                "src/Real.kt",
                "fun double(x: Int): Int = x * 2\n"
            ).isEmpty()
        )
        assertTrue(
            com.codingagent.workspace.CodeQualityNotes.analyze("notes.md", "# TODO list\n").isEmpty()
        )
    }
}

class FailureMemoryLawTest {
    @Test fun `failed tasks record a failed verification so lessons file them as failures`() {
        val task = com.codingagent.agent.AgentTaskBuilders.failed(
            "t1",
            "do the thing",
            com.codingagent.workspace.AgentPlan("do the thing", emptyList(), emptyList()),
            "it broke",
            emptyList()
        )
        assertEquals("failed", task.status)
        assertFalse(task.verification.passed)
    }

    @Test fun `legacy poisoned lines are repaired on read`() {
        val root = java.nio.file.Files.createTempDirectory("exp-repair").toFile()
        val recorder = com.codingagent.agent.ExperienceRecorder(root)
        val file = root.resolve(".coding-agent/experience.tsv")
        file.parentFile!!.mkdirs()
        file.writeText("123\ttrue\tdo the thing\tfailed\tit broke\t\n")
        val line = recorder.all().single()
        assertEquals("false", line.split('\t')[1])
        assertEquals("failed", line.split('\t')[3])
    }
}

class PlainChangeSummaryLawTest {
    @Test fun `new file is described in plain words`() {
        val record = com.codingagent.workspace.ChangeRecord(
            path = "src/SaidSophisticatedProfessional.kt",
            operation = com.codingagent.workspace.ChangeOperation.CREATE,
            before = null,
            after = "class SaidSophisticatedProfessional {\n  fun run(input: String): String = input\n}\n",
            reason = "",
            beforeChecksum = "",
            afterChecksum = ""
        )
        val lines = com.codingagent.workspace.PlainChangeSummary.describe(record)
        assertTrue(lines[0].contains("New file: src/SaidSophisticatedProfessional.kt"))
        assertTrue(lines.any { it.contains("It creates: SaidSophisticatedProfessional, run.") })
        assertTrue(lines.none { it.contains("+class") || it.contains("fun run(input") })
    }

    @Test fun `edits are described in plain words`() {
        val record = com.codingagent.workspace.ChangeRecord(
            path = "src/Main.kt",
            operation = com.codingagent.workspace.ChangeOperation.REPLACE,
            before = "fun old(): Int = 1\n",
            after = "fun old(): Int = 2\n",
            reason = "",
            beforeChecksum = "",
            afterChecksum = ""
        )
        val lines = com.codingagent.workspace.PlainChangeSummary.describe(record)
        assertTrue(lines[0].startsWith("Edits src/Main.kt"))
        assertTrue(lines[0].contains("1 line in, 1 line out"))
        assertTrue(lines.any { it.contains("It touches: old.") })
    }
}

class RotationLawTest {
    @Test fun `network failure rotates to the next model`() {
        assertTrue(com.codingagent.model.RotatingModelGateway.isRotatableFailure("Model request failed: Unable to resolve host"))
        assertTrue(com.codingagent.model.RotatingModelGateway.isRotatableFailure("Model request failed: Connect timed out"))
    }

    @Test fun `retired model and empty replies rotate`() {
        assertTrue(com.codingagent.model.RotatingModelGateway.isRotatableFailure("Model HTTP 404: model not found"))
        assertTrue(com.codingagent.model.RotatingModelGateway.isRotatableFailure("Model returned an empty response"))
        assertTrue(com.codingagent.model.RotatingModelGateway.isRotatableFailure("Model HTTP 429: rate limit reached"))
    }

    @Test fun `bad key and missing config stop rotation`() {
        assertFalse(com.codingagent.model.RotatingModelGateway.isRotatableFailure("Model HTTP 401: Unauthorized"))
        assertFalse(com.codingagent.model.RotatingModelGateway.isRotatableFailure("Model gateway configuration is incomplete"))
    }
}
