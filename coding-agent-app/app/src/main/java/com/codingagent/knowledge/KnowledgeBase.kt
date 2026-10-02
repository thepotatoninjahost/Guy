package com.codingagent.knowledge

import android.content.Context
import java.io.File
import com.codingagent.agent.AgentKnowledge
import com.codingagent.workspace.KnowledgeHit

/**
 * ONE JOB: Persist and query offline knowledge documents.
 * User-imported references share one searchable index.
 */
class KnowledgeBase(context: Context) : KnowledgeProvider, AgentKnowledge {
    private val root = File(context.filesDir, "coding-agent/knowledge").apply { mkdirs() }
    private val index = KnowledgeIndex(root)
    private val flagFile = File(root, "bundled.flag")

    init {
        // Legacy purge: very old installs may carry a bundled example document
        // (and its flag) that the app no longer ships. Drop it once; the flag
        // check keeps this a single stat on installs that never had it.
        if (flagFile.isFile) purgeLegacyExample(root)
    }

    fun importAsset(context: Context, assetPath: String, document: String): Int {
        val text = context.assets.open(assetPath).bufferedReader().use { it.readText() }
        return index.indexText(document, "asset:$assetPath", text).chunkCount
    }

    fun ingest(request: IngestRequest): IngestResult = index.indexRequest(request)

    fun ingestFile(file: File, documentName: String? = null): IngestResult =
        index.indexRequest(DocumentIngester.extractFromFile(file, documentName))

    fun ingestText(documentName: String, source: String, text: String): IngestResult =
        index.indexText(documentName, source, text)

    fun listDocuments(): List<IndexedDocument> = index.listDocuments()

    fun removeDocument(name: String): Boolean = index.removeDocument(name)

    fun stats(): Pair<Int, Int> = index.documentCount() to index.chunkCount()

    override fun search(query: String, limit: Int): List<KnowledgeHit> = index.search(query, limit)

    companion object {
        const val LEGACY_EXAMPLE_DOCUMENT = "Coding For Dummies (example)"

        /** Removes the legacy bundled example, if present. Returns true when anything was purged. */
        fun purgeLegacyExample(root: File): Boolean {
            val removed = KnowledgeIndex(root).removeDocument(LEGACY_EXAMPLE_DOCUMENT)
            File(root, "bundled.flag").delete()
            return removed
        }
    }
}
