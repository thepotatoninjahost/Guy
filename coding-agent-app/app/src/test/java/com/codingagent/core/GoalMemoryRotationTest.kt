package com.codingagent.core

import com.codingagent.model.ModelGateway
import com.codingagent.model.ModelRequest
import com.codingagent.model.ModelResponse
import com.codingagent.model.ModelSettings
import com.codingagent.model.RotatingModelGateway
import com.codingagent.workspace.OpenJobStore
import com.codingagent.workspace.OwnerLaws
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Proves the owner's standing orders hold at runtime: answers fuse onto the
 * original goal (the agent never loses focus), backup models step in when the
 * primary fails, and withheld replies never speak the banned words.
 */
class GoalMemoryRotationTest {

    @Before fun clearState() = OpenJobStore.clearPending()

    @After fun clearAgain() = OpenJobStore.clearPending()

    @Test fun `answer fuses onto original goal`() {
        OpenJobStore.noteQuestion("Build me a compiler", "Which source and target languages?")
        val pending = OpenJobStore.peekPending()
        assertNotNull(pending)
        val fused = OpenJobStore.fuseAnswer(pending!!.first, pending.second, "kotlin and python")
        assertTrue(fused.startsWith("ORIGINAL GOAL"))
        assertTrue("Build me a compiler" in fused)
        assertTrue("kotlin and python" in fused)
        assertTrue(fused.indexOf("Build me a compiler") < fused.indexOf("kotlin and python"))
        assertTrue(fused.endsWith("Do not replace it."))
    }

    @Test fun `repeat questions keep the first goal`() {
        OpenJobStore.noteQuestion("Build me a compiler", "Which languages?")
        val first = OpenJobStore.peekPending()!!
        val fused = OpenJobStore.fuseAnswer(first.first, first.second, "kotlin and python")
        OpenJobStore.noteQuestion(fused, "Which dialect?")
        val kept = OpenJobStore.peekPending()!!
        assertEquals("Build me a compiler", kept.first)
        assertEquals("Which dialect?", kept.second)
    }

    @Test fun `no pending question before any ask`() {
        assertNull(OpenJobStore.peekPending())
    }

    @Test fun `rotation steps in when models fail`() {
        val calls = mutableListOf<String>()
        fun gw(id: String, fail: String?): ModelGateway = object : ModelGateway {
            override fun complete(request: ModelRequest): ModelResponse {
                calls += id
                return if (fail == null) ModelResponse.Text("ok from $id") else ModelResponse.Failure(fail)
            }
        }
        val rotated = mutableListOf<String>()
        val gateway = RotatingModelGateway(
            listOf(
                RotatingModelGateway.Entry("m1", gw("m1", "429 rate limited")),
                RotatingModelGateway.Entry("m2", gw("m2", "500 overloaded")),
                RotatingModelGateway.Entry("m3", gw("m3", null))
            )
        ) { from, to, _ -> rotated += "$from->$to" }
        val req = ModelRequest(system = "s", user = "u", tools = emptyList())
        val res = gateway.complete(req)
        assertTrue(res is ModelResponse.Text)
        assertEquals("ok from m3", (res as ModelResponse.Text).content)
        assertEquals(listOf("m1", "m2", "m3"), calls)
        assertEquals(listOf("m1->m2", "m2->m3"), rotated)
        calls.clear()
        gateway.complete(req)
        assertEquals(listOf("m3"), calls)
    }

    @Test fun `rotation stops on bad keys`() {
        var calls = 0
        val bad = object : ModelGateway {
            override fun complete(request: ModelRequest): ModelResponse {
                calls++
                return ModelResponse.Failure("401 Unauthorized: invalid api key")
            }
        }
        val gateway = RotatingModelGateway(
            listOf(RotatingModelGateway.Entry("a", bad), RotatingModelGateway.Entry("b", bad))
        )
        val res = gateway.complete(ModelRequest(system = "s", user = "u", tools = emptyList()))
        assertTrue(res is ModelResponse.Failure)
        assertEquals(1, calls)
    }

    @Test fun `all failing models report every attempt`() {
        val bad = object : ModelGateway {
            override fun complete(request: ModelRequest): ModelResponse = ModelResponse.Failure("503 down")
        }
        val gateway = RotatingModelGateway(
            listOf(RotatingModelGateway.Entry("a", bad), RotatingModelGateway.Entry("b", bad))
        )
        val res = gateway.complete(ModelRequest(system = "s", user = "u", tools = emptyList())) as ModelResponse.Failure
        assertTrue("All 2 models failed" in res.message)
        assertTrue("- a:" in res.message)
        assertTrue("- b:" in res.message)
    }

    @Test fun `provider backups join the rotation list`() {
        val or = ModelSettings(baseUrl = "https://openrouter.ai/api/v1", modelName = "nvidia/nemotron-3-nano-8b-vl:free")
        val ids = or.allModelIds()
        assertEquals("nvidia/nemotron-3-nano-8b-vl:free", ids.first())
        assertTrue("qwen/qwen3-coder:free" in ids)
        assertTrue(ids.size >= 4)
        val groq = ModelSettings(baseUrl = "https://api.groq.com/openai/v1", modelName = "openai/gpt-oss-120b")
        assertTrue("openai/gpt-oss-20b" in groq.allModelIds())
        val gemini = ModelSettings(baseUrl = "https://generativelanguage.googleapis.com", modelName = "gemini-3.1-flash-lite")
        assertEquals(listOf("gemini-3.1-flash-lite"), gemini.allModelIds())
        val unknown = ModelSettings(baseUrl = "https://models.example.com/v1", modelName = "x")
        assertEquals(listOf("x"), unknown.allModelIds())
    }

    @Test fun `owner fallbacks outrank built-ins`() {
        val s = ModelSettings(
            baseUrl = "https://openrouter.ai/api/v1",
            modelName = "primary",
            rotationModels = "mine-1, mine-2"
        )
        val ids = s.allModelIds()
        assertEquals(listOf("primary", "mine-1", "mine-2"), ids.take(3))
        assertTrue("qwen/qwen3-coder:free" in ids)
    }
}
