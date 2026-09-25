# Gunther · Android project access contract (v1)

This is the contract between the Gunther web console and the Android shell.
It exists because the console cannot reach a real project on its own: the
console's `js/workspace.js` model is an in-memory/localStorage abstraction, and
`localStorage` is not a project.

Everything below is implemented by `GuntherProjectPlugin.java` in the APK and
consumed by `js/host.js`. The same contract is also implemented by
`test/hosts/node-host.mjs` so the product code can be exercised against real
files and real processes without a device. **The rig host is a contract
harness, not a device.**

## Why the native layer must own the project

- The console is a WebView. A WebView cannot list a directory, cannot write a
  file, and cannot execute a process.
- `localStorage` is capped, opaque, and lost with app data — it cannot be a
  project the user owns or retrieves.
- Android's storage rules, not the console's, decide what is reachable.

## Storage model

```
<app files>/projects/
  index.json                 { projects: [ {id, name, createdAt} ] }
  <projectId>/               the project root — the real files live here
    gunther.project.json     optional command manifest (see below)
    ...the user's project files
```

- Project storage is **app-private** (`getFilesDir()`): no runtime permission,
  no scoped-storage ambiguity, survives restart until the user deletes it.
- Import brings files in from the device through the Storage Access Framework;
  export writes them back out through the same framework. Neither path needs a
  permission because the user grants each URI individually.

## Method contract

All methods take one options object and resolve one object. Failures reject with
`(message, code)`; `js/host.js` normalizes every outcome to
`{ok: true, ...}` or `{ok: false, code, message}`.

| Method | Options | Resolves |
| --- | --- | --- |
| `hostInfo` | — | `platform, apiLevel, abi, storageRoot, pluginVersion, writable` |
| `probeToolchain` | — | `shell, path, tools: [{name, path, available, note}]` |
| `listProjects` | — | `projects: [{id, name, createdAt, fileCount, bytes}]` |
| `createProject` | `name` | `project: {id, name, createdAt}` |
| `deleteProject` | `id` | `deleted` |
| `listFiles` | `id` | `files: [{path, bytes, binary}], truncated` |
| `readFile` | `id, path` | `path, text, bytes, binary` |
| `writeFile` | `id, path, text` | `path, bytes` |
| `deleteFile` | `id, path` | `deleted` |
| `runCommand` | `id, argv, timeoutMs` | `argv, cwd, code, stdout, stderr, durationMs, timedOut, truncated, runner` |
| `importFolder` | `name` | `project, imported, skipped, cancelled` |
| `importArchive` | `name` | `project, imported, skipped, cancelled` |
| `exportArchive` | `id, name` | `saved, fileName, bytes, files, cancelled` |

`runCommand` never uses a shell to interpret the model's text: `argv` is passed
to `ProcessBuilder` as an argument vector. Shell syntax is only meaningful when
the caller explicitly asks for `["sh", "script.sh"]`.

## Execution rules (these are the honest limits)

1. **Only system binaries execute.** The app targets API 36. Android 10+ refuses
   `execve()` on files in the app's own data directory (W^X), so a project's own
   binary or `chmod +x` script *cannot* be executed, directly or indirectly.
   `argv[0]` must therefore resolve inside `/system/bin`, `/system/xbin`,
   `/vendor/bin`, or `/apex/com.android.runtime/bin`. A project-local executable
   is rejected with code `BINARY_NOT_ALLOWED` and told to run through `sh`.
2. **Only declared commands run.** The native layer enforces "system binary";
   the console additionally allows the model to run only the commands declared
   in the project's `gunther.project.json`, snapshotted at task start. A model
   cannot author itself a passing verification command mid-task.
3. **`cwd` is always the project root** and can never escape it.
4. **Everything is bounded**: 120 s default timeout (600 s max), 200 KB captured
   per stream with `truncated: true` when cut, output decoded as UTF-8.
5. **Unavailable is reported as unavailable.** Whatever `probeToolchain` cannot
   find (for a stock Android 15/16 device: `node`, `npm`, `python3`, `git`,
   `make`) is reported as unavailable, with the reason, and no command needing it
   is simulated.

## Command manifest — `gunther.project.json`

```json
{
  "gunther": 1,
  "name": "tiny-shop",
  "commands": {
    "verify": { "argv": ["sh", "verify.sh"], "label": "run the project's own check" }
  }
}
```

- The manifest is a **project file**, so it is visible, editable, reviewable, and
  travels with the project.
- A command declared *during* a task is not runnable until the operator approves
  it in the Project room; the approval is stored per project and per argv.
- Runs record the exact `argv` and exit code, so a trivially passing command is
  visible in the evidence rather than hidden.

## Evidence

A run is recorded as evidence with: project, task, step, command name, exact
argv, cwd, exit code, duration, timeout/truncation flags, stdout, stderr, host
(`android` or `rig`), trigger (`operator`, `agent`, `auto`), and timestamp.
Verdicts are derived from these records and nothing else. Model prose is never
evidence that a command passed.
