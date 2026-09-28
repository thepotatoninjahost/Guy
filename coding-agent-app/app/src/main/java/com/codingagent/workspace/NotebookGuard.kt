package com.codingagent.workspace

/** The app's private notebook folder — off limits to the model and to change tools. */
object NotebookGuard {
    const val NOTEBOOK_DIR = ".coding-agent"

    fun isNotebookPath(path: String): Boolean {
        var t = path.trim().replace('\\', '/')
        while (t.startsWith("./")) t = t.drop(2)
        t = t.trimStart('/')
        return t == NOTEBOOK_DIR || t.startsWith("$NOTEBOOK_DIR/")
    }

    fun refusal(): String =
        "That folder is the app's private notebook — off limits. Never list, read, or change anything under .coding-agent/."
}
