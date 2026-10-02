package com.codingagent.model

import java.util.concurrent.atomic.AtomicInteger

/**
 * ONE JOB: Try the next configured model when the current one fails — any failure
 * except a bad key / missing config (those hit every entry identically, so there
 * is no point burning the list). Same base URL + API key; only the model id
 * changes. Sticks on the first model that succeeds so subsequent turns stay on
 * a working endpoint until it fails again.
 */
class RotatingModelGateway(
    private val entries: List<Entry>,
    private val onRotated: ((fromModel: String, toModel: String, reason: String) -> Unit)? = null
) : ModelGateway {

    data class Entry(val modelId: String, val gateway: ModelGateway)

    private val index = AtomicInteger(0)

    init {
        require(entries.isNotEmpty()) { "RotatingModelGateway requires at least one model entry" }
    }

    fun currentModelId(): String = entries[index.get().coerceIn(0, entries.lastIndex)].modelId

    fun modelIds(): List<String> = entries.map { it.modelId }

    /**
     * Step past the current model after an off-goal reply. Returns the model id
     * now in force. With a single entry this is a no-op (same model retries).
     */
    fun advancePastCurrent(reason: String): String {
        val cur = index.get().coerceIn(0, entries.lastIndex)
        val next = (cur + 1) % entries.size
        index.set(next)
        onRotated?.invoke(entries[cur].modelId, entries[next].modelId, reason)
        return entries[next].modelId
    }

    override fun complete(request: ModelRequest): ModelResponse =
        runWithRotation { it.complete(request) }

    override fun stream(request: ModelRequest, onDelta: (String) -> Unit): ModelResponse =
        runWithRotation { it.stream(request, onDelta) }

    private fun runWithRotation(call: (ModelGateway) -> ModelResponse): ModelResponse {
        val start = index.get().coerceIn(0, entries.lastIndex)
        var lastFailure: ModelResponse.Failure? = null
        val attempts = mutableListOf<Pair<String, String>>()

        for (offset in entries.indices) {
            val idx = (start + offset) % entries.size
            val entry = entries[idx]
            val response = call(entry.gateway)

            if (response !is ModelResponse.Failure) {
                // Stick on the model that worked so the next turn does not bounce.
                if (idx != start) {
                    index.set(idx)
                }
                return response
            }

            lastFailure = response
            attempts += entry.modelId to response.message.take(200)
            if (!isRotatableFailure(response.message)) {
                // Bad key / missing config hits every entry identically — stop here.
                return response
            }

            if (offset < entries.lastIndex) {
                val next = entries[(idx + 1) % entries.size]
                onRotated?.invoke(entry.modelId, next.modelId, response.message.take(160))
                // Brief pause so a shared free-tier bucket has a chance to recover
                // between consecutive model switches on the same key.
                try {
                    Thread.sleep(400L)
                } catch (_: InterruptedException) {
                    Thread.currentThread().interrupt()
                    return response
                }
            }
        }

        val last = lastFailure?.message.orEmpty()
        return ModelResponse.Failure(buildString {
            append("All ${entries.size} models failed. Last error: $last")
            if (attempts.isNotEmpty()) {
                append("\nAttempts:")
                attempts.forEach { (id, msg) -> append("\n- ").append(id).append(": ").append(msg.take(160)) }
            }
        })
    }

    companion object {
        /**
         * Rotation exists so the brain is never unreachable: every failure moves
         * to the next model EXCEPT failures that would hit every entry identically
         * (bad key / missing config — all entries share one base URL and key).
         */
        fun isRotatableFailure(message: String): Boolean = !isFinalFailure(message)

        private fun isFinalFailure(message: String): Boolean {
            val lower = message.lowercase()
            return "configuration is incomplete" in lower ||
                "401" in lower ||
                "unauthorized" in lower ||
                "invalid api key" in lower ||
                "invalid-api-key" in lower ||
                "incorrect api key" in lower ||
                "invalid authentication" in lower ||
                "authentication failed" in lower ||
                "no api key" in lower ||
                "must provide an api key" in lower
        }

        fun build(
            baseUrl: String,
            apiKey: String,
            modelIds: List<String>,
            timeoutMillis: Int = 60_000,
            extraHeaders: Map<String, String> = emptyMap(),
            connectionFactory: ((String) -> java.net.HttpURLConnection)? = null,
            onRotated: ((fromModel: String, toModel: String, reason: String) -> Unit)? = null
        ): ModelGateway {
            val unique = modelIds.map { it.trim() }.filter { it.isNotEmpty() }.distinctBy { it.lowercase() }
            require(unique.isNotEmpty()) { "At least one model id is required" }
            val entries = unique.map { id ->
                val gw = if (connectionFactory != null) {
                    RemoteHttpGateway(baseUrl, apiKey, id, timeoutMillis, connectionFactory, extraHeaders)
                } else {
                    RemoteHttpGateway(baseUrl, apiKey, id, timeoutMillis, extraHeaders = extraHeaders)
                }
                Entry(id, gw)
            }
            return if (entries.size == 1) entries.single().gateway
            else RotatingModelGateway(entries, onRotated)
        }
    }
}
