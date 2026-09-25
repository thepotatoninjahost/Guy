/* ============================================================
   Gunther · PROJECT HOST BRIDGE

   The console runs in a WebView. It cannot list a directory, write a
   file, or start a process — so every one of those abilities arrives
   through this one narrow door, and the door is honest about which
   side of it we are on:

     android  the GuntherProject plugin is registered in this shell
     rig      a harness host injected by the test tools (real files,
              real processes — a contract harness, never a device)
     none     a plain browser tab: no project access, and we say so

   Nothing here invents a capability. If the host is missing, calls
   return { ok:false, code:"NO_HOST" } and the UI is required to
   render that as "unavailable" instead of a hopeful placeholder.
   ============================================================ */

export const HOST_METHODS = [
  "hostInfo",
  "probeToolchain",
  "listProjects",
  "createProject",
  "deleteProject",
  "listFiles",
  "readFile",
  "writeFile",
  "deleteFile",
  "runCommand",
  "importFolder",
  "importArchive",
  "exportArchive",
];

let injected = null;

/** The rig and the local tools inject their own host. The app never does. */
export function setHost(host) {
  injected = host || null;
}

export function clearHost() {
  injected = null;
}

function androidPlugin() {
  const CAP = typeof window !== "undefined" ? window.Capacitor : null;
  const plugins = CAP && CAP.Plugins ? CAP.Plugins : null;
  const P = plugins ? plugins.GuntherProject : null;
  if (!P || typeof P.hostInfo !== "function") return null;
  return P;
}

export function hostKind() {
  if (injected) return injected.kind || "rig";
  if (androidPlugin()) return "android";
  return "none";
}

export function hostLabel() {
  const kind = hostKind();
  if (kind === "android") return "Android device storage";
  if (kind === "rig") return "local contract harness (not a device)";
  return "unavailable — no project host in this environment";
}

export function hostAvailable() {
  return hostKind() !== "none";
}

/**
 * One call, one shape. Every outcome is an object: either
 * { ok:true, ...payload } or { ok:false, code, message }.
 */
export async function callHost(method, opts = {}) {
  const host = injected || androidPlugin();
  if (!host) {
    return {
      ok: false,
      code: "NO_HOST",
      message:
        "no project host: this environment cannot read or write a real project. Open Gunther in the Android app to work on real files.",
    };
  }
  const fn = host[method];
  if (typeof fn !== "function") {
    return { ok: false, code: "NO_METHOD", message: "this host does not implement " + method + "()" };
  }
  try {
    const res = await fn.call(host, opts);
    return { ok: true, ...(res && typeof res === "object" ? res : {}) };
  } catch (error) {
    const code = (error && (error.code || error.name)) || "HOST_ERROR";
    const message = (error && (error.message || error.note)) || String(error || "host call failed");
    return { ok: false, code: String(code), message: String(message) };
  }
}

/**
 * What can this environment actually do? Used by the Project room and by
 * the delivery report, so a claim about the device is always traceable to
 * a probe rather than an assumption.
 */
export async function probeHost() {
  const kind = hostKind();
  if (kind === "none") {
    return {
      ok: true,
      kind,
      available: false,
      info: null,
      toolchain: null,
      reason: "no project host in this environment",
    };
  }
  const info = await callHost("hostInfo");
  const toolchain = await callHost("probeToolchain");
  return {
    ok: true,
    kind,
    available: true,
    info: info.ok ? info : null,
    infoError: info.ok ? "" : info.message,
    toolchain: toolchain.ok ? toolchain : null,
    toolchainError: toolchain.ok ? "" : toolchain.message,
  };
}

/** Tools the host could not find, with the reason, ready to display. */
export function missingTools(toolchain) {
  const tools = (toolchain && toolchain.tools) || [];
  return tools.filter((t) => !t.available);
}

export function foundTools(toolchain) {
  const tools = (toolchain && toolchain.tools) || [];
  return tools.filter((t) => t.available);
}

/**
 * Is an argv's head runnable here? Answers without running anything: the
 * head must be a bare system binary the probe found. Returns
 * { runnable, reason } and never guesses.
 */
export function commandAvailability(argv, toolchain) {
  const head = Array.isArray(argv) && argv.length ? String(argv[0]) : "";
  if (!head) return { runnable: false, reason: "the command has no argv" };
  if (head.includes("/")) {
    return {
      runnable: false,
      reason:
        "Gunther can only launch system binaries on Android 10+. A path inside the project cannot be executed — call it through sh instead.",
    };
  }
  const tools = (toolchain && toolchain.tools) || [];
  const tool = tools.find((t) => t.name === head);
  if (!tool) return { runnable: false, reason: "not present in the toolchain probe" };
  if (!tool.available) return { runnable: false, reason: "not installed on this device (" + (tool.note || "absent") + ")" };
  return { runnable: true, reason: "found at " + tool.path };
}
