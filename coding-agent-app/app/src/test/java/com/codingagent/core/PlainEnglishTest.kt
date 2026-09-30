package com.codingagent.core

import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import com.codingagent.agent.AgentKnowledge
import com.codingagent.agent.AgentOfflineStager
import com.codingagent.agent.AgentPlanner
import com.codingagent.agent.AgentPrompt
import com.codingagent.agent.AutonomousAgent
import com.codingagent.agent.AutonomousAgentEvent
import com.codingagent.agent.ChatMessage
import com.codingagent.agent.ChatRole
import com.codingagent.agent.ChatWorkspace
import com.codingagent.agent.ResponseQualityRules
import com.codingagent.intake.CodeSynthesisEngine
import com.codingagent.intake.SynthesisResult
import com.codingagent.intake.TaskIntakeParser
import com.codingagent.intake.TaskIntent
import com.codingagent.model.ModelGateway
import com.codingagent.model.ModelRequest
import com.codingagent.model.ModelResponse
import com.codingagent.ui.createEmptyProject
import com.codingagent.ui.deleteProject
import com.codingagent.ui.listProjectFiles
import com.codingagent.ui.listProjects
import com.codingagent.workspace.KnowledgeHit
import com.codingagent.workspace.MutationCoordinator
import com.codingagent.workspace.OpenJobStore
import com.codingagent.workspace.ProjectWorkspace

/**
 * The owner speaks plain English and is not a programmer. The agent must
 * translate — never demand code/errors, never argue — and stale work must
 * never bleed across tasks or projects.
 */
class PlainEnglishTest {
    private val knowledge = object : AgentKnowledge {
        override fun search(query: String, limit: Int): List<KnowledgeHit> = emptyList()
    }

    @Test
    fun agentPromptCarriesPlainEnglishOwnerRules() {
        val root = Files.createTempDirectory("prompt-plain").toFile()
        val intake = TaskIntakeParser(root).parse("improve the login flow")
        val prompt = AgentPrompt.build("improve the login flow", intake, "", 1000, lessons = "")
        assertTrue(prompt.contains("plain English", ignoreCase = true))
        assertTrue(prompt.contains("Never argue"))
        assertTrue(prompt.contains("never ask for code", ignoreCase = true))
        assertTrue(prompt.contains("no error messages yet", ignoreCase = true))
    }

    @Test
    fun responseFormatCentersPlainEnglishOwner() {
        assertTrue(ResponseQualityRules.FORMAT.contains("plain English"))
        assertTrue(ResponseQualityRules.FORMAT.contains("Never argue"))
    }

    @Test
    fun vagueChangeAsksInPlainWords() {
        val root = Files.createTempDirectory("synthesis-plain").toFile()
        val intake = TaskIntakeParser(root).parse("improve the login flow")
        val result = CodeSynthesisEngine(root, knowledge).synthesize(intake)
        assertTrue(result is SynthesisResult.NeedsInput)
        val question = (result as SynthesisResult.NeedsInput).question
        assertTrue(question.contains("your own words"))
        assertFalse(question.contains("code shape"))
        assertFalse(question.contains("file operation"))
    }

    @Test
    fun existingFileConflictStaysPlain() {
        val root = Files.createTempDirectory("synthesis-exists").toFile()
        root.resolve("src").mkdirs()
        root.resolve("src/Helper.kt").writeText("class Helper\n")
        val intake = TaskIntakeParser(root).parse("create a Kotlin helper in src/Helper.kt")
        val result = CodeSynthesisEngine(root, knowledge).synthesize(intake)
        assertTrue(result is SynthesisResult.NeedsInput)
        val question = (result as SynthesisResult.NeedsInput).question
        assertTrue(question.contains("replace it"))
        assertTrue(question.contains("your own words"))
    }

    @Test
    fun buildMeRoutesToCreateWhileBuildProjectStaysTest() {
        val root = Files.createTempDirectory("intent-build").toFile()
        assertEquals(TaskIntent.CREATE, TaskIntakeParser(root).parse("build me a job tracker").intent)
        assertEquals(TaskIntent.CREATE, TaskIntakeParser(root).parse("scaffold a notes app").intent)
        assertEquals(TaskIntent.TEST, TaskIntakeParser(root).parse("build the project").intent)
    }

    @Test
    fun modelTranslatesVagueChangeOnEmptyProject() {
        val root = Files.createTempDirectory("stage-model").toFile()
        root.resolve("README.md").writeText("# demo\n")
        val workspace = ProjectWorkspace(root)
        val intake = TaskIntakeParser(root).parse("improve the login flow")
        val plan = AgentPlanner(workspace).plan(intake)
        val gateway = object : ModelGateway {
            override fun complete(request: ModelRequest): ModelResponse = ModelResponse.Text("ok")
        }
        // Null = not staged offline = the model gets the turn and translates.
        assertNull(
            AgentOfflineStager.stage(
                "t1", "improve the login flow", intake, plan,
                workspace, knowledge, MutationCoordinator(workspace), gateway
            )
        )
    }

    @Test
    fun modelBuildsVagueCreateOnEmptyProject() {
        val root = Files.createTempDirectory("stage-create-model").toFile()
        root.resolve("README.md").writeText("# demo\n")
        val workspace = ProjectWorkspace(root)
        val intake = TaskIntakeParser(root).parse("build me a compiler")
        val plan = AgentPlanner(workspace).plan(intake)
        val gateway = object : ModelGateway {
            override fun complete(request: ModelRequest): ModelResponse = ModelResponse.Text("ok")
        }
        // Null = not staged offline = the brain builds the real thing, no skeleton theft.
        assertNull(
            AgentOfflineStager.stage(
                "t1", "build me a compiler", intake, plan,
                workspace, knowledge, MutationCoordinator(workspace), gateway
            )
        )
    }

    @Test
    fun offlineVagueChangeSaysNoModelInsteadOfLooping() {
        val root = Files.createTempDirectory("stage-nomodel").toFile()
        root.resolve("README.md").writeText("# demo\n")
        val agent = AutonomousAgent(root, knowledge, gateway = null)
        val events = agent.run("improve the login flow")
        val terminal = events.last()
        assertTrue(terminal is AutonomousAgentEvent.Completed)
        assertTrue((terminal as AutonomousAgentEvent.Completed).task.summary.contains("not configured"))
    }

    @Test
    fun openJobSupersededByGenuinelyNewGoal() {
        val root = Files.createTempDirectory("open-job-new").toFile()
        val first = OpenJobStore.openOrKeep(root, "build a job tracker")
        val second = OpenJobStore.openOrKeep(root, "fix the login screen")
        assertNotEquals(first.id, second.id)
        assertEquals("fix the login screen", OpenJobStore.load(root)!!.goal)
    }

    @Test
    fun openJobKeepsWaitingApprovalWhenNewGoalArrives() {
        val root = Files.createTempDirectory("open-job-waiting").toFile()
        val first = OpenJobStore.openOrKeep(root, "build a job tracker")
        OpenJobStore.markWaiting(root, "proposal-1", listOf("src/Tracker.kt"), null)
        val second = OpenJobStore.openOrKeep(root, "fix the login screen")
        assertEquals(first.id, second.id)
    }

    @Test
    fun switchMarkerScopesMemoryToCurrentProject() {
        val prior = listOf(
            ChatMessage(role = ChatRole.USER, content = "old project talk"),
            ChatMessage(role = ChatRole.AGENT, content = "old reply"),
            ChatMessage(role = ChatRole.SYSTEM, content = ChatWorkspace.PROJECT_SWITCH_MARKER + " now in new-project."),
            ChatMessage(role = ChatRole.USER, content = "new project talk")
        )
        val scoped = ChatWorkspace.scopeToCurrentProject(prior)
        assertEquals(2, scoped.size)
        assertTrue(scoped.none { it.content == "old project talk" })
        assertTrue(scoped.any { it.content == "new project talk" })
    }

    @Test
    fun projectsListAndDeleteRoundtrip() {
        val privateDir = Files.createTempDirectory("projects-ui").toFile()
        val alpha = createEmptyProject(privateDir, "alpha")
        createEmptyProject(privateDir, "beta")
        val listed = listProjects(privateDir)
        assertEquals(2, listed.size)
        assertTrue(listed.any { it.path == alpha.absolutePath && it.fileCount >= 1 })
        deleteProject(alpha, privateDir)
        assertFalse(alpha.exists())
        assertEquals(1, listProjects(privateDir).size)
    }

    @Test
    fun deleteProjectRefusesOutsideRoot() {
        val privateDir = Files.createTempDirectory("projects-safe").toFile()
        val outside = Files.createTempDirectory("outside").toFile()
        val result = runCatching { deleteProject(outside, privateDir) }
        assertTrue(result.isFailure)
        assertTrue(outside.exists())
    }

    @Test
    fun fileListShowsEveryExtensionExceptAppNotebook() {
        val root = Files.createTempDirectory("all-files").toFile()
        root.resolve("notes.txt").writeText("hi\n")
        root.resolve("data.csv").writeText("a,b\n")
        root.resolve("Main.kt").writeText("fun main() = 1\n")
        root.resolve(".coding-agent").mkdirs()
        root.resolve(".coding-agent/open-job.json").writeText("{}\n")
        val listed = listProjectFiles(root)
        assertTrue(listed.contains("notes.txt"))
        assertTrue(listed.contains("data.csv"))
        assertTrue(listed.contains("Main.kt"))
        assertTrue(listed.none { it.contains(".coding-agent") })
    }

    @Test
    fun projectCountsMatchVisibleFiles() {
        val privateDir = Files.createTempDirectory("counts").toFile()
        val project = createEmptyProject(privateDir, "gamma")
        project.resolve(".coding-agent").mkdirs()
        project.resolve(".coding-agent/open-job.json").writeText("{}\n")
        val info = listProjects(privateDir).single { it.path == project.absolutePath }
        assertEquals(listProjectFiles(project).size, info.fileCount)
    }
}
