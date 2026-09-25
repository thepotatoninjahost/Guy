# Gunther — project handoff

This is the durable handoff for the next conversation. Read it before inspecting or changing code.

## 1. Project identity

- Repository: `thepotatoninjahost/Guy`
- Product in the repository: **Gunther**
- The repository name is historical access infrastructure. Do not rename it.
- Guy is not the product and is intentionally not being recovered.
- Gunther is intended to be a personal autonomous coding agent implemented as a native Android application—not a web application packaged inside a WebView and not merely a chat screen.

## 2. Owner's actual acceptance bar

Gunther is useful only when the complete product loop works on a real project inside the product:

1. The user imports, creates, or opens a real project.
2. Gunther can browse and understand the real project files.
3. Gunther researches unknown requirements and records usable source citations.
4. Gunther makes a concrete plan.
5. A capable model edits the real project through controlled tools.
6. Gunther runs the project's real build, test, lint, or verification commands from inside the Android product.
7. Gunther reads the actual output, including failures.
8. Gunther repairs the project and reruns verification.
9. The task survives interruption, restart, and resume without losing project state or evidence.
10. Gunther delivers the complete result with an honest report of what passed, failed, or could not be verified.

A passing internal test suite, a successful provider PING, a built APK, a polished interface, or a model returning plausible prose is not evidence that this loop works.

## 3. Non-negotiable owner rules

- Quality over speed.
- Research before design or capability claims.
- Do not weaken tests to increase model pass rates.
- Do not treat provider marketing claims as proof of coding ability.
- Do not treat PING success as proof of coding ability.
- Use real `transport.call` for live coding qualification.
- Report shipped, isolated-tested, live-tested, failed, and unavailable capabilities separately.
- Report exact counts with denominators when counts are relevant, but do not present them as product proof.
- Models that fail the current live coding qualification are excluded from coding selection.
- Do not invent provider IDs, routes, quota, account access, or capabilities.
- Do not add infrastructure that is not usable from the Android product.
- Do not call a foundation, adapter, test suite, or APK build a complete agent.
- Do not modify the project until the proposed change is tied to the complete end-to-end acceptance bar.
- If a capability is unavailable, say so instead of creating a workaround that changes the product architecture without approval.

## 4. What exists now

### Current repository state (not the final architecture)

- The current repository contains a hand-built HTML/CSS/JavaScript console packaged by a Capacitor Android shell.
- That web UI is a prototype/foundation and does **not** satisfy the required product architecture.
- The final Gunther product must be a native Android application. Do not continue treating the WebView UI as the product to finish.
- CHAT and PLAN behavior exists only in the current prototype and must be re-evaluated during the native implementation.
- Fleet credentials, rotation, usage ledgers, dials, work log, archive, and mobile layout.

### Workspace and agent foundations

- `js/workspace.js`: safe versioned in-memory workspace; file CRUD, exact edits, snapshots, rollback transactions, validation, file/history limits.
- `js/state.js`: persisted application state including workspace and task state.
- `js/agent-tools.js`: explicit workspace tools for list/read/create/edit/delete.
- `js/agent-runner.js`: bounded provider-to-workspace tool loop.
- `js/agent-runtime.js`: durable tasks and steps, evidence, sources, learnings, resume behavior, and interruption handling.
- `js/ui/console.js`: PLAN dispatches coding steps through the workspace tool loop.

### Model fleet

- `js/models.js`: provider/model manifest and limits.
- `js/transport.js`: provider call layer.
- `js/engine.js`: admission, selection, quota/trip accounting, handoff, and current qualification gate.
- `js/ui/bays.js`: credential management and live qualification controls.
- `js/qualification.js`: four-task coding qualification and evidence assessment.

### Tests and build

- `test/engine.test.mjs`
- `test/agent-runtime.test.mjs`
- `test/workspace.test.mjs`
- `test/agent-tools.test.mjs`
- `test/agent-runner.test.mjs`
- `test/qualification.test.mjs`
- `test/archive.test.mjs`
- `test/smoke.test.mjs`
- `.github/workflows/gunther-apk.yml`: Android test/package workflow.

## 5. Evidence currently available

### Isolated deterministic evidence

The complete local suite has most recently reported:

- Engine: 54/54
- Agent runtime: 16/16
- Workspace: 15/15
- Agent tools: 14/14
- Agent runner: 5/5
- Qualification logic: 7/7
- Archive: 24/24
- Smoke: 121/121
- Combined: 256/256

This proves only that the tested internal contracts behave as written. It does not prove that Gunther is a useful autonomous coding product.

### Android build evidence

The Android CI workflow has successfully run tests and produced debug/release APK artifacts in previous runs. This proves packaging/build health only, not end-to-end agent capability.

### Live model evidence

The owner ran the four-task live qualification from the APK. The current owner-reported result is that only these two models pass all four tasks:

- Nemotron 3 Ultra 550B
- GPT-OSS 120B

This is a coding-capability filter, not an intelligence score. Other models must remain unqualified or be replaced until a new live run demonstrates otherwise.

Qualification uses `transport.call`; PING is only endpoint/key response testing. Qualification results are versioned so an old evaluator result cannot silently remain authoritative after the evaluator changes.

## 6. What is missing or not acceptable yet

These are product blockers, not cosmetic backlog items:

1. **Project import/export and file browser**
   - The user needs to bring a real project into Gunther and retrieve it afterward.
   - The UI must show the actual project files and changes.
   - Persistence must work across restart.

2. **Android-native project access**
   - The APK needs a real, permission-safe way to access an imported project.
   - The current workspace model is an in-memory/state abstraction, not proof of native project access.

3. **In-product command execution**
   - Gunther must execute the imported project's actual verification commands from inside the APK.
   - Output must be captured as durable evidence.
   - Unsupported platforms/commands must be reported honestly rather than simulated.

4. **Test-and-repair loop**
   - A failed command must become model-readable evidence.
   - The model must be able to repair files, rerun the command, and stop only on pass or an honest block.
   - A model's final prose must never be treated as proof that a command passed.

5. **Research and citations**
   - Gunther needs real search/fetch/source tools and durable source records attached to tasks.
   - It must distinguish researched facts from model guesses.

6. **Reusable memory and skills**
   - Learnings need controlled persistence and reuse across projects.
   - Any self-improvement must be reviewable, bounded, and reversible.

7. **Complete delivery**
   - The product needs a finished-project export/delivery flow with files, verification evidence, and known limitations.

8. **Qualification diagnostics**
   - The UI currently emphasizes N/4.
   - It should show each task's pass/fail result, missing evidence, and provider/error reason.

## 7. Required implementation order

Do not jump back to cosmetic work or more fleet polishing. Work in this order:

1. Define the Android project storage/import contract.
2. Implement user-facing import/export and file browsing.
3. Implement the native command-execution contract for imported projects.
4. Connect command output to durable task evidence.
5. Add the repair/rerun loop to PLAN.
6. Validate the complete loop against a real small project in the APK.
7. Add research/source tools and attach them to the same durable task record.
8. Add reusable learnings/skills only after the basic loop is real.
9. Improve delivery and qualification diagnostics.

Each stage must be demonstrated in the actual product, not only covered by isolated tests.

## 8. How the next conversation must begin

Before editing:

1. Read this file.
2. Run `git status` and inspect the current branch.
3. Inspect the relevant existing implementation.
4. State the product identity and the end-to-end acceptance bar accurately.
5. Identify the single largest blocker in the required order above.
6. Explain how the proposed change will work inside the Android product.
7. Do not create a workaround or external dependency without explicit approval.
8. Implement one connected slice, then demonstrate it with a real product workflow.
9. Report what is shipped, what was isolated-tested, what was live-tested, and what remains unavailable.

This handoff is a durable reconstruction of the currently recoverable project state. It is not a claim that Gunther is complete, and it cannot substitute for conversation history that was never implemented or preserved.
