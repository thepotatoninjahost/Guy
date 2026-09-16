/* ============================================================
   GUY · GLASS HOUSE CONSOLE — js/transport.js
   The piping. Two dialects speak the same language here:
     · OpenAI-compatible (Groq, OpenRouter, Cerebras, HF)
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

function openAIMessages(system, messages) {
  const out = [];
  if (system && system.trim()) out.push({ role: "system", content: system });
  for (const m of messages) out.push({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content || "") });
  return out;
}

async function callOpenAI(m, modelId, key, ac, userSignal, opts, t0) {
  const v = VENDORS[m.provider];
  const headers = { "content-type": "application/json", authorization: "Bearer " + key };
  if (m.provider === "openrouter") {
    headers["http-referer"] = typeof location !== "undefined" ? location.origin : "https://guy.local";
    headers["x-title"] = "Guy — Glass House Console";
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
  try {
    res = await fetch(v.base + "/chat/completions", {
      method: "POST",
      headers,
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
  if (!key) return { ok: false, note: "no key stored" };
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
      const v = VENDORS[m.provider];
      const headers = { "content-type": "application/json", authorization: "Bearer " + key };
      if (m.provider === "openrouter") {
        headers["http-referer"] = typeof location !== "undefined" ? location.origin : "https://guy.local";
        headers["x-title"] = "Guy — Glass House Console";
      }
      res = await fetch(v.base + "/chat/completions", {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: "user", content: "Reply with the single word: OK" }],
          max_tokens: 4,
          temperature: 0,
        }),
        signal: ac.signal,
      });
    }
    if (!res.ok) {
      const note = (await res.text().catch(() => "")).slice(0, 160);
      const kind =
        res.status === 401 || res.status === 403
          ? "key rejected (401)"
          : res.status === 404
            ? "model id not found (404) — patch it in FLEET"
            : res.status === 429
              ? "quota — valid, just throttled (429)"
              : (note || String(res.status)).slice(0, 110);
      return { ok: false, note: kind };
    }
    await res.text().catch(() => {});
    return { ok: true, note: "answered" };
  } catch (e) {
    if (e.name === "AbortError") return { ok: false, note: "no answer in 20s" };
    return { ok: false, note: "network — " + (e.message || e) };
  } finally {
    clearTimeout(timer);
  }
}
