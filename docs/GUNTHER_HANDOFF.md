# Gunther — project handoff

This is the durable handoff for the next conversation. Read it before inspecting or changing code.

## 1. Project identity

- Repository: `thepotatoninjahost/Guy`
- Product in the repository: **Gunther**
- The repository name is historical access infrastructure. Do not rename it.
- Guy is not the product and is intentionally not being recovered.
- Gunther is intended to be a personal autonomous coding agent in an Android/Capacitor application, not merely a chat screen.

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

### Product shell

- Hand-built HTML/CSS/JavaScript console.
- Capacitor Android shell under `android/`.
- CHAT and PLAN modes.
- Fleet credentials, rotation, usage ledgers, dials, work log, archive, and mobile layout.

### Workspace and agent foundations

- `js/workspace.js`: safe versioned in-memory workspace; file CRUD, exact edits, snapshots, rollback transactions, validation, file/history limits.
- `js/state.js`: persisted application state including workspace and task state.
- `js/agent-tools.js`: explicit workspace tools for list/read/create/edit/delete.
- `js/agent-runner.js`: bounded provider-to-workspace tool loop.
- `js/agent-runtime.js`: durable tasks and steps, evidence, sources, learnings, resume behavior, and interruption handling.
- `js/ui/console.js`: PLAN dispatches coding steps through the workspace tool loop.

### Real project access and execution (added this session)

- `docs/android-project-contract.md`: the contract between the console and Android — app-private project storage, thirteen host methods, argv-vector execution limited to system binaries, the `gunther.project.json` command manifest, and the evidence record shape.
- `js/host.js`: the single door to the device. `hostKind()` is `android | rig | none`; no host is a stated verdict (`NO_HOST`), never a silent stand-in.
- `js/project.js`: hydrate a real project into the mirror and report what could not be mirrored; flush the mirror back to real files; write the delivery report from records only.
- `js/evidence.js`: `executeCommand()` is the only source of run records; verdicts come from real exit codes.
- `js/build-loop.js`: `verifiedStep()` — run the project's own declared command, and when it fails, hand the model the real command record and run it again (bounded).
- `js/ui/project.js` + `css/09-project.css`: the Project room — host badge and probed tool chips, projects, file browser and editor, command approval, run and evidence ledger.
- `android/app/src/main/java/com/gunther/console/GuntherProjectPlugin.java`: the Android host (registered in `MainActivity`). Compiles in CI; not yet exercised on a physical device.
- `test/hosts/node-host.mjs`: a contract harness implementing the same thirteen methods against real files and real processes. It is explicitly labelled a harness, never a device.

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
- `test/project.test.mjs` — the host/project contract against the rig
- `test/evidence.test.mjs` — command records and verdicts
- `test/repair-loop.test.mjs` — fail → repair → pass, including a lying model
- `test/project-room.test.mjs` — the real UI in jsdom, working a real project
- `test/smoke.test.mjs`
- `test/_harness.mjs` — counts assertions that actually ran
- `test/hosts/node-host.mjs` — the rig host (real files, real processes, NOT a device)
- `.github/workflows/gunther-apk.yml`: Android test/package workflow. Note: this session's branch was added to its push trigger list so pushes build; remove it when the branch is merged.

## 5. Evidence currently available

### Isolated deterministic evidence

The complete local suite (`npm test`, re-run 2026-09-25) reports **489 assertions across twelve suites, 0 failures**:

- Engine: 54 · Agent runtime: 18 · Workspace: 13 · Agent tools: 15 · Agent runner: 5
- Qualification logic: 6 · Archive: 24 · Project/host contract: 67 · Command evidence: 47
- Repair loop: 53 · Project room (whole product in jsdom + rig host): 50 · Smoke (whole app): 137

The counts are now *measured* at runtime by `test/_harness.mjs`; earlier counts in this document were hand-typed and drifted from reality. The suite passes on a clean CI runner as well.

Two of these suites go beyond internal contracts:

- `test/repair-loop.test.mjs` builds a real project on disk, runs its real `verify.sh`, watches it fail, repairs it, and watches it pass — including a "model" that lies about the result, whose prose is ignored in favour of the exit code.
- `test/project-room.test.mjs` boots the real `index.html` in jsdom and works the room against the rig host: create → hydrate → unapproved run refused → run (exit 1) → edit in the room's editor → run (exit 0) → approve invalidation on argv change → report written into the real project.

This proves the loop works against the rig host (real files, real processes). It does **not** prove the Android plugin behaves identically on a device.

### Android build evidence

CI run `36185981833` (branch `arena/01a0da2a-guy`, 2026-09-25) ran the full suite, `cap sync android`, and built both APKs:

- `gunther-debug-apk` — 4 249 336 bytes
- `gunther-release-apk` — 3 017 465 bytes

The first CI run on this branch caught a real compile error in the plugin (`JSONArray cannot be converted to JSArray`); it was fixed and the second run built. Before that, the plugin had **never been compiled anywhere**. This is compile evidence, not device evidence — no APK has been run on a phone in this session.

### Live model evidence

The owner ran the four-task live qualification from the APK. The current owner-reported result is that only these two models pass all four tasks:

- Nemotron 3 Ultra 550B
- GPT-OSS 120B

This is a coding-capability filter, not an intelligence score. Other models must remain unqualified or be replaced until a new live run demonstrates otherwise.

Qualification uses `transport.call`; PING is only endpoint/key response testing. Qualification results are versioned so an old evaluator result cannot silently remain authoritative after the evaluator changes.

## 6. What is missing or not acceptable yet

These are product blockers, not cosmetic backlog items:

1. **Device validation of the whole loop** (work order 6 — the only step that can close the others)
   - Import a real small project through the system picker on a phone, run its real command, watch it fail, repair it, watch it pass.
   - Storage/import, file browser, command execution, evidence and the repair loop are now implemented and rig-tested; **none of it has run on a device**. Until it has, treat every device claim as unverified.

2. **Toolchain reality on device**
   - Android ships toybox, not node/npm/python. The probe reports what is missing instead of simulating it, so a project whose check needs `node` will honestly be unrunnable on-device today.
   - A decision is needed on how (or whether) to support such projects — not invented by the agent.

3. **Command approval ergonomics**
   - The Project room renders approval state and the gate is enforced, but there is no approve/revoke control in the room yet (approval is currently reachable only through `window.__gunther.project.approve()`); `runDeclaredCommand` already tells the operator to "approve it in the Project room first".

4. **Research and citations** (unchanged — work order 7)
   - Real search/fetch/source tools and durable source records attached to tasks; it must distinguish researched facts from model guesses.

5. **Reusable memory and skills** (unchanged — work order 8)
   - Learnings need controlled persistence and reuse across projects; any self-improvement must be reviewable, bounded, and reversible.

6. **Complete delivery** (partially there)
   - `GUNTHER-REPORT.md` is written from command records at the end of a plan, and projects export as `.zip`. A finished-project flow with files, verification evidence and known limitations still needs review on a device.

7. **Qualification diagnostics** (unchanged — work order 9)
   - Show each qualification task's pass/fail, missing evidence, and provider/error reason, not only N/4.

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

Status against this order after the current session: **items 1–5 are implemented** (native contract, import/export + browser, command execution, command output as durable evidence, repair/rerun in PLAN), rig-tested end to end, and compile-verified in CI. **Item 6 — validation in the APK on a real device — is not done** and is the gate on calling any of it device-proven. Items 7–9 are untouched.

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
