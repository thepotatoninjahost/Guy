package com.codingagent.workspace

/**
 * The two different kinds of owner approval. The owner's law: one tap plus one
 * typed word — two genuinely different acts, both only possible from the owner's
 * hands. The agent can perform neither and can fake neither.
 */
enum class ApprovalType {
    /** A button tap (Review screen or the chat approval card). */
    TAP,

    /** A typed word in chat (approve, confirm, apply...). */
    WORD
}

/** Plain-words guidance telling the owner how to finish the pair. */
fun ApprovalType.finishGuidance(): String = when (this) {
    ApprovalType.TAP -> "Tap Confirm (Review tab or the approval card) to finish."
    ApprovalType.WORD -> "Type approve in chat to finish."
}
