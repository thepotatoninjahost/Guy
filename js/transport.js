/* ============================================================
   Gunther · GLASS HOUSE CONSOLE — js/transport.js
   The piping. Two dialects speak the same language here:
     · OpenAI-compatible (Groq, OpenRouter, HF)
     · Google's native generateContent SSE
   Everything is streamed; errors are normalized into codes the
   engine understands: ABORT / NO_KEY / AUTH / MODEL / QUOTA /
   BADREQ / TRANSIENT / TIMEOUT / NETWORK / HTTP*.
   ============================================================ */

import { VENDORS, effectiveId } from "./models.js";
import { state } from "./state.js";

export class NetError extends Error {
  constructor(code, note) {
    super(note || code);
    this.code = code;
    this.note = note || code;
  }
}

const IDLE_MS = 45e3; // silence on the wire this long → drop it
const HARD_MS = 180e3; // no response longer than this, full stop
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function classifyStatus(status, note) {
  if (status === 401 || status === 403) return new NetError("AUTH", note);
  if (status === 404) return new NetError("MODEL", note);
  if (status === 429) return new NetError("QUOTA", note);
  if (status >= 500) return new NetError("TRANSIENT", note);
  if (status === 400 && /quota|rate.?limit|exceeded|RESOURCE_EXHAUSTED/i.test(note)) return new NetError("QUOTA", note);
  if (status === 400) return new NetError("BADREQ", note);
  return new NetError("HTTP" + status, note);
}

async function fail(res, text) {
  let note = (text || "").slice(0, 220);
  try {
    const j = JSON.parse(text);
    note = (j.error && (j.error.message || j.error)) || j.message || note;
    if (typeof note === "object") note = note.message || JSON.stringify(note).slice(0, 180);
  } catch {
    /* not json — keep the raw slice */
  }
  return classifyStatus(res.status, String(note).slice(0, 200));
}

/**
 * SSE reader. Hands each `data:` payload to onData; enforces an
 * idle watchdog and a hard ceiling by aborting the controller.
 */
async function readSSE(res, onData, ac) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let last = Date.now();
  const idle = setInterval(() => {
    if (Date.now() - last > IDLE_MS) {
      ac._by = "idle";
      ac.abort();
    }
  }, 5000);
  const hard = setTimeout(() => {
    ac._by = "hard";
    ac.abort();
  }, HARD_MS);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      last = Date.now();
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, "");
        buf = buf.slice(i + 1);
        if (!line.startsWith("data:")) continue; // event:/id:/comments ignored
        const data = line.slice(5).trim();
        if (data && data !== "[DONE]") onData(data);
      }
    }
  } finally {
    clearInterval(idle);
    clearTimeout(hard);
  }
}

function afterAbort(ac, userSignal) {
  if (userSignal && userSignal.aborted) throw new NetError("ABORT", "stopped by operator");
  if (ac._by === "idle" || ac._by === "hard") throw new NetError("TIMEOUT", "wire went quiet — line dropped");
  throw new NetError("NETWORK", "connection failed");
}

/* ---------- OpenAI-compatible dialect ---------- */

/* Cloudflare Workers AI hangs the REST API under the account id, so the
   key slot carries both halves: "<account_id>/<api_token>". */
function cfSplit(key) {
  const i = key.indexOf("/");
  if (i <= 0) throw new NetError("BADREQ", "cloudflare key must be account_id/token");
  return { acct: key.slice(0, i), token: key.slice(i + 1) };
}
function openaiBase(m, key) {
  const v = VENDORS[m.provider];
  if (m.provider === "cloudflare") return v.base + "/" + encodeURIComponent(cfSplit(key).acct) + "/ai/v1";
  return v.base;
}
function openaiAuth(m, key) {
  return m.provider === "cloudflare" ? cfSplit(key).token : key;
}

/* ---------- in-app native escape ----------
   Inside the Capacitor shell the page's origin is https://localhost, and a
   few providers (Cloudflare-fronted OpenRouter notably) refuse browser-shaped
   requests from that origin at the network layer — fetch never leaves the
   device. When the shell offers its native HTTP (CapacitorHttp), we hand the
   call to it: no Origin header, no CORS. Streaming still rides the WebView
   when it can; native runs the turn as one complete exchange. */
function nativeHttp() {
  const CAP = typeof window !== "undefined" ? window.Capacitor : null;
  if (!CAP || typeof CAP.isNativePlatform !== "function" || !CAP.isNativePlatform()) return null;
  const P = CAP.Plugins || {};
  const H = P.CapacitorHttp || P.Http || null;
  return H && typeof H.request === "function" ? H : null;
}
function codeForStatus(status) {
  if (status === 401 || status === 403) return "AUTH";
  if (status === 404) return "MODEL";
  if (status === 429) return "QUOTA";
  if (status >= 500) return "TRANSIENT";
  return "HTTP" + status;
}
function vendorMsg(raw) {
  try {
    const j = JSON.parse(raw);
    const e = j && j.error;
    return String((e && (typeof e === "string" ? e : e.message)) || j.detail || j.message || "");
  } catch {
    return String(raw || "").replace(/\s+/g, " ").trim();
  }
}
export function explainStatus(status, raw, provider) {
  const msg = vendorMsg(raw).slice(0, 120);
  if (status === 401 || status === 403) {
    let hint = "";
    if (provider === "groq") hint = " — new account? tap the verification link in Gmail, then create a fresh key";
    if (provider === "cloudflare") hint = " — key must be pasted as account_id/token";
    return "key rejected (" + status + ")" + (msg ? " — " + msg : "") + hint;
  }
  if (status === 404) return "model id not found (404)" + (msg ? " — " + msg : "") + " — patch it in FLEET";
  if (status === 429) return "quota — valid, just throttled (429)";
  if (status >= 500) return "provider down (" + status + ")" + (msg ? " — " + msg : "");
  return (msg || "HTTP " + status).slice(0, 140);
}
function nativePost(url, headers, data, Http) {
  return Http.request({
    url,
    method: "POST",
    headers,
    data,
    connectTimeout: 20000,
    readTimeout: HARD_MS,
  }).then((r) => ({
    status: r.status || 0,
    body: typeof r.data === "string" ? r.data : JSON.stringify(r.data == null ? "" : r.data),
  }));
}

function openAIMessages(system, messages) {
  const out = [];
  if (system && system.trim()) out.push({ role: "system", content: system });
  for (const m of messages) out.push({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content || "") });
  return out;
}

async function callOpenAI(m, modelId, key, ac, userSignal, opts, t0) {
  const headers = { "content-type": "application/json", authorization: "Bearer " + openaiAuth(m, key) };
  const inApp = typeof location !== "undefined" && location.hostname === "localhost";
  if (m.provider === "openrouter" && !inApp) {
    headers["http-referer"] = location.origin;
    headers["x-title"] = "Gunther — Glass House Console";
  }
  const body = {
    model: modelId,
    messages: openAIMessages(opts.system, opts.messages),
    temperature: clamp(opts.temperature != null ? opts.temperature : 0.4, 0, 1),
    max_tokens: opts.maxTokens != null ? opts.maxTokens : 4096,
    stream: true,
  };
  if (m.provider === "groq") body.stream_options = { include_usage: true };
  if (m.provider === "openrouter") body.usage = { include: true };

  let res;
  const url = openaiBase(m, key) + "/chat/completions";
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: ac.signal,
    });
  } catch (e) {
    if (e.name === "AbortError") afterAbort(ac, userSignal);
    const Http = nativeHttp();
    if (!Http) throw new NetError("NETWORK", "unreachable — " + (e.message || e));
    // The WebView refused to send at all (origin rules inside the shell) —
    // ask the same door natively, unstreamed, and hand the answer back as one
    // full breath. The work still gets done; it just doesn't trickle.
    let nr;
    try {
      nr = await nativePost(url, headers, Object.assign({}, body, { stream: false }), Http);
    } catch (e2) {
      throw new NetError("NETWORK", "unreachable — " + (e2.message || e2));
    }
    if (nr.status < 200 || nr.status >= 300) throw new NetError(codeForStatus(nr.status), explainStatus(nr.status, nr.body, m.provider));
    let j = {};
    try {
      j = JSON.parse(nr.body);
    } catch {}
    const full = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "";
    if (!full) throw new NetError("TRANSIENT", "native fallback returned an empty body");
    if (opts.onDelta) opts.onDelta(full);
    return finishRes(
      m,
      { text: full, usage: j.usage || null, finish: (j.choices && j.choices[0] && j.choices[0].finish_reason) || "stop" },
      t0,
      opts
    );
  }
  if (!res.ok) throw new NetError(codeForStatus(res.status), explainStatus(res.status, await res.text().catch(() => ""), m.provider));

  let text = "";
  let usage = null;
  let finish = null;
  try {
    await readSSE(
      res,
      (data) => {
        let j;
        try {
          j = JSON.parse(data);
        } catch {
          return;
        }
        if (j.error) throw new NetError("QUOTA", j.error.message || "provider error mid-stream");
        const delta = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content;
        if (typeof delta === "string" && delta) {
          text += delta;
          if (opts.onDelta) opts.onDelta(delta);
        }
        if (j.choices && j.choices[0] && j.choices[0].finish_reason) finish = j.choices[0].finish_reason;
        if (j.usage) usage = j.usage;
      },
      ac
    );
  } catch (e) {
    if (e instanceof NetError) throw e;
    if (e.name === "AbortError") afterAbort(ac, userSignal);
    throw new NetError("NETWORK", "stream broken — " + (e.message || e));
  }
  return finishRes(m, { text, usage, finish }, t0, opts);
}

/* ---------- Google dialect ---------- */

async function callGemini(m, modelId, key, ac, userSignal, opts, t0) {
  const v = VENDORS[m.provider];
  const url =
    v.base +
    "/v1beta/models/" +
    encodeURIComponent(modelId) +
    ":streamGenerateContent?alt=sse&key=" +
    encodeURIComponent(key);
  const body = {
    contents: opts.messages.map((msg) => ({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: String(msg.content || "") }],
    })),
    generationConfig: {
      temperature: clamp(opts.temperature != null ? opts.temperature : 0.4, 0, 1),
      maxOutputTokens: opts.maxTokens != null ? opts.maxTokens : 4096,
    },
  };
  if (opts.system && String(opts.system).trim()) body.systemInstruction = { parts: [{ text: opts.system }] };

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
  } catch (e) {
    if (e.name === "AbortError") afterAbort(ac, userSignal);
    throw new NetError("NETWORK", "unreachable — " + (e.message || e));
  }
  if (!res.ok) throw await fail(res, await res.text().catch(() => ""));

  let text = "";
  let usage = null;
  try {
    await readSSE(
      res,
      (data) => {
        let j;
        try {
          j = JSON.parse(data);
        } catch {
          return;
        }
        if (j.promptFeedback && j.promptFeedback.blockReason) {
          throw new NetError("BADREQ", "safety filter — " + j.promptFeedback.blockReason);
        }
        const parts = j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts;
        if (parts) {
          for (const p of parts) {
            if (typeof p.text === "string") {
              text += p.text;
              if (opts.onDelta) opts.onDelta(p.text);
            }
          }
        }
        if (j.usageMetadata) {
          usage = {
            prompt: j.usageMetadata.promptTokenCount || 0,
            completion: j.usageMetadata.candidatesTokenCount || 0,
            total: j.usageMetadata.totalTokenCount || 0,
          };
        }
      },
      ac
    );
  } catch (e) {
    if (e instanceof NetError) throw e;
    if (e.name === "AbortError") afterAbort(ac, userSignal);
    throw new NetError("NETWORK", "stream broken — " + (e.message || e));
  }
  return finishRes(m, { text, usage, finish: "stop" }, t0, opts);
}

function finishRes(m, out, t0, opts) {
  const ms = Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0);
  let usage = out.usage;
  if (!usage) {
    // provider went silent on usage — estimate, and mark it honest
    const chars =
      (opts.system ? opts.system.length : 0) +
      opts.messages.reduce((a, x) => a + String(x.content || "").length, 0) +
      out.text.length;
    const est = Math.ceil(chars / 3.5);
    const completion = Math.ceil(out.text.length / 3.5);
    usage = { prompt: Math.max(0, est - completion), completion, total: est, estimated: true };
  }
  return { text: out.text, usage, ms, finish: out.finish || "stop" };
}

/**
 * Call one line. m: model entry; opts: { system, messages, maxTokens, temperature, signal, onDelta }
 */
export async function call(m, opts) {
  const key = (state.keys[m.id] || "").trim();
  if (!key) throw new NetError("NO_KEY", "no key stored for line " + m.line);
  const modelId = effectiveId(m, state.linePatches);
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const ac = new AbortController();
  const userSignal = opts.signal;
  const onAbort = () => {
    ac._by = "user";
    ac.abort();
  };
  if (userSignal) {
    if (userSignal.aborted) onAbort();
    else userSignal.addEventListener("abort", onAbort, { once: true });
  }
  try {
    if (m.provider === "gemini") return await callGemini(m, modelId, key, ac, userSignal, opts, t0);
    return await callOpenAI(m, modelId, key, ac, userSignal, opts, t0);
  } finally {
    if (userSignal) userSignal.removeEventListener("abort", onAbort);
  }
}

/** Key test: a one-token completion with a tight budget. */
export async function ping(m) {
  const key = (state.keys[m.id] || "").trim();
  if (!key) return { ok: false, note: "no " + m.provider + " key anywhere — paste one in any " + m.provider + " row" };
  const modelId = effectiveId(m, state.linePatches);
  const ac = new AbortController();
  const timer = setTimeout(() => {
    ac._by = "user";
    ac.abort();
  }, 20e3);
  try {
    let res;
    if (m.provider === "gemini") {
      const v = VENDORS[m.provider];
      res = await fetch(
        v.base + "/v1beta/models/" + encodeURIComponent(modelId) + ":generateContent?key=" + encodeURIComponent(key),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: "Reply with the single word: OK" }] }],
            generationConfig: { maxOutputTokens: 4, temperature: 0 },
          }),
          signal: ac.signal,
        }
      );
    } else {
      const headers = { "content-type": "application/json", authorization: "Bearer " + openaiAuth(m, key) };
      const inApp = typeof location !== "undefined" && location.hostname === "localhost";
      if (m.provider === "openrouter" && !inApp) {
        headers["http-referer"] = location.origin;
        headers["x-title"] = "Gunther — Glass House Console";
      }
      const purl = openaiBase(m, key) + "/chat/completions";
      const pbody = {
        model: modelId,
        messages: [{ role: "user", content: "Reply with the single word: OK" }],
        max_tokens: 4,
        temperature: 0,
      };
      const Http = nativeHttp();
      if (Http) {
        const nr = await nativePost(purl, headers, pbody, Http);
        if (nr.status < 200 || nr.status >= 300) return { ok: false, note: explainStatus(nr.status, nr.body, m.provider) };
        return { ok: true, note: "answered (native)" };
      }
      res = await fetch(purl, { method: "POST", headers, body: JSON.stringify(pbody), signal: ac.signal });
    }
    if (!res.ok) return { ok: false, note: explainStatus(res.status, await res.text().catch(() => ""), m.provider) };
    await res.text().catch(() => {});
    return { ok: true, note: "answered" };
  } catch (e) {
    if (e && e.name === "AbortError") return { ok: false, note: "no answer in 20s" };
    if (e && e.code) return { ok: false, note: e.note || e.code };
    return { ok: false, note: "network — " + (e.message || e) };
  } finally {
    clearTimeout(timer);
  }
}
