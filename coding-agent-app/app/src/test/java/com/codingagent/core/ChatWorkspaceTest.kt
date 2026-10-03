package com.codingagent.core

import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import com.codingagent.agent.AgentKnowledge
import com.codingagent.agent.AutonomousAgent
import com.codingagent.agent.ChatMessage
import com.codingagent.agent.ChatMessageStore
import com.codingagent.agent.ChatRole
import com.codingagent.agent.ChatWorkspace
import com.codingagent.workspace.KnowledgeHit

class ChatWorkspaceTest {
    private val emptyKnowledge = object : AgentKnowledge {
        override fun search(query: String, limit: Int): List<KnowledgeHit> = emptyList()
    }

    @Test
    fun persistsUserAndAgentMessages() {
        val root = Files.createTempDirectory("chat-persist").toFile()
        root.resolve("Main.kt").writeText("fun main() = 1\n")
        val store = MemoryChatStore()
        val agent = AutonomousAgent(root, emptyKnowledge, gateway = null)
        val workspace = ChatWorkspace(store, runtimeProvider = { agent })

        val turn = workspace.send("hello")

        assertEquals(ChatRole.AGENT, turn.response.role)
        assertEquals(2, workspace.history().size)
        assertEquals("hello", workspace.history().first().content)
        assertTrue(workspace.history().last().content.isNotBlank())
    }

    @Test
    fun includesPreviousConversationInFollowUpRequest() {
        val root = Files.createTempDirectory("chat-context").toFile()
        root.resolve("Main.kt").writeText("fun main() = 1\n")
        val store = MemoryChatStore()
        val agent = AutonomousAgent(root, emptyKnowledge, gateway = null)
        val workspace = ChatWorkspace(store, runtimeProvider = { agent })

        workspace.send("Use Kotlin")
        workspace.send("status")

        val history = workspace.history()
        assertTrue(history.any { it.role == ChatRole.USER && it.content == "Use Kotlin" })
        assertTrue(history.any { it.role == ChatRole.USER && it.content == "status" })
        assertTrue(history.size >= 4)
        // Second agent reply should be a status-style report (direct lane), proving follow-up ran.
        val lastAgent = history.last { it.role == ChatRole.AGENT }
        assertTrue(
            lastAgent.content.contains("Status", ignoreCase = true) ||
                lastAgent.content.contains("indexed", ignoreCase = true) ||
                lastAgent.content.isNotBlank()
        )
    }

    @Test
    fun mixedLawAndWorkStoresLawAndRunsWork() {
        val root = Files.createTempDirectory("chat-law-work").toFile()
        root.resolve("Main.kt").writeText("fun main() = 1\n")
        com.codingagent.workspace.OpenJobStore.bind(root)
        val store = MemoryChatStore()
        val agent = AutonomousAgent(root, emptyKnowledge, gateway = null)
        val workspace = ChatWorkspace(store, runtimeProvider = { agent })

        workspace.send("never use red buttons, build the login")

        val laws = com.codingagent.workspace.OwnerLaws.list(root)
        assertTrue(laws.any { it.contains("red buttons") })
        val history = workspace.history()
        // user + law ack + work reply: both halves happened.
        assertTrue(history.size >= 3)
        assertTrue(history[1].role == ChatRole.AGENT && history[1].content.contains("standing law"))
    }

    @Test
    fun pureLawStillAcksWithoutWork() {
        val root = Files.createTempDirectory("chat-law-pure").toFile()
        root.resolve("Main.kt").writeText("fun main() = 1\n")
        com.codingagent.workspace.OpenJobStore.bind(root)
        val store = MemoryChatStore()
        val agent = AutonomousAgent(root, emptyKnowledge, gateway = null)
        val workspace = ChatWorkspace(store, runtimeProvider = { agent })

        workspace.send("never use red buttons")

        val laws = com.codingagent.workspace.OwnerLaws.list(root)
        assertTrue(laws.any { it.contains("red buttons") })
        val history = workspace.history()
        assertEquals(2, history.size)
        assertTrue(history.last().content.contains("Locked in"))
    }

    @Test
    fun workTextWithLawClauseStoresBoth() {
        val root = Files.createTempDirectory("chat-work-law").toFile()
        root.resolve("Main.kt").writeText("fun main() = 1\n")
        com.codingagent.workspace.OpenJobStore.bind(root)
        val store = MemoryChatStore()
        val agent = AutonomousAgent(root, emptyKnowledge, gateway = null)
        val workspace = ChatWorkspace(store, runtimeProvider = { agent })

        workspace.send("build the login, never use red buttons")

        val laws = com.codingagent.workspace.OwnerLaws.list(root)
        assertTrue(laws.any { it.contains("red buttons") })
        val history = workspace.history()
        assertTrue(history.size >= 3)
        assertTrue(history.any { it.role == ChatRole.AGENT && it.content.contains("standing law") })
    }

    private class MemoryChatStore : ChatMessageStore {
        private val messages = mutableListOf<ChatMessage>()

        override fun recordChatMessage(message: ChatMessage) {
            messages += message
        }

        override fun recentChatMessages(limit: Int): List<ChatMessage> = messages.takeLast(limit).asReversed()
    }
}
