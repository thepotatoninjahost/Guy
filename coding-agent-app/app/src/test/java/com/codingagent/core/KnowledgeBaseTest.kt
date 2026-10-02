package com.codingagent.core

import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import com.codingagent.knowledge.KnowledgeBase
import com.codingagent.knowledge.KnowledgeIndex

class KnowledgeBaseTest {
    @Test
    fun legacyExamplePurgeRemovesOldDocumentAndFlag() {
        val root = Files.createTempDirectory("kb-purge").toFile()
        KnowledgeIndex(root).indexText(
            "Coding For Dummies (example)",
            "asset:knowledge/coding-for-dummies.txt",
            "Coding for beginners. ".repeat(30)
        )
        root.resolve("bundled.flag").writeText("1")
        assertEquals(1, KnowledgeIndex(root).listDocuments().size)

        assertTrue(KnowledgeBase.purgeLegacyExample(root))

        assertTrue(KnowledgeIndex(root).listDocuments().isEmpty())
        assertTrue(!root.resolve("bundled.flag").exists())
    }

    @Test
    fun legacyExamplePurgeIsNoopWhenAbsent() {
        val root = Files.createTempDirectory("kb-purge-clean").toFile()
        assertTrue(!KnowledgeBase.purgeLegacyExample(root))
    }
}
