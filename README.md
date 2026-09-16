# GUY — Autonomous Building Console

A completely custom, personal-build autonomous coding agent. No template, no framework, no build step —
hand-framed HTML/CSS/JS that runs straight out of the folder.

The house is the metaphor, and the metaphor is load-bearing:

| Architectural element | What it is in the app |
| --- | --- |
| **The Glass Facade** | A dark, high-contrast interface built from large translucent, blurred glass panels over an ambient light field with a blueprint grid. Expansive structural borders — a bone-white double frame with brass corner brackets on every room. No sidebars; the whole stage is window wall. |
| **The Sculpted Crest** | The header is not a flat bar. It is a live SVG rooftop profile — a concave quarter-pipe sweep, a skylight notch, a ridge, and a long flowing transition off the right edge — with nav tabs that sit at staggered heights and lose different-sized corners. Nothing on the roof sits on a straight grid. |
| **The Hidden Infrastructure** | All of the technical back end — the ten API keys, the credit trackers, the manual model overrides, the work log — lives underground in the **Service Slab** (bottom of the frame): four garage-door bays that slide open into a raised glass sheet. The main view stays pure. |
| **The Structural Logic** | A pristine rotation engine over **ten free AI model lines** (Gemini Flash free tier, Groq, OpenRouter `:free`, Cerebras trial, HF inference). It tracks token usage dynamically, scores every line, and the moment a free tier hits its ceiling it hands the same request, intact, to the next active line. |

---

## Run it

There is nothing to build:

```bash
python3 -m http.server 8000 --bind 0.0.0.0
# then open http://localhost:8000
```

(any static file server works — `npx serve`, nginx, a Caddyfile, whatever your site soil allows)

## First use

1. Open the **Service** tab (or press `Ctrl/Cmd+K`) → **BAY 01 · CREDENTIALS**.
2. Paste a key per line. One Groq key can be `⇌`-synced across all three Groq lines, and likewise for the
   three OpenRouter lines and the two Gemini lines. `PING` a line before you trust it — the LED goes green,
   amber (throttled but valid), or red (bad key / retired model id).
3. Back in the **Console**, type a build. The on-duty strip tells you which line is serving, the headroom
   ring shows how much of that line's window is left, and the workbench hint tells you which line rides
   the *next* turn.

## The ten lines (manifest defaults, 2026)

| # | Line | Vendor | Endpoint id | Free-tier defaults |
| --- | --- | --- | --- | --- |
| 01 | Gemini 2.5 Flash | Google AI Studio | `gemini-2.5-flash` | 10 RPM · 1,500 RPD · 1M TPM |
| 02 | Gemini 2.5 Flash-Lite | Google AI Studio | `gemini-2.5-flash-lite` | 15 RPM · 1,000 RPD · 1M TPM |
| 03 | Llama 3.3 70B | Groq LPU | `llama-3.3-70b-versatile` | 30 RPM · 14,400 RPD |
| 04 | DeepSeek R1 70B | Groq LPU | `deepseek-r1-distill-llama-70b` | 30 RPM · 14,400 RPD |
| 05 | Llama 3.1 8B Instant | Groq LPU | `llama-3.1-8b-instant` | 30 RPM · 14,400 RPD |
| 06 | Llama 4 Maverick | OpenRouter | `meta-llama/llama-4-maverick:free` | 20 RPM · 50 RPD* |
| 07 | Llama 3.3 70B Instruct | OpenRouter | `meta-llama/llama-3.3-70b-instruct:free` | 20 RPM · 50 RPD* |
| 08 | Qwen3 Coder | OpenRouter | `qwen/qwen3-coder:free` | 20 RPM · 50 RPD* |
| 09 | Llama 3.3 70B (WSE) | Cerebras | `llama-3.3-70b` | trial: 5 RPM · 30K TPM |
| 10 | DeepSeek R1 8B | HF Inference | `deepseek-ai/DeepSeek-R1-Distill-Llama-8B` | burst-limited |

\* OpenRouter raises `:free` to 1,000 RPD if you have ever bought $10 of credits.

Free rosters rotate and providers re-cut limits. Two hedges are built in:

- **The caps are proactive guides, not the truth.** The engine rotates out when a bar fills *or* when a
  provider answers `429` — the 429 always wins.
- **Every endpoint id is editable in place** in the **Fleet** view (click the id under a line). Patch a
  retired model in seconds; the patch persists.

## How the rotation engine works

Each line carries four ledgers:

1. **Sliding 60s window** — requests and tokens admitted in the last minute (RPM/TPM admission).
2. **UTC-day ledger** — the daily ceiling (RPD/TPD).
3. **Trip state** — exponential backoff on quota errors: `60s → 5m → 30m → 4h → 24h`; transient 5xx/network
   failures use a soft ladder (`15s → 1m → 5m`).
4. **Token feed** — a 130s rolling log of every turn's tokens, which powers the burn-rate readouts.

`headroom(line)` is the *tightest* published cap, 0..1, so a line rotates out the instant any single
dimension binds. Selection then scores every line that can legally accept the next request:

```
score = headroom × 55 + quality × 9 + freshness × 8 − fatigue
```

- `freshness` — recently proven lines get a small stickiness bonus (context warms).
- `fatigue` — the line that just served pays a tax, so the fleet actually spreads.

When a call fails with `429`, the line is tripped on the backoff ladder and **the same request is handed,
intact, to the next selected line** — at most two handoffs per turn, each recorded in the reply header
(`↻ handoff 03 → 08`) and the work log. If every keyed line is at a ceiling, the console tells you exactly
when the next window reopens instead of failing silently.

**Overrides (BAY 03):** `AUTO` (the engine picks), `PIN` (ride one line until it exhausts, then the
rotation takes over seamlessly), `DRILL` (release the line after every clean turn, so you can watch the
rotation happen on demand), plus a one-click *trip the line on duty*, temperature, max-output, and the
agent's system prompt.

## Modes in the workbench

- **CHAT** — one turn, one line, streamed.
- **PLAN** — the fleet first returns a strict JSON build plan (2–6 steps), renders it as a step tile,
  then executes each step as its own model call (each step may ride a different line), with the previous
  steps' outputs fed forward as context.

## The four bays

| Bay | Contents |
| --- | --- |
| **01 · CREDENTIALS** | ten key slots (one per line), reveal, per-line PING, PING ALL, sibling sync, two-step clear |
| **02 · POWER LEDGER** | per-line MIN (sliding 60s) and DAY gauges, exact used/cap numbers, reset countdowns, trip badges with one-click release, fleet totals, burn rate, two-step reset |
| **03 · OVERRIDE & DIALS** | AUTO / PIN / DRILL, pin select, manual trip, temperature, max output, system prompt, factory restore |
| **04 · WORK LOG** | every rotation, handoff, trip, key test and session event, filterable and clearable |

## Data & privacy

- API keys live **only in this browser's `localStorage`** (`guy.*` keys). There is no backend; requests go
  from your machine straight to the provider.
- Usage ledgers, dials, the last thread (capped) and the work log persist locally so the house remembers
  between visits. `BAY 02 → RESET LEDGER` zeroes the meters; `BAY 01 → CLEAR KEYS` wipes the ten slots.
- Free-tier data policies are each provider's (Google's free tier, for instance, may train on prompts).

## Tests

```bash
npm install        # jsdom (test tooling only — the app itself has zero dependencies)
npm test
```

- `test/engine.test.mjs` — 29 assertions on the rotation math: admission boundaries, sliding windows,
  TPM ceilings, the backoff ladder, pin/drill modes, ledger bookkeeping.
- `test/smoke.test.mjs` — 35 assertions that boot the real app (real `index.html`, all modules) inside a
  DOM and drive full turns through a stubbed wire: boot rendering, bay machinery, the no-keys guard, a
  live streaming turn with real usage accounting, a **429 → trip → seamless handoff → delivery** sequence,
  and PLAN mode parsing a JSON plan and executing both steps with rendered code blocks.

## File map

```
index.html            the house: crest, rooms, fleet, slab, sheet
css/01-tokens.css     materials: soil, ink, bone, brass, ice, glass
css/02-base.css       ambient light field, glass panes, structural frames, controls
css/03-crest.css      the sculpted roof
css/04-facade.css     the glass room, on-duty strip, feed, workbench
css/05-fleet.css      ten service runs
css/06-bays.css       the service slab and the raised bays
js/models.js          the manifest — ten lines, six vendors, caps
js/state.js           foundation — keys, dials, ledger, log, thread (localStorage)
js/engine.js          the rotation engine — headroom, scoring, trips, handoff dispatch
js/transport.js       the piping — Gemini + OpenAI-compatible dialects, SSE, error normalization
js/main.js            the pour — boot and routing
js/ui/*.js            crest, console, fleet, bays, render
test/                 engine test rig + full-DOM smoke test
```
