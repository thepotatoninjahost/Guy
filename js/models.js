/* ============================================================
   Gunther · GLASS HOUSE CONSOLE — js/models.js
   THE MANIFEST — ten service lines, four providers.
   Every line is FREE FOREVER — no trials, no expiring credits.
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
  cloudflare: {
    label: "Cloudflare Workers AI",
    base: "https://api.cloudflare.com/client/v4/accounts",
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
 * @property {Object} shared      { rpd } — an ACCOUNT-wide daily budget every line of the vendor draws on together
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
    coding: true,
    note: "live-verified 2026-09-18 — the 2.5 family retires Oct 2026; rotation hands off the day it does",
  },
  {
    id: "gemini-25-flash-lite",
    line: 2,
    name: "Gemini 3.1 Flash-Lite",
    tier: "FREE",
    provider: "gemini",
    model: "gemini-3.1-flash-lite",
    ctx: 1048576,
    caps: { rpm: 30, tpm: 1000000, rpd: 1500, tpd: 0 },
    quality: 4.3,
    coding: true,
    note: "30 RPM · 1,500 RPD — Google's own migration path off 2.5 Lite",
  },
  {
    id: "groq-llama33-70b",
    line: 3,
    name: "GPT-OSS 120B",
    tier: "FREE",
    provider: "groq",
    model: "openai/gpt-oss-120b",
    ctx: 131072,
    caps: { rpm: 30, tpm: 8000, rpd: 1000, tpd: 200000 },
    quality: 4.6,
    coding: true,
    note: "Groq's official successor to llama-3.3-70b-versatile (retired 2026-08-16)",
  },
  {
    id: "groq-r1-70b",
    line: 4,
    name: "GPT-OSS 20B",
    tier: "FREE",
    provider: "groq",
    model: "openai/gpt-oss-20b",
    ctx: 131072,
    caps: { rpm: 30, tpm: 8000, rpd: 1000, tpd: 200000 },
    quality: 4.2,
    coding: true,
    note: "Groq's official successor to llama-3.1-8b-instant (retired 2026-08-16)",
  },
  {
    // Stable handle preserved so old ledgers survive the vendor correction.
    id: "groq-llama31-8b",
    line: 5,
    name: "Qwen 3.8 27B · Coding",
    tier: "FREE",
    provider: "openrouter",
    model: "qwen/qwen3.8-27b:free",
    ctx: 262144,
    caps: { rpm: 20, tpm: 0, rpd: 50, tpd: 0 }, shared: { rpd: 50 },
    quality: 4.4,
    coding: true,
    note: "OpenRouter free coding route — 262K context; replaces Groq Compound Mini, which the public developer tier retired",
  },
  {
    id: "or-llama4-maverick",
    line: 6,
    name: "Nemotron 3 Ultra 550B",
    tier: "FREE",
    provider: "openrouter",
    model: "nvidia/nemotron-3-ultra-550b-a55b:free",
    ctx: 1048576,
    caps: { rpm: 20, tpm: 0, rpd: 50, tpd: 0 }, shared: { rpd: 50 },
    quality: 4.7,
    coding: true,
    note: "flagship of the September :free roster — answered 7 of 7 on the daily live check",
  },
  {
    id: "or-llama33-70b",
    line: 7,
    name: "GLM 5.2 · Coding Agent",
    tier: "FREE",
    provider: "openrouter",
    model: "z-ai/glm-5.2:free",
    ctx: 131072,
    caps: { rpm: 20, tpm: 0, rpd: 50, tpd: 0 }, shared: { rpd: 50 },
    quality: 4.5,
    coding: true,
    note: "OpenRouter free coding route — tool use and long-running engineering tasks; replaces the retired DeepSeek free route",
  },
  {
    id: "or-qwen3-coder",
    line: 8,
    name: "North Mini Code",
    tier: "FREE",
    provider: "openrouter",
    model: "cohere/north-mini-code:free",
    ctx: 262144,
    caps: { rpm: 20, tpm: 0, rpd: 50, tpd: 0 }, shared: { rpd: 50 },
    quality: 4.2,
    coding: true,
    note: "code-tuned line — 7 of 7 answers on the daily check",
  },
  {
    id: "gemini-3-flash",
    line: 9,
    name: "Gemini 3.5 Flash",
    tier: "FREE",
    provider: "gemini",
    model: "gemini-3.5-flash",
    ctx: 1048576,
    caps: { rpm: 15, tpm: 250000, rpd: 1500, tpd: 0 },
    quality: 4.7,
    coding: true,
    note: "15 RPM · 1,500 RPD — gemini-3-flash left the free roster; this is the live line",
  },
  {
    // Stable handle preserved so an existing stored Cloudflare key is not lost.
    id: "cf-llama33-70b",
    line: 10,
    name: "Qwen 2.5 Coder · Edge",
    tier: "FREE",
    provider: "cloudflare",
    model: "@cf/qwen/qwen2.5-coder-32b-instruct",
    ctx: 32768,
    caps: { rpm: 30, tpm: 0, rpd: 0, tpd: 0 },
    quality: 4.3,
    coding: true,
    note: "Cloudflare Workers AI code-specialist route; requires a Workers AI token with model access",
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
