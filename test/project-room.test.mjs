/* ============================================================
   Gunther · PROJECT ROOM — live workflow test

   Boots the real index.html with the real modules inside jsdom, injects
   the RIG host (real directories, real files, real child processes —
   explicitly NOT a device), and then works a project the way a person
   would: create it, write a broken answer, run its declared check,
   watch it fail, repair the file in the room's editor, run again, watch
   it pass, and ask for the delivery report.

   Every number asserted here comes out of a real process exit code.
   ============================================================ */

import { readFileSync, mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { createNodeHost } from "./hosts/node-host.mjs";
import { assert, sumUp } from "./_harness.mjs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const dom = new JSDOM(html, { url: "http://localhost:8000/", pretendToBeVisual: true });
const { window } = dom;

const shims = {
  window,
  document: window.document,
  localStorage: window.localStorage,
  location: window.location,
  navigator: window.navigator,
  HTMLElement: window.HTMLElement,
  getComputedStyle: window.getComputedStyle,
  requestAnimationFrame: (cb) => setTimeout(cb, 16),
  cancelAnimationFrame: (id) => clearTimeout(id),
};
for (const [k, v] of Object.entries(shims)) {
  try {
    Object.defineProperty(global, k, { value: v, configurable: true, writable: true });
  } catch {
    /* already defined — fine */
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 6000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return true;
    await sleep(20);
  }
  return fn();
}

const root = mkdtempSync(join(tmpdir(), "gunther-room-"));
const rig = createNodeHost({ root });

await import("../js/main.js");
const G = window.__gunther;
assert.ok(await until(() => Boolean(G && G.project)), "the console boots and hands over the project room API");

/* ---------- the room says out loud that there is no host yet ---------- */
G.project.render();
assert.match(window.document.querySelector("#projHostBadge").textContent, /NO HOST/);
assert.match(window.document.querySelector("#projHostText").textContent, /Android app|browser/);
const blindOpen = await G.project.open({ id: "not-a-project", name: "ghost" });
assert.equal(blindOpen.ok, false, "opening a project without a host refuses instead of pretending");
assert.equal(blindOpen.code, "NO_HOST");
assert.match(blindOpen.message, /Android app/);

/* ---------- the rig host introduces itself honestly ---------- */
G.setHost(rig);
await G.project.probe();
assert.ok(await until(() => /RIG/.test(window.document.querySelector("#projHostBadge").textContent)));
assert.match(window.document.querySelector("#projHostText").textContent, /contract harness[^.]*NOT a device/);
assert.ok(window.document.querySelectorAll("#projTools .tool-chip").length > 0, "the room prints the probed toolchain as chips");
assert.match(window.document.querySelector("#projTools").textContent, /sh/);

/* ---------- create a project the way the UI creates one ---------- */
window.document.querySelector("#projNewName").value = "tiny answer project";
window.document.querySelector("#projCreate").click();
assert.ok(await until(() => /tiny answer project/.test(window.document.querySelector("#projList").textContent)));
assert.ok(await until(() => !window.document.querySelector("#projActive").hidden), "creating a project raises the active panel");

const project = G.project.open ? null : null; // (kept below through state)
const state = G.state();
assert.equal(state.project.name, "tiny answer project");
const projectId = state.project.id;
assert.equal(existsSync(join(root, "projects", projectId)), true);

/* ---------- the room writes the project's own files ---------- */
await rig.writeFile({
  id: projectId,
  path: "verify.sh",
  text: [
    "#!/bin/sh",
    "value=$(cat src/answer.txt)",
    'if [ "$value" = "42" ]; then',
    '  echo "ok: answer is $value"',
    "  exit 0",
    "fi",
    'echo "FAIL: expected 42 but src/answer.txt holds \'$value\'" >&2',
    "exit 1",
    "",
  ].join("\n"),
});
await rig.writeFile({ id: projectId, path: "src/answer.txt", text: "41\n" });
await rig.writeFile({
  id: projectId,
  path: "gunther.project.json",
  text: JSON.stringify(
    { gunther: 1, name: "tiny answer project", commands: { verify: { argv: ["sh", "verify.sh"], label: "check the answer" } } },
    null,
    2
  ) + "\n",
});

/* reopen through the product so the mirror and manifest are real */
await G.project.open({ id: projectId, name: "tiny answer project" });
assert.ok(await until(() => !window.document.querySelector("#projWork").hidden), "the file browser opens");
await until(() => window.document.querySelectorAll("#projFiles .proj__file").length >= 3);
const fileRows = [...window.document.querySelectorAll("#projFiles .proj__file")];
assert.equal(fileRows.some((r) => /verify\.sh/.test(r.textContent)), true);
assert.equal(fileRows.some((r) => /answer\.txt/.test(r.textContent)), true);
assert.match(window.document.querySelector("#projMeta").textContent, /no verification command approved|NEEDS APPROVAL|approved/i);

/* ---------- an unapproved command cannot run — not even by the operator ---------- */
const blocked = await G.project.run("verify");
assert.equal(blocked.ok, false);
assert.equal(blocked.record, null, "an unapproved command produces no run record at all");
assert.match(window.document.querySelector("#projOutput").textContent || "", /approve/i);

/* ---------- approve it in the room, then run it for real ---------- */
G.project.approve("verify");
assert.equal(G.project.approved().some((c) => c.name === "verify" && c.argv.join(" ") === "sh verify.sh"), true);
const first = await G.project.run("verify");
assert.equal(first.ok, false, "the project's own check really fails on a wrong answer");
assert.equal(first.record.ran, true);
assert.equal(first.record.code, 1);
assert.match(first.record.stderr, /expected 42/);
assert.match(window.document.querySelector("#projOutput").textContent, /FAIL|exit 1|expected 42/i);

/* the ledger shows it — evidence, not prose */
await until(() => window.document.querySelectorAll("#projRuns .proj__runrow").length >= 1);
assert.match(window.document.querySelector("#projRuns").textContent, /verify/);

/* ---------- repair through the room's editor ---------- */
const answerRow = [...window.document.querySelectorAll("#projFiles .proj__file")].find((r) => /answer\.txt/.test(r.textContent));
answerRow.click();
assert.ok(await until(() => window.document.querySelector("#projFileText").value.includes("41")));
window.document.querySelector("#projFileText").value = "42\n";
window.document.querySelector("#projFileSave").click();
assert.ok(await until(() => /saved/.test(window.document.querySelector("#projFileNote").textContent)));
assert.equal(readFileSync(join(root, "projects", projectId, "src", "answer.txt"), "utf8"), "42\n", "the edit lands on the real file");

/* ---------- run again: now it passes ---------- */
const second = await G.project.run("verify");
assert.equal(second.ok, true);
assert.equal(second.record.code, 0);
assert.match(second.record.stdout, /ok: answer is 42/);
assert.equal(second.record.ran, true);
assert.equal(G.state().runs.length >= 2, true);

/* changing the command's argv in the manifest must invalidate the approval */
await rig.writeFile({
  id: projectId,
  path: "gunther.project.json",
  text: JSON.stringify(
    { gunther: 1, name: "tiny answer project", commands: { verify: { argv: ["sh", "verify.sh", "--fast"], label: "check the answer" } } },
    null,
    2
  ) + "\n",
});
await G.project.open({ id: projectId, name: "tiny answer project" });
const staleRun = await G.project.run("verify");
assert.equal(staleRun.ok, false, "a changed command is a new command — the old approval does not carry over");
assert.equal(staleRun.record, null);

/* ---------- the agent's own tool context obeys the same gate ---------- */
const context = G.project.context({ task: null, stepId: null, maxRuns: 2 });
assert.equal(context.allowedCommands.length, 0, "the agent gets nothing to run while the command is unapproved");
G.project.approve("verify");
const context2 = G.project.context({ task: null, stepId: null, maxRuns: 2 });
assert.equal(context2.allowedCommands.length, 1);
const agentRun = await context2.run(context2.allowedCommands[0]);
assert.equal(agentRun.record.code, 0);
assert.equal(agentRun.record.trigger, "agent");

/* ---------- delivery: the report is written into the real project ---------- */
const delivery = await G.project.deliver("prove the answer", null);
assert.ok(delivery && delivery.project.id === projectId);
const reportPath = join(root, "projects", projectId, "GUNTHER-REPORT.md");
assert.equal(existsSync(reportPath), true, "the delivery report is a real file in the real project");
const report = readFileSync(reportPath, "utf8");
assert.match(report, /GUNTHER-REPORT|Gunther/);
assert.match(report, /tiny answer project/);
assert.match(report, /exit code: 0|exit 0/i);
assert.match(report, /rig/i, "the report names the host it ran on — a rig is named a rig");

/* ---------- the ledger survives a restart of the app ---------- */
// state saves are debounced (400 ms) — wait for the write, don't sample mid-flight
await until(() => window.localStorage.getItem("gunther.runs.v1"));
const savedRuns = window.localStorage.getItem("gunther.runs.v1");
assert.ok(savedRuns && JSON.parse(savedRuns).length >= 3, "command records are persisted, not only held in memory");
const savedBase = window.localStorage.getItem("gunther.project-baseline.v1");
assert.ok(savedBase && JSON.parse(savedBase).projectId === projectId, "the mirror baseline persists so a flush after restart is still correct");

sumUp("project room");

/* jsdom keeps the page's timers alive; the suite is over, so close the door. */
process.exit(0);
