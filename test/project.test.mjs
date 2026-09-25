/* Gunther · project + host contract tests.
   Runs against the rig host: real directories, real files, real archives. */

import { assert, sumUp } from "./_harness.mjs";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNodeHost } from "./hosts/node-host.mjs";
import { callHost, clearHost, commandAvailability, hostKind, probeHost, setHost } from "../js/host.js";
import {
  MANIFEST_FILE,
  approvedCommands,
  buildReport,
  commandKey,
  createProject,
  deleteProject,
  exportArchive,
  fileTree,
  flushWorkspace,
  humanBytes,
  hydrateProject,
  importArchive,
  importFolder,
  listProjects,
  parseManifest,
  pendingCommands,
  preferredCommand,
  renderManifest,
} from "../js/project.js";
import { readFile, writeFile } from "../js/workspace.js";

/* ---------- 1. honesty without a host ---------- */
assert.equal(hostKind(), "none");
const noHost = await callHost("listProjects");
assert.equal(noHost.ok, false);
assert.equal(noHost.code, "NO_HOST");
assert.match(noHost.message, /Android app/);
const noProbe = await probeHost();
assert.equal(noProbe.available, false);

/* ---------- 2. the rig host announces itself as a harness ---------- */
const root = mkdtempSync(join(tmpdir(), "gunther-rig-"));
const host = createNodeHost({ root });
setHost(host);
assert.equal(hostKind(), "rig");
const probe = await probeHost();
assert.equal(probe.available, true);
assert.equal(probe.info.platform, "rig");
assert.match(probe.info.device, /NOT a device/);
assert.equal(Array.isArray(probe.toolchain.tools), true);
assert.equal(probe.toolchain.tools.some((t) => t.name === "sh" && t.available), true);

/* ---------- 3. create → write → hydrate ---------- */
const made = await createProject("rig demo");
assert.equal(made.ok, true);
const project = made.project;
const wrote = await callHost("writeFile", { id: project.id, path: "src/app.sh", text: "echo hi\n" });
assert.equal(wrote.ok, true);
const manifestText = renderManifest("rig demo", [{ name: "verify", argv: ["sh", "verify.sh"], label: "check it" }]);
await callHost("writeFile", { id: project.id, path: MANIFEST_FILE, text: manifestText });
await callHost("writeFile", { id: project.id, path: "verify.sh", text: "exit 0\n" });

const hydrated = await hydrateProject(project);
assert.equal(hydrated.ok, true);
assert.equal(hydrated.loaded.length, 3);
assert.equal(hydrated.complete, true);
assert.equal(readFile(hydrated.workspace, "src/app.sh"), "echo hi\n");
assert.equal(hydrated.manifest.commands[0].name, "verify");
assert.equal(hydrated.manifest.commands[0].argv.join(" "), "sh verify.sh");

/* ---------- 4. what cannot be mirrored is reported, not hidden ---------- */
const dir = join(root, "projects", project.id);
writeFileSync(join(dir, "blob.bin"), Buffer.from([1, 2, 0, 4]));
writeFileSync(join(dir, "big.txt"), "x".repeat(2_000_001));
for (let i = 0; i < 4; i++) writeFileSync(join(dir, "extra-" + i + ".txt"), "e\n");
const partial = await hydrateProject(project, { maxFiles: 3 });
assert.equal(partial.ok, true);
assert.equal(partial.loaded.length, 3);
assert.equal(partial.complete, false);
assert.equal(partial.skipped.some((s) => s.path === "blob.bin" && /binary/.test(s.reason)), true);
assert.equal(partial.skipped.some((s) => s.path === "big.txt" && /2 MB/.test(s.reason)), true);
assert.equal(partial.skipped.some((s) => /-file working limit/.test(s.reason)), true);
assert.equal(partial.baseline.opaque.has("blob.bin"), true);

/* ---------- 5. flush writes the truth, refuses to clobber the opaque ---------- */
const ws = hydrated.workspace;
const baseline = hydrated.baseline;
writeFile(ws, "src/app.sh", "echo changed\n");
writeFile(ws, "src/new.sh", "echo new\n");
const flush1 = await flushWorkspace(ws, project.id, baseline);
assert.equal(flush1.written.sort().join(","), "src/app.sh,src/new.sh");
assert.equal(readFileSync(join(dir, "src/app.sh"), "utf8"), "echo changed\n");
assert.equal(existsSync(join(dir, "src/new.sh")), true);

writeFile(ws, "blob.bin", "this must never land on disk");
const flush2 = await flushWorkspace(ws, project.id, baseline);
assert.equal(flush2.ok, false);
assert.deepEqual(flush2.protected, ["blob.bin"]);
assert.equal(flush2.written.length, 0);
assert.equal(readFileSync(join(dir, "blob.bin")).length, 4);

const ws2 = hydrated.workspace;
await callHost("deleteFile", { id: project.id, path: "src/new.sh" });
writeFile(ws2, "src/new.sh", "echo new\n");
const baseline2 = { paths: new Set(baseline.paths), revisions: { ...baseline.revisions }, opaque: new Set(baseline.opaque) };
baseline2.revisions["src/new.sh"] = ws2.files["src/new.sh"].revision;
const flush3 = await flushWorkspace(ws2, project.id, baseline2);
assert.equal(flush3.errors.length, 0);

/* ---------- 6. manifests and approval ---------- */
const parsed = parseManifest('{"gunther":1,"name":"x","commands":{"verify":{"argv":["sh","verify.sh"]},"broken":{}}}');
assert.equal(parsed.ok, true);
assert.equal(parsed.manifest.commands.length, 1);
assert.deepEqual(parsed.manifest.invalid, ["broken"]);
assert.equal(parseManifest("{oops").ok, false);
assert.equal(parseManifest("").ok, false);
assert.equal(commandKey(["sh", "verify.sh"]), '["sh","verify.sh"]');
const approved = approvedCommands(parsed.manifest, { verify: commandKey(["sh", "verify.sh"]) });
assert.equal(approved.length, 1);
assert.equal(pendingCommands(parsed.manifest, { verify: '["sh","other.sh"]' }).length, 1);
assert.equal(preferredCommand([{ name: "lint", argv: ["sh", "lint.sh"] }, { name: "verify", argv: ["sh", "v.sh"] }]).name, "verify");

/* ---------- 7. presentation helpers ---------- */
const tree = fileTree(["src/app.sh", "README.md", "src/deep/x.txt"]);
assert.equal(tree[0].path, "README.md");
assert.equal(tree[2].depth, 2);
assert.equal(humanBytes(2048), "2.0 KB");

/* ---------- 8. the report is built from records only ---------- */
const emptyReport = buildReport({ projectName: "rig demo", runs: [] });
assert.match(emptyReport, /no command was run/);
const report = buildReport({
  projectName: "rig demo",
  projectId: project.id,
  goal: "make it pass",
  runs: [
    { argv: ["sh", "verify.sh"], code: 1, stdout: "", stderr: "FAIL", durationMs: 12, at: Date.now(), ran: true, trigger: "auto" },
    { argv: ["sh", "verify.sh"], code: 0, stdout: "ok", stderr: "", durationMs: 9, at: Date.now(), ran: true, trigger: "repair" },
  ],
  commands: parsed.manifest.commands,
  unavailable: ["node is not installed on this device"],
});
assert.match(report, /\*\*FAIL\*\* `sh verify.sh` → exit 1/);
assert.match(report, /\*\*PASS\*\* `sh verify.sh` → exit 0/);
assert.match(report, /node is not installed/);

/* ---------- 9. delivery archives are real files ---------- */
const exportPath = join(root, "delivery.zip");
const exported = await exportArchive(project.id, "rig demo", { targetPath: exportPath });
assert.equal(exported.ok, true);
assert.equal(existsSync(exportPath), true);
assert.equal(exported.files > 3, true);
const imported = await importArchive("restored", { sourcePath: exportPath });
assert.equal(imported.ok, true);
const restored = await hydrateProject({ id: imported.project.id, name: "restored" });
assert.equal(restored.loaded.includes("verify.sh"), true);
assert.equal(restored.loaded.includes(MANIFEST_FILE), true);

/* ---------- 10. folder import and deletion ---------- */
const source = join(root, "source-folder");
mkdirSync(join(source, "lib"), { recursive: true });
writeFileSync(join(source, "lib", "a.sh"), "echo a\n");
const folderImport = await importFolder("from disk", { sourcePath: source });
assert.equal(folderImport.ok, true);
assert.equal(folderImport.imported, 1);
const restoredFolder = await hydrateProject({ id: folderImport.project.id, name: "from disk" });
assert.equal(readFile(restoredFolder.workspace, "lib/a.sh"), "echo a\n");

const listed = await listProjects();
assert.equal(listed.projects.length >= 3, true);
const removed = await deleteProject(imported.project.id);
assert.equal(removed.deleted, true);
const afterDelete = await listProjects();
assert.equal(afterDelete.projects.some((p) => p.id === imported.project.id), false);

/* ---------- 11. how a command is judged runnable ---------- */
const availability = commandAvailability(["sh", "verify.sh"], probe.toolchain);
assert.equal(availability.runnable, true);
const projectBinary = commandAvailability(["./verify.sh"], probe.toolchain);
assert.equal(projectBinary.runnable, false);
assert.match(projectBinary.reason, /through sh/);
const missing = commandAvailability(["definitely-not-installed-xyz"], probe.toolchain);
assert.equal(missing.runnable, false);

clearHost();
assert.equal(hostKind(), "none");
sumUp("project");
