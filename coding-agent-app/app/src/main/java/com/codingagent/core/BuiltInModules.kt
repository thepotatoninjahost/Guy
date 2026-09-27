package com.codingagent.core

import android.content.Context
import com.codingagent.agent.AgentAction
import com.codingagent.agent.AgentActionCategory
import com.codingagent.workspace.VerificationReport

/**
 * ONE JOB: Install the built-in default live module for a fresh app-private store.
 */
class BuiltInModules(context: Context) {
    private val store = LiveModuleStore(context.filesDir)

    fun installDefault(): ModuleInstallResult = store.installBuiltIn(
        """
        {"kind":"coding","version":1,"steps":[
          {"op":"emit","value":"Live coding module active for: ${'$'}{input}"},
          {"op":"knowledge","value":"${'$'}{input}","argument":"4"},
          {"op":"project_search","value":"${'$'}{input}"},
          {"op":"verify"}
        ]}
        """.trimIndent(), "coding", 1
    )
}
