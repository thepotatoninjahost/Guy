/* ============================================================
   GUY · GLASS HOUSE CONSOLE — js/models.js
   THE MANIFEST — ten service lines, six providers.
   Caps are the published free-tier defaults for 2026; the
   engine treats them as *proactive* guides. The *reactive*
   truth is the provider's 429, which always wins.
   ============================================================ */

export const VENDORS = {
  gemini: {
    label: "Google AI Studio",
    base: "https://generativelanguage.googleapis.com",
  },
  groq: {
    label: "Groq LPU",
    base: "https://api.groq.com/openai/v1",
  },
  openrouter: {
    label: "OpenRouter",
    base: "https://openrouter.ai/api/v1",
  },
  cerebras: {
    label: "Cerebras",
    base: "https://api.cerebras.ai/v1",
  },
  hf: {
    label: "HF Inference",
    base: "https://router.huggingface.co/v1",
  },
};

/**
 * @typedef {Object} Model
 * @property {string} id          stable engine id
 * @property {number} line        1-10, the row number on the slab
 * @property {string} name        display name
 * @property {"FREE"|"TRIAL"} tier
 * @property {string} provider    vendor key (a key stored here serves every line of the vendor — syncable in BAY A)
 * @property {string} model       endpoint model id (patchable live from the Fleet view)
 * @property {number} ctx         context window, tokens
 * @property {Object} caps        { rpm, tpm, rpd, tpd } — 0 = no published cap on that dimension
 * @property {number} quality     0-5 selection bias
 * @property {string} note        operator note shown in Fleet + Bay B
 */
export const MODELS = [
  {
    id: "gemini-25-flash",
    line: 1,
    name: "Gemini 2.5 Flash",
    tier: "FREE",
    provider: "gemini",
    model: "gemini-2.5-flash",
    ctx: 1048576,
    caps: { rpm: 10, tpm: 1000000, rpd: 1500, tpd: 0 },
    quality: 4.6,
    note: "10 RPM · 1,500 RPD · 1M TPM — daily window resets midnight PT",
  },
  {
    id: "gemini-25-flash-lite",
    line: 2,
    name: "Gemini 2.5 Flash-Lite",
    tier: "FREE",
    provider: "gemini",
    model: "gemini-2.5-flash-lite",
    ctx: 1048576,
    caps: { rpm: 15, tpm: 1000000, rpd: 1000, tpd: 0 },
    quality: 4.2,
    note: "15 RPM · 1,000 RPD — the frugal sister line",
  },
  {
    id: "groq-llama33-70b",
    line: 3,
    name: "Llama 3.3 70B",
    tier: "FREE",
    provider: "groq",
    model: "llama-3.3-70b-versatile",
    ctx: 131072,
    caps: { rpm: 30, tpm: 0, rpd: 14400, tpd: 14400000 },
    quality: 4.5,
    note: "30 RPM · 14,400 RPD official — some accounts are 1,000 RPD, verify in Groq console",
  },
  {
    id: "groq-r1-70b",
    line: 4,
    name: "DeepSeek R1 70B",
    tier: "FREE",
    provider: "groq",
    model: "deepseek-r1-distill-llama-70b",
    ctx: 131072,
    caps: { rpm: 30, tpm: 0, rpd: 14400, tpd: 14400000 },
    quality: 4.6,
    note: "reasoning model — thinking tokens burn budget fast",
  },
  {
    id: "groq-llama31-8b",
    line: 5,
    name: "Llama 3.1 8B Instant",
    tier: "FREE",
    provider: "groq",
    model: "llama-3.1-8b-instant",
    ctx: 131072,
    caps: { rpm: 30, tpm: 0, rpd: 14400, tpd: 14400000 },
    quality: 3.7,
    note: "the sprint line — instant tokens, lighter reasoning",
  },
  {
    id: "or-llama4-maverick",
    line: 6,
    name: "Llama 4 Maverick",
    tier: "FREE",
    provider: "openrouter",
    model: "meta-llama/llama-4-maverick:free",
    ctx: 524288,
    caps: { rpm: 20, tpm: 0, rpd: 50, tpd: 0 },
    quality: 4.4,
    note: "20 RPM · 50 RPD — 1,000 RPD if you ever bought $10 of credits",
  },
  {
    id: "or-llama33-70b",
    line: 7,
    name: "Llama 3.3 70B Instruct",
    tier: "FREE",
    provider: "openrouter",
    model: "meta-llama/llama-3.3-70b-instruct:free",
    ctx: 131072,
    caps: { rpm: 20, tpm: 0, rpd: 50, tpd: 0 },
    quality: 4.4,
    note: "20 RPM · 50 RPD — the deep workhorse at $0/token",
  },
  {
    id: "or-qwen3-coder",
    line: 8,
    name: "Qwen3 Coder",
    tier: "FREE",
    provider: "openrouter",
    model: "qwen/qwen3-coder:free",
    ctx: 262144,
    caps: { rpm: 20, tpm: 0, rpd: 50, tpd: 0 },
    quality: 4.5,
    note: "code-tuned — 20 RPM · 50 RPD",
  },
  {
    id: "cer-llama33-70b",
    line: 9,
    name: "Llama 3.3 70B (WSE)",
    tier: "TRIAL",
    provider: "cerebras",
    model: "llama-3.3-70b",
    ctx: 128000,
    caps: { rpm: 5, tpm: 30000, rpd: 0, tpd: 1000000 },
    quality: 4.0,
    note: "$5 trial credits, 30-day burn, card required at signup — 5 RPM in trial",
  },
  {
    id: "hf-r1-8b",
    line: 10,
    name: "DeepSeek R1 8B",
    tier: "FREE",
    provider: "hf",
    model: "deepseek-ai/DeepSeek-R1-Distill-Llama-8B",
    ctx: 131072,
    caps: { rpm: 20, tpm: 0, rpd: 0, tpd: 0 },
    quality: 4.1,
    note: "free tier — burst-limited, no hard published cap",
  },
];

const INDEX = Object.create(null);
for (const m of MODELS) INDEX[m.id] = m;

export function byId(id) {
  return INDEX[id] || null;
}

/** Effective endpoint model id, honouring a live patch from the Fleet view. */
export function effectiveId(model, patches) {
  const p = patches && patches[model.id];
  const v = p && typeof p.model === "string" ? p.model.trim() : "";
  return v || model.model;
}

/** Rough pre-flight token estimate for rate-limit admission. */
export function estimateTokens(text) {
  if (!text) return 16;
  return Math.max(16, Math.ceil(String(text).length / 3.5));
}
