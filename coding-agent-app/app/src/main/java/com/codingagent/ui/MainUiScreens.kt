package com.codingagent.ui

/**
 * ONE JOB: Chat / Files / Review / Terminal / Research surfaces.
 */

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.documentfile.provider.DocumentFile
import java.io.File
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.codingagent.agent.AgentTools
import com.codingagent.agent.ChatMessage
import com.codingagent.agent.ChatRole
import com.codingagent.workspace.DeepResearchProgress
import com.codingagent.workspace.EditorDocument
import com.codingagent.model.ModelDownloadProgress
import com.codingagent.workspace.ChangeDiff
import com.codingagent.workspace.ChangeOperation
import com.codingagent.workspace.ChangeRecord
import com.codingagent.workspace.DiffLine
import com.codingagent.workspace.DiffLineKind
import com.codingagent.workspace.MutationCoordinator
import com.codingagent.workspace.MutationProposeResult
import com.codingagent.workspace.PendingChangeProposal
import com.codingagent.research.ResearchDisplayState
import com.codingagent.workspace.ResearchHit
import com.codingagent.workspace.TerminalEntry

@Composable
internal fun CompactStatusBar(
    status: AgentStatus,
    detail: String,
    mounted: Boolean,
    modelStatus: String,
    modelProgress: ModelDownloadProgress?,
    onImport: () -> Unit,
    onNewProject: () -> Unit,
    onModelImport: () -> Unit,
    onStop: () -> Unit
) {
    Column(
        Modifier
            .fillMaxWidth()
            .background(Panel)
            .border(1.dp, NeonGreen.copy(alpha = 0.35f))
            .padding(horizontal = 12.dp, vertical = 8.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("CODING AGENT", color = NeonGreen, fontSize = 16.sp, fontWeight = FontWeight.Bold)
                Text(
                    if (mounted) "project mounted · $modelStatus" else "no project · $modelStatus",
                    color = SoftGreen,
                    fontSize = 11.sp,
                    maxLines = 2
                )
            }
            if (status != AgentStatus.READY && status != AgentStatus.STOPPED) {
                TextButton(onClick = onStop) { Text("Stop", color = Danger, fontSize = 12.sp) }
            }
            TextButton(onClick = onModelImport) { Text("Model", color = FluoroOrange, fontWeight = FontWeight.Bold, fontSize = 12.sp) }
            TextButton(onClick = onNewProject) { Text("New", color = NeonGreen, fontWeight = FontWeight.Bold, fontSize = 12.sp) }
            TextButton(onClick = onImport) { Text(if (mounted) "Switch" else "Import", color = SoftGreen, fontWeight = FontWeight.Bold, fontSize = 12.sp) }
        }
        Spacer(Modifier.height(4.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(8.dp).background(status.color, RoundedCornerShape(50)))
            Spacer(Modifier.width(6.dp))
            Text(status.label, color = status.color, fontWeight = FontWeight.Bold, fontSize = 12.sp)
            Spacer(Modifier.width(6.dp))
            Text(detail, color = SoftGreen, fontSize = 11.sp, maxLines = 1)
        }
        if (status == AgentStatus.RESEARCHING || status == AgentStatus.PLANNING || status == AgentStatus.WORKING || status == AgentStatus.MODEL || status == AgentStatus.TOOL || status == AgentStatus.RUNNING || modelProgress?.phase == "downloading") {
            Spacer(Modifier.height(4.dp))
            LinearProgressIndicator(
                progress = { ((modelProgress?.percent ?: 0) / 100f).coerceIn(0f, 1f) },
                Modifier.fillMaxWidth(),
                color = status.color,
                trackColor = Line
            )
        }
    }
}

@Composable
internal fun ChatSurface(
    messages: List<ChatMessage>,
    input: String,
    onInput: (String) -> Unit,
    onSend: () -> Unit,
    busy: Boolean,
    onStop: () -> Unit,
    pendingApproval: Boolean,
    approvalCount: Int,
    reason: String,
    filesSummary: String,
    nextStep: String,
    onApprove: () -> Unit
) {
    val listState = rememberLazyListState()
    LaunchedEffect(messages.size) {
        if (messages.isNotEmpty()) listState.animateScrollToItem(messages.lastIndex)
    }
    Column(Modifier.fillMaxSize()) {
        LazyColumn(
            state = listState,
            modifier = Modifier.weight(1f).fillMaxWidth(),
            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            if (messages.isEmpty()) {
                item {
                    Text(
                        "Type a request in plain English about your project.\nThe agent will look at your files and reply here.",
                        color = SoftGreen,
                        fontSize = 14.sp,
                        modifier = Modifier.padding(vertical = 24.dp)
                    )
                }
            }
            items(messages, key = { it.id }) { ChatBubble(it) }
        }
        if (pendingApproval) ApprovalCard(approvalCount, reason, filesSummary, nextStep, onApprove)
        if (busy) {
            Text("Agent is working…", color = FluoroOrange, fontSize = 12.sp, modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp))
        }
        Column(
            Modifier
                .fillMaxWidth()
                .background(Panel)
                .border(1.dp, NeonGreen.copy(alpha = 0.4f))
                .padding(horizontal = 12.dp, vertical = 12.dp)
        ) {
            OutlinedTextField(
                value = input,
                onValueChange = onInput,
                modifier = Modifier.fillMaxWidth(),
                placeholder = { Text("Describe what you want fixed or added…", color = SoftGreen) },
                minLines = 4,
                maxLines = 8,
                textStyle = TextStyle(color = NeonGreen, fontSize = 16.sp, lineHeight = 22.sp),
                colors = fieldColors()
            )
            Spacer(Modifier.height(10.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (busy) {
                    TextButton(onClick = onStop) { Text("Stop", color = Danger) }
                    Spacer(Modifier.width(8.dp))
                }
                Button(
                    onClick = onSend,
                    enabled = input.isNotBlank(),
                    modifier = Modifier.weight(1f).height(52.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = NeonGreen, contentColor = DarkPurple)
                ) { Text("Send", fontWeight = FontWeight.Bold, fontSize = 16.sp) }
            }
        }
    }
}

@Composable
internal fun ApprovalCard(approvalCount: Int, reason: String, filesSummary: String, nextStep: String, onApprove: () -> Unit) {
    Card(
        Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp),
        colors = CardDefaults.cardColors(containerColor = RaisedPurple),
        border = androidx.compose.foundation.BorderStroke(1.dp, FluoroOrange)
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("CODE CHANGE REVIEW", color = FluoroOrange, fontWeight = FontWeight.Bold)
            Text(reason, color = NeonGreen, fontSize = 13.sp)
            Text(filesSummary, color = SoftGreen, fontSize = 12.sp)
            Text("Nothing is written until you tap Confirm AND type approve in chat.", color = SoftGreen, fontSize = 12.sp)
            Text(nextStep, color = NeonGreen, fontSize = 12.sp, fontWeight = FontWeight.Bold)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("${approvalCount}/2", color = SoftGreen, modifier = Modifier.weight(1f))
                Button(
                    onClick = onApprove,
                    colors = ButtonDefaults.buttonColors(containerColor = FluoroOrange, contentColor = DarkPurple)
                ) { Text("Tap to confirm") }
            }
        }
    }
}

@Composable
internal fun FilesSurface(
    files: List<String>,
    query: String,
    onQuery: (String) -> Unit,
    path: String,
    onPath: (String) -> Unit,
    content: String,
    onContent: (String) -> Unit,
    document: EditorDocument?,
    tools: AgentTools?,
    mutationCoordinator: MutationCoordinator?,
    onStatus: (Pair<AgentStatus, String>) -> Unit,
    onDelete: ((String) -> Unit)? = null,
    projects: List<ProjectInfo> = emptyList(),
    currentProjectPath: String? = null,
    onSwitchProject: ((String) -> Unit)? = null,
    onDeleteProject: ((String) -> Unit)? = null,
    onDocument: ((EditorDocument?) -> Unit)? = null,
    onProposed: ((PendingChangeProposal) -> Unit)? = null
) {
    var showEditor by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf<String?>(null) }
    var showProjects by remember(currentProjectPath) { mutableStateOf(currentProjectPath == null && projects.isNotEmpty()) }
    val filtered = files.filter { it.contains(query.trim(), ignoreCase = true) }
    if (showProjects && onSwitchProject != null && onDeleteProject != null) {
        ProjectsSurface(
            projects = projects,
            currentPath = currentProjectPath,
            onSwitch = { path ->
                showProjects = false
                onSwitchProject(path)
            },
            onDelete = onDeleteProject
        )
        return
    }
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("PROJECT FILES", color = NeonGreen, fontSize = 18.sp, fontWeight = FontWeight.Bold)
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                "PROJECT: " + (currentProjectPath?.let { File(it).name } ?: "(none)"),
                color = SoftGreen,
                fontSize = 12.sp,
                modifier = Modifier.weight(1f)
            )
            if (onSwitchProject != null) {
                TextButton(onClick = { showProjects = true }) { Text("Change", color = NeonGreen, fontSize = 12.sp) }
            }
        }
        OutlinedTextField(query, onQuery, Modifier.fillMaxWidth(), placeholder = { Text("Filter files", color = SoftGreen) }, singleLine = true, colors = fieldColors())
        if (showEditor) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(path, color = FluoroOrange, modifier = Modifier.weight(1f), fontFamily = FontFamily.Monospace)
                TextButton(onClick = { showEditor = false }) { Text("Close", color = SoftGreen) }
            }
            CodeEditor(content, onContent, path)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = { onContent(document?.content.orEmpty()) }, colors = ButtonDefaults.buttonColors(containerColor = RaisedPurple)) { Text("Revert", color = NeonGreen) }
                Button(
                    onClick = {
                        runCatching {
                            val coordinator = mutationCoordinator ?: error("Project mutation coordinator is unavailable")
                            val result = tools?.proposeSave(path, content, coordinator) ?: error("Project tools are unavailable")
                            when (result) {
                                is MutationProposeResult.Proposed -> {
                                    onProposed?.invoke(result.proposal)
                                    onStatus(AgentStatus.APPROVAL to "Save proposed; tap Confirm in Review, then type the word in chat (${result.proposal.id.take(8)})")
                                }
                                is MutationProposeResult.Rejected ->
                                    onStatus(AgentStatus.STOPPED to "Save proposal rejected: ${result.reason}")
                            }
                        }.onFailure { onStatus(AgentStatus.STOPPED to (it.message ?: "Save proposal failed")) }
                    },
                    enabled = document != null && document.content != content && mutationCoordinator != null,
                    colors = ButtonDefaults.buttonColors(containerColor = NeonGreen, contentColor = DarkPurple)
                ) { Text("Propose save") }
            }
        } else {
            if (filtered.isEmpty()) EmptyState("No files", "Tap New for an empty project, Import an existing folder, or change the filter.")
            LazyColumn(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                items(filtered, key = { it }) { file ->
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .background(Panel, RoundedCornerShape(12.dp))
                            .border(1.dp, LinePurple, RoundedCornerShape(12.dp))
                            .clickable {
                                runCatching {
                                    val loaded = tools?.read(file) ?: return@runCatching
                                    onPath(file)
                                    onContent(loaded.content)
                                    onDocument?.invoke(loaded)
                                    showEditor = true
                                    onStatus(AgentStatus.READY to "Opened $file")
                                }.onFailure { onStatus(AgentStatus.STOPPED to "Open failed") }
                            }
                            .padding(14.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text("{ }", color = FluoroOrange, fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold)
                        Spacer(Modifier.width(12.dp))
                        Text(file, color = NeonGreen, fontFamily = FontFamily.Monospace, fontSize = 13.sp, modifier = Modifier.weight(1f))
                        if (onDelete != null) {
                            TextButton(onClick = {
                                if (confirmDelete == file) {
                                    confirmDelete = null
                                    onDelete(file)
                                } else {
                                    confirmDelete = file
                                }
                            }) {
                                Text(
                                    if (confirmDelete == file) "Sure?" else "Delete",
                                    color = if (confirmDelete == file) Danger else SoftGreen,
                                    fontSize = 12.sp
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
internal fun CodeEditor(content: String, onContent: (String) -> Unit, path: String) {
    val highlighted = remember(content, path) { highlightCode(content) }
    Box(
        Modifier
            .fillMaxWidth()
            .height(360.dp)
            .background(DarkPurple, RoundedCornerShape(12.dp))
            .border(1.dp, NeonGreen.copy(alpha = 0.5f), RoundedCornerShape(12.dp))
            .padding(12.dp)
    ) {
        BasicTextField(
            value = content,
            onValueChange = onContent,
            modifier = Modifier.fillMaxSize(),
            textStyle = TextStyle(color = Color.Transparent, fontFamily = FontFamily.Monospace, fontSize = 13.sp, lineHeight = 19.sp),
            decorationBox = { inner ->
                Box(Modifier.fillMaxSize()) {
                    Text(highlighted, fontFamily = FontFamily.Monospace, fontSize = 13.sp, lineHeight = 19.sp)
                    inner()
                }
            }
        )
    }
}

internal fun highlightCode(content: String): AnnotatedString = buildAnnotatedString {
    val keywords = Regex("\\b(fun|class|object|interface|val|var|if|else|when|return|import|package|public|private|suspend|async|await|def|from|const|let|function|export|type)\\b")
    var cursor = 0
    keywords.findAll(content).forEach { match ->
        append(content.substring(cursor, match.range.first))
        withStyle(SpanStyle(color = FluoroOrange, fontWeight = FontWeight.Bold)) { append(match.value) }
        cursor = match.range.last + 1
    }
    append(content.substring(cursor))
}

@Composable
internal fun ReviewSurface(
    pending: Boolean,
    approvals: Int,
    reason: String,
    proposal: PendingChangeProposal?,
    nextStep: String,
    onApprove: () -> Unit,
    onReject: () -> Unit
) {
    LazyColumn(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            Text("CHANGE REVIEW", color = NeonGreen, fontSize = 18.sp, fontWeight = FontWeight.Bold)
        }
        if (!pending) {
            item { EmptyState("No pending changes", "Agent proposals appear here before anything is written.") }
        } else {
            item {
                Card(colors = CardDefaults.cardColors(containerColor = Panel), border = androidx.compose.foundation.BorderStroke(1.dp, FluoroOrange)) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("Proposed changes", color = FluoroOrange, fontWeight = FontWeight.Bold)
                        Text(reason, color = NeonGreen)
                        val count = proposal?.changeSet?.changes?.size
                        Text(
                            when {
                                count == null -> "Loading the proposal…"
                                count == 1 -> "1 file would change. Nothing is written until you approve."
                                else -> "$count files would change. Nothing is written until you approve."
                            },
                            color = SoftGreen, fontSize = 12.sp
                        )
                        if (proposal != null) {
                            val ok = proposal.verification.passed
                            Text(verificationLine(proposal), color = if (ok) NeonGreen else FluoroOrange, fontSize = 12.sp)
                            val qualityNotes = proposal.changeSet.changes.flatMap {
                                com.codingagent.workspace.CodeQualityNotes.analyze(it.path, it.after)
                            }.distinct()
                            if (qualityNotes.isNotEmpty()) {
                                Text(
                                    "Heads-up (warnings only):\n" + qualityNotes.joinToString("\n") { "• $it" },
                                    color = FluoroOrange, fontSize = 12.sp
                                )
                            }
                        }
                        Text(nextStep, color = NeonGreen, fontSize = 13.sp, fontWeight = FontWeight.Bold)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(onClick = onReject, colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF4A2030))) { Text("Reject", color = NeonGreen) }
                            Button(onClick = onApprove, colors = ButtonDefaults.buttonColors(containerColor = FluoroOrange, contentColor = DarkPurple)) { Text("Tap to confirm") }
                        }
                    }
                }
            }
            proposal?.changeSet?.changes?.forEach { record ->
                item(key = record.operation.name + ":" + record.path) {
                    FileReviewCard(record)
                }
            }
        }
    }
}

private val DiffRed = Color(0xFFFF7B7B)

@Composable
private fun FileReviewCard(record: ChangeRecord) {
    Card(colors = CardDefaults.cardColors(containerColor = Panel), border = androidx.compose.foundation.BorderStroke(1.dp, FluoroOrange)) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(record.path, color = NeonGreen, fontWeight = FontWeight.Bold, fontSize = 13.sp)
            val lines = remember(record) { ChangeDiff.unified(record) }
            val added = lines.count { it.kind == DiffLineKind.ADD }
            val removed = lines.count { it.kind == DiffLineKind.REMOVE }
            Text("${plainOp(record.operation)} · +$added lines, -$removed lines", color = SoftGreen, fontSize = 12.sp)
            if (record.reason.isNotBlank()) {
                Text(record.reason.take(200), color = SoftGreen, fontSize = 12.sp)
            }
            Text(
                diffAnnotated(lines),
                fontFamily = FontFamily.Monospace,
                fontSize = 11.sp,
                lineHeight = 14.sp
            )
        }
    }
}

private fun plainOp(op: ChangeOperation): String = when (op) {
    ChangeOperation.CREATE -> "New file"
    ChangeOperation.REPLACE -> "Edits"
    ChangeOperation.APPEND -> "Adds to the end"
    ChangeOperation.REMOVE -> "Deletes"
}

private fun verificationLine(proposal: PendingChangeProposal): String {
    val v = proposal.verification
    if (v.passed && v.issues.isEmpty()) return "Checks passed."
    if (v.passed) return "Checks passed with ${v.issues.size} note(s)."
    val first = v.issues.firstOrNull()?.message.orEmpty().take(120)
    return "Checks found ${v.issues.size} problem(s). First: $first"
}

private fun diffAnnotated(lines: List<DiffLine>): AnnotatedString = buildAnnotatedString {
    lines.forEach { line ->
        val color = when (line.kind) {
            DiffLineKind.ADD -> NeonGreen
            DiffLineKind.REMOVE -> DiffRed
            DiffLineKind.HEADER -> FluoroOrange
            DiffLineKind.CONTEXT -> SoftGreen
        }
        withStyle(SpanStyle(color = color)) { append(line.text) }
        append("\n")
    }
}

@Composable
internal fun TerminalSurface(
    command: String,
    onCommand: (String) -> Unit,
    history: List<TerminalEntry>,
    liveOutput: String,
    cwd: String,
    shell: String,
    timeoutSeconds: Long,
    running: Boolean,
    enabled: Boolean,
    onRun: (String) -> Unit,
    onStop: () -> Unit,
    onClear: () -> Unit
) {
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("TERMINAL", color = NeonGreen, fontSize = 18.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            TextButton(onClick = onClear, enabled = !running && history.isNotEmpty()) { Text("Clear", color = SoftGreen) }
            TextButton(onClick = onStop, enabled = running) { Text("Stop", color = Danger) }
        }
        Text(
            "$shell   cwd=$cwd   timeout=${timeoutSeconds}s   ${if (running) "RUNNING" else "IDLE"}",
            color = if (running) FluoroOrange else SoftGreen,
            fontFamily = FontFamily.Monospace,
            fontSize = 11.sp
        )
        Text(
            "Runs shell commands inside your project folder. Programs that ask you questions (like editors) can't work here — edit in the Files tab instead.",
            color = SoftGreen,
            fontSize = 12.sp
        )
        OutlinedTextField(
            command,
            onCommand,
            Modifier.fillMaxWidth(),
            placeholder = { Text("ls", color = SoftGreen) },
            enabled = enabled && !running,
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii),
            colors = fieldColors()
        )
        Button(
            onClick = { onRun(command) },
            enabled = enabled && !running && command.isNotBlank(),
            colors = ButtonDefaults.buttonColors(containerColor = NeonGreen, contentColor = DarkPurple)
        ) { Text(if (running) "Running" else "Run") }
        if (running || liveOutput.isNotBlank()) {
            Text(
                if (running) liveOutput.ifBlank { "(running)" } else liveOutput,
                Modifier.fillMaxWidth().background(DarkPurple, RoundedCornerShape(10.dp)).border(1.dp, FluoroOrange, RoundedCornerShape(10.dp)).padding(12.dp),
                color = FluoroOrange,
                fontFamily = FontFamily.Monospace,
                fontSize = 12.sp
            )
        }
        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(history.asReversed(), key = { "${it.command}-${it.durationMs}-${it.exitCode}-${it.stdout.length}" }) { entry ->
                val body = buildString {
                    append("$ ")
                    append(entry.command)
                    append('\n')
                    if (entry.stdout.isNotBlank()) append(entry.stdout).append('\n')
                    if (entry.stderr.isNotBlank()) append(entry.stderr).append('\n')
                    append("exit=${entry.exitCode}")
                    append("  ${entry.durationMs}ms")
                    if (entry.timedOut) append("  timeout")
                    if (entry.cancelled) append("  cancelled")
                }
                Text(
                    body,
                    Modifier.fillMaxWidth().background(DarkPurple, RoundedCornerShape(10.dp)).border(1.dp, LinePurple, RoundedCornerShape(10.dp)).padding(12.dp),
                    color = if (entry.exitCode == 0 && !entry.timedOut && !entry.cancelled) NeonGreen else Danger,
                    fontFamily = FontFamily.Monospace,
                    fontSize = 12.sp
                )
            }
        }
    }
}

internal fun DeepResearchProgress.toDisplayState() =
    ResearchDisplayState(stage, completed, total, successful, failed, canSend = false)

@Composable
internal fun ResearchSurface(
    query: String,
    onQuery: (String) -> Unit,
    hits: List<ResearchHit>,
    error: String?,
    state: ResearchDisplayState,
    onSearch: (String) -> Unit
) {
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("WEB RESEARCH", color = NeonGreen, fontSize = 18.sp, fontWeight = FontWeight.Bold)
        Text("Type a full sentence in plain English. You can see the whole text while typing.", color = SoftGreen, fontSize = 13.sp)
        Text(
            "${state.phase.uppercase()}  ${state.completed}/${state.total} sources  •  full=${state.fullSources}  failed=${state.failedSources}",
            color = if (state.phase == "blocked") Danger else FluoroOrange,
            fontFamily = FontFamily.Monospace,
            fontSize = 12.sp
        )
        OutlinedTextField(
            value = query,
            onValueChange = onQuery,
            modifier = Modifier.fillMaxWidth(),
            placeholder = { Text("Describe what you want to research in plain English…", color = SoftGreen) },
            minLines = 5,
            maxLines = 10,
            textStyle = TextStyle(color = NeonGreen, fontSize = 16.sp, lineHeight = 22.sp),
            colors = fieldColors()
        )
        Button(
            onClick = { onSearch(query) },
            enabled = query.isNotBlank(),
            modifier = Modifier.fillMaxWidth().height(52.dp),
            colors = ButtonDefaults.buttonColors(containerColor = NeonGreen, contentColor = DarkPurple)
        ) { Text("Search", fontWeight = FontWeight.Bold, fontSize = 16.sp) }
        error?.let { Text(it, color = Danger, fontSize = 12.sp) }
        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(hits, key = { it.url }) { hit ->
                Card(
                    colors = CardDefaults.cardColors(containerColor = Panel),
                    border = androidx.compose.foundation.BorderStroke(1.dp, LinePurple)
                ) {
                    Column(Modifier.padding(12.dp)) {
                        Text(hit.title, color = NeonGreen, fontWeight = FontWeight.Bold)
                        Text(hit.excerpt, color = SoftGreen, fontSize = 13.sp)
                        Text(hit.url, color = FluoroOrange, fontSize = 11.sp, maxLines = 2)
                    }
                }
            }
        }
    }
}

@Composable
internal fun ChatBubble(message: ChatMessage) {
    val user = message.role == ChatRole.USER
    Row(Modifier.fillMaxWidth(), horizontalArrangement = if (user) Arrangement.End else Arrangement.Start) {
        Column(
            Modifier
                .fillMaxWidth(0.92f)
                .background(if (user) Color(0xFF0F2A14) else Panel, RoundedCornerShape(14.dp))
                .border(1.dp, if (user) NeonGreen.copy(alpha = 0.5f) else LinePurple, RoundedCornerShape(14.dp))
                .padding(12.dp)
        ) {
            Text(
                if (user) "YOU" else if (message.role == ChatRole.AGENT) "AGENT" else "SYSTEM",
                color = if (user) NeonGreen else FluoroOrange,
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold
            )
            Spacer(Modifier.height(4.dp))
            Text(message.content, color = NeonGreen, fontSize = 14.sp, lineHeight = 20.sp)
        }
    }
}

@Composable
internal fun EmptyState(title: String, body: String) {
    Column(Modifier.fillMaxWidth().padding(vertical = 28.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(title, color = NeonGreen, fontWeight = FontWeight.Bold, fontSize = 17.sp)
        Spacer(Modifier.height(6.dp))
        Text(body, color = SoftGreen, fontSize = 13.sp)
    }
}

@Composable
internal fun fieldColors() = androidx.compose.material3.OutlinedTextFieldDefaults.colors(
    focusedTextColor = NeonGreen,
    unfocusedTextColor = NeonGreen,
    focusedBorderColor = NeonGreen,
    unfocusedBorderColor = LinePurple,
    cursorColor = NeonGreen,
    focusedContainerColor = DarkPurple,
    unfocusedContainerColor = DarkPurple
)

data class ProjectInfo(
    val name: String,
    val path: String,
    val fileCount: Int,
    val updatedAt: Long
)

/** Every project folder on this phone, newest first. Counts match the Files list. */
fun listProjects(privateDir: File): List<ProjectInfo> {
    val projectsRoot = privateDir.resolve("projects")
    val dirs = projectsRoot.listFiles { file -> file.isDirectory }?.toList().orEmpty()
    return dirs.map { dir ->
        var count = 0
        var latest = dir.lastModified()
        runCatching {
            dir.walkTopDown().maxDepth(8).forEach { entry ->
                if (entry.isFile && !isAppNotebook(dir, entry)) {
                    count++
                    if (entry.lastModified() > latest) latest = entry.lastModified()
                }
            }
        }
        ProjectInfo(dir.name, dir.absolutePath, count, latest)
    }.sortedByDescending { it.updatedAt }
}

/** True for the app's own notebook folder (open job, research) — never shown as project files. */
fun isAppNotebook(projectRoot: File, entry: File): Boolean {
    val relative = runCatching { entry.relativeTo(projectRoot).invariantSeparatorsPath }.getOrElse { return false }
    return relative == ".coding-agent" || relative.startsWith(".coding-agent/")
}

/**
 * Every real file in a project, any extension — this is what the Files screen shows.
 * (The agent's indexed-sources whitelist is separate and unchanged.)
 */
fun listProjectFiles(projectRoot: File): List<String> {
    if (!projectRoot.isDirectory) return emptyList()
    return runCatching {
        projectRoot.walkTopDown().maxDepth(10)
            .filter { it.isFile && !isAppNotebook(projectRoot, it) }
            .map { it.relativeTo(projectRoot).invariantSeparatorsPath }
            .sorted().take(2000).toList()
    }.getOrElse { emptyList() }
}

/** Deletes a whole project folder. Refuses anything outside the projects root. */
fun deleteProject(dir: File, privateDir: File) {
    val projectsRoot = privateDir.resolve("projects").canonicalFile
    require(dir.canonicalFile.toPath().startsWith(projectsRoot.toPath())) { "Refusing to delete outside the projects folder" }
    require(dir.isDirectory) { "Project folder is already gone" }
    require(dir.deleteRecursively()) { "Could not delete ${dir.name}" }
}

/**
 * Create a genuinely empty project under app-private storage.
 * No SAF import required — this is the first-class "start from nothing" path.
 */
fun createEmptyProject(privateDir: File, nameHint: String? = null): File {
    val projectsRoot = privateDir.resolve("projects")
    if (!projectsRoot.exists()) require(projectsRoot.mkdirs()) { "Could not create projects root" }
    val safeName = nameHint
        ?.trim()
        ?.replace(Regex("[^A-Za-z0-9._-]"), "-")
        ?.trim('-')
        ?.take(48)
        ?.ifBlank { null }
    val dirName = if (safeName != null) {
        "project-$safeName-${System.currentTimeMillis()}"
    } else {
        "project-${System.currentTimeMillis()}"
    }
    val destination = projectsRoot.resolve(dirName)
    require(destination.mkdirs()) { "Could not create empty project storage" }
    // Marker so the folder is clearly an intentional empty workspace
    destination.resolve("README.md").writeText(
        "# ${safeName ?: "New project"}\n\nEmpty workspace created by Coding Agent.\nAsk the agent to add files, or import sources.\n"
    )
    return destination
}

@Composable
internal fun ProjectsSurface(
    projects: List<ProjectInfo>,
    currentPath: String?,
    onSwitch: (String) -> Unit,
    onDelete: (String) -> Unit
) {
    var confirmDelete by remember { mutableStateOf<String?>(null) }
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("PROJECTS ON THIS PHONE", color = NeonGreen, fontSize = 18.sp, fontWeight = FontWeight.Bold)
        Text(
            "Tap a project to open its files. Delete removes the whole folder.",
            color = SoftGreen,
            fontSize = 12.sp
        )
        if (projects.isEmpty()) {
            EmptyState("No projects yet", "Tap New up top for an empty project, or Import a folder.")
        }
        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(projects, key = { it.path }) { project ->
                val isCurrent = currentPath != null && File(currentPath).absolutePath == File(project.path).absolutePath
                Column(
                    Modifier
                        .fillMaxWidth()
                        .background(Panel, RoundedCornerShape(12.dp))
                        .border(1.dp, if (isCurrent) NeonGreen.copy(alpha = 0.5f) else LinePurple, RoundedCornerShape(12.dp))
                        .clickable { onSwitch(project.path) }
                        .padding(14.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            if (isCurrent) "● " else "○ ",
                            color = if (isCurrent) NeonGreen else SoftGreen,
                            fontWeight = FontWeight.Bold
                        )
                        Text(
                            project.name,
                            color = NeonGreen,
                            fontFamily = FontFamily.Monospace,
                            fontSize = 13.sp,
                            modifier = Modifier.weight(1f)
                        )
                    }
                    Text(
                        "${project.fileCount} files" + if (isCurrent) " · current" else "",
                        color = SoftGreen,
                        fontSize = 12.sp
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (!isCurrent) {
                            Text(
                                "Tap to open",
                                color = SoftGreen,
                                fontSize = 12.sp,
                                modifier = Modifier.weight(1f).align(Alignment.CenterVertically)
                            )
                        }
                        Button(
                            onClick = {
                                if (confirmDelete == project.path) {
                                    confirmDelete = null
                                    onDelete(project.path)
                                } else {
                                    confirmDelete = project.path
                                }
                            },
                            colors = ButtonDefaults.buttonColors(
                                containerColor = if (confirmDelete == project.path) Danger else Color(0xFF4A2030)
                            )
                        ) { Text(if (confirmDelete == project.path) "Tap again to delete" else "Delete", color = NeonGreen) }
                    }
                    if (confirmDelete == project.path) {
                        Text("This removes the whole folder and its files.", color = Danger, fontSize = 12.sp)
                    }
                }
            }
        }
    }
}

internal fun importProject(context: Context, privateDir: File, uri: Uri): File {
    val source = DocumentFile.fromTreeUri(context, uri) ?: error("Folder is unavailable")
    val destination = privateDir.resolve("projects").resolve("project-${System.currentTimeMillis()}")
    require(destination.mkdirs()) { "Could not create project storage" }
    copyDocumentTree(context, source, destination)
    return destination
}

internal fun copyDocumentTree(context: Context, source: DocumentFile, destination: File) {
    for (child in source.listFiles()) {
        val name = child.name ?: continue
        val target = destination.resolve(name)
        if (child.isDirectory) {
            require(target.mkdirs()) { "Could not create ${target.path}" }
            copyDocumentTree(context, child, target)
        } else if (child.isFile) {
            context.contentResolver.openInputStream(child.uri)?.use { input ->
                target.outputStream().use { output -> input.copyTo(output) }
            } ?: error("Could not read ${child.uri}")
        }
    }
}

internal val ImportFlags = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
