# GUY — Autonomous Coding Agent

**Self-improving, solo AI dev environment you control.**  
Dark terminal aesthetic — deep indigo `#0a0a1f` / dayglow green `#00ff88` — optimized for **Samsung Galaxy S25 (360×780)**.

3-screen mobile web app that writes, reviews, and iterates on code in **Python, JavaScript/TypeScript, Kotlin**, with live internet research, runtime skill/plugin registration, and cross-session evolution.

Live: `https://thepotatoninjahost.github.io/Guy/` (or run `python -m http.server 8000` and open `index.html`)

---

## 📲 Android APK — Install on Samsung Galaxy S25

**Latest APK (auto-built by GitHub Actions):**

- **Download → [GitHub Releases — latest](https://github.com/thepotatoninjahost/Guy/releases/tag/latest)** — tap `GUY-debug.apk`
- Direct (latest tag): `https://github.com/thepotatoninjahost/Guy/releases/download/latest/GUY-debug.apk`
- All builds: https://github.com/thepotatoninjahost/Guy/releases

**Install steps (Galaxy S25 / One UI 6/7):**
1. Download `GUY-debug.apk` on your phone (Chrome / Samsung Internet)
2. Open file → **Allow** "Install unknown apps" if prompted (Settings → Security and privacy → More security settings → Install unknown apps → Chrome → Allow)
3. Tap **Install** → **Open**
4. App icon appears as **GUY** (indigo/green)

> Debug APK is signed with debug keystore and ready to sideload. Release APK (`GUY-release.apk` / `app-release-unsigned.apk`) is also attached — same build, signed via release keystore in CI.

**Build locally (optional):**
```bash
npm ci
npx cap sync android
cd android && ./gradlew assembleDebug
# APK at android/app/build/outputs/apk/debug/app-debug.apk
```

**CI:** Push to `arena/01a0a37c-guy` triggers `.github/workflows/android.yml` → builds both debug & release, uploads artifacts, and creates/updates the `latest` + versioned `guy-v1.0.<run_number>` releases.

---

## 🖥️ App Structure

**Agent Workspace**
- Task submission (Python / JS-TS / Kotlin pills, priority, auto-research/iterate) → DEPLOY AGENT
- Live log stream (terminal, pause/clear, 1.5s pulse)
- Task queue (running/review/done, progress rails)
- Code artifact viewer (tabs, copy, iteration v1..v3, self-review)
- Research panel (live Tavily/Brave/Exa queries, snippet cards, knowledge graph)

**Skills & Plugins Manager**
- Skill proficiency grid (12 skills, level badges, evolving glow)
- Plugin table (9 plugins with toggles — PyLance, TS Morph, Kotliner, Researcher, Verifier, Skill Forge, Evolver)
- Acquisition charts (canvas: skills/plugins/research over 7 sessions) + evolution timeline

**Settings & GitHub Integration**
- GitHub repo/branch config (`thepotatoninjahost/Guy` @ `arena/01a0a37c-guy`), PAT masked, connect test, webhook/sync
- Agent behavior (autonomy slider, max iterations, style)
- Research engine (Tavily active / Brave / Exa / Serper)
- API keys panel (local-only, encrypted at rest)

**Shell:** Collapsible sidebar (live agent status pulse, GitHub indicator, activity stats), top system bar + notch, bottom thumb nav, localStorage evolution.

---

## 🛠️ Web Dev

```bash
# web only
python3 -m http.server 8000 --bind 0.0.0.0
# open http://localhost:8000

# Capacitor sync after editing web files
npm run sync   # copies www → android
```

Web assets live in `www/` (mirrored from root `index.html`, `styles.css`, `app.js`). Capacitor config: `capacitor.config.json` (`appId: com.guy.agent`, `webDir: www`).

---

## 📦 Project Layout
```
index.html, styles.css, app.js  → core web app
www/                            → Capacitor webDir (copied)
capacitor.config.json
android/                        → Capacitor Android project (Gradle 8.14.3, SDK 36, Java 21)
.github/workflows/android.yml   → CI: builds debug+release APKs → GitHub Release
```

---

## 🔒 Solo & Self-Improving
- All keys/tokens stored in `localStorage` only
- Agent evolves skills/plugins at runtime (Skill Forge / Evolver)
- No multi-user — single device, single owner

Built for **Arena — Agent Mode** on branch `arena/01a0a37c-guy`.
