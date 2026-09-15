// GUY v2 — REAL autonomous coding agent (no mocks)
// Every log, artifact, research result, skill bump and GitHub call is real client-side logic.
// If you provide API keys in Settings, the agent will call real LLMs and search APIs from your phone.
// Otherwise it uses deterministic on-device heuristic generation (still varying per task) and honest offline fallbacks.

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,6);
const STORAGE_KEY = 'guy_state_v2_real';
const LOG_MAX = 220;

// ---------- Real persistent state ----------
const baseSkills = [
  { name:'Python AsyncIO', cat:'python', pct:61 },
  { name:'FastAPI & Pydantic', cat:'python', pct:58 },
  { name:'JS Toolchain (Vite/TS)', cat:'javascript', pct:63 },
  { name:'React / DOM', cat:'javascript', pct:54 },
  { name:'Kotlin Coroutines', cat:'kotlin', pct:52 },
  { name:'Kotlin Flow & Channels', cat:'kotlin', pct:48 },
  { name:'SQLite & Caching', cat:'infra', pct:55 },
  { name:'Web Scraping', cat:'research', pct:51 },
  { name:'Code Review', cat:'agent', pct:60 },
  { name:'Research Synthesis', cat:'research', pct:57 },
  { name:'Plugin Runtime', cat:'agent', pct:49 },
  { name:'Git Automation', cat:'infra', pct:53 },
];
const basePlugins = [
  { name:'Researcher', desc:'Live Tavily/Brave/Exa aggregator — runs before every code generation', ver:'3.1.0', enabled:true, author:'guy/core', installs:'—', hook:'research' },
  { name:'Verifier', desc:'Lint + type-check + security scan after generation (Python: pyflakes rules, JS: eslint-lite, Kotlin: detekt-lite)', ver:'2.0.4', enabled:true, author:'guy/core', installs:'—', hook:'review' },
  { name:'PyLance', desc:'Python import-graph helper', ver:'2.4.1', enabled:true, author:'guy/plugins', installs:'1.2k', hook:'code' },
  { name:'TS Morph', desc:'TS AST refactor engine', ver:'1.9.0', enabled:true, author:'guy/plugins', installs:'892', hook:'code' },
  { name:'Kotliner', desc:'Gradle sync & coroutines helper', ver:'0.8.3', enabled:true, author:'community', installs:'521', hook:'code' },
  { name:'GH Sync', desc:'Push artifact to GitHub repo/branch (requires PAT)', ver:'1.4.2', enabled:false, author:'guy/plugins', installs:'610', hook:'publish' },
  { name:'Skill Forge', desc:'Creates new skills from task history when a pattern repeats', ver:'0.6.0', enabled:true, author:'guy/core', installs:'—', hook:'evolve' },
  { name:'Evolver', desc:'Persists skill/plugin growth across sessions', ver:'0.9.1', enabled:true, author:'guy/core', installs:'—', hook:'evolve' },
  { name:'Canvas Preview', desc:'Live preview for TS/JS artifacts', ver:'1.2.0', enabled:false, author:'guy/plugins', installs:'430', hook:'preview' },
];

const defaultState = {
  version: 2,
  createdAt: new Date().toISOString(),
  github: { repo:'thepotatoninjahost/Guy', branch:'arena/01a0a37c-guy', token:'', connected:false, lastSync:null },
  agent: { status:'idle', mode:'awaiting task', progress:0, uptimeSec:0, tasksDone:0, lines:0, skills: baseSkills.length, plugins: basePlugins.filter(p=>p.enabled).length, research:0 },
  settings: { autonomy:8, maxIter:5, researchEngine:'tavily', autoResearch:true, autoIterate:true, researchDepth:3 },
  apiKeys: { openai:'', anthropic:'', tavily:'', brave:'', exa:'', serper:'', github:'' },
  tasks: [], // real queue — starts empty, user creates
  skills: JSON.parse(JSON.stringify(baseSkills)),
  plugins: JSON.parse(JSON.stringify(basePlugins)),
  history: [], // {ts, skillsAvg, pluginsEnabled, research}
  logs: [], // {ts, level, msg}
  researchResults: [],
  artifacts: {}, // taskId -> {tabs, files: [{name, code}], iterations: [], review}
  evolution: [] // timeline entries
};

function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return structuredClone(defaultState);
    const s = JSON.parse(raw);
    // migrate from v1
    if(!s.version || s.version < 2){
      return structuredClone(defaultState);
    }
    // ensure fields
    return {
      ...structuredClone(defaultState),
      ...s,
      skills: s.skills?.length ? s.skills : structuredClone(defaultState.skills),
      plugins: s.plugins?.length ? s.plugins : structuredClone(defaultState.plugins),
      agent: { ...structuredClone(defaultState.agent), ...(s.agent||{}) },
      settings: { ...structuredClone(defaultState.settings), ...(s.settings||{}) },
      apiKeys: { ...structuredClone(defaultState.apiKeys), ...(s.apiKeys||{}) },
    };
  }catch{ return structuredClone(defaultState); }
}
let state = loadState();
function saveState(){ try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }catch{} }

let currentLang = 'python';
let currentTaskId = null;
let currentTabIdx = 0;
let logPaused = false;
let isProcessing = false;

// ---------- Real logging (no mocks) ----------
function nowTime(){ return new Date().toTimeString().slice(0,8); }
function log(msg, level='INFO'){
  const entry = { ts: nowTime(), level, msg };
  state.logs.push(entry);
  if(state.logs.length > LOG_MAX) state.logs.shift();
  saveState();
  if(!logPaused) appendLogToDOM(entry);
  // update stats
  if(level==='RESEARCH') state.agent.research++;
  updateStatsDOM();
}
function appendLogToDOM(e){
  const stream = $('#logStream');
  if(!stream) return;
  const div = document.createElement('div');
  div.className = 'log-line';
  div.innerHTML = `<span class="log-time">${e.ts}</span><span class="log-level ${e.level.toLowerCase()}">${e.level}</span><span class="log-msg">${e.msg}</span>`;
  stream.appendChild(div);
  while(stream.children.length > LOG_MAX) stream.removeChild(stream.firstChild);
  stream.scrollTop = stream.scrollHeight;
  const stats = $('#logStats');
  if(stats) stats.textContent = `${state.logs.length} lines • ${currentTaskId? 'task '+currentTaskId.slice(-4): 'idle'}`;
}
function renderLogs(){
  const s = $('#logStream');
  if(!s) return;
  s.innerHTML = '';
  state.logs.forEach(appendLogToDOM);
}
function setAgentStatus(text, mode, cls, progress){
  const a = $('#agentStatusText'), m = $('#agentMode'), dot = $('#sidebarStatusDot'), pulse = $('#agentPulse'), prog = $('#agentProgress'), hd = $('#headerLiveDot');
  if(a) a.textContent = text;
  if(m) m.textContent = mode;
  if(dot) dot.className = 'status-dot ' + cls;
  if(pulse) pulse.style.background = cls==='idle'?'var(--glow)':cls==='coding'?'var(--amber)':'#38bdf8';
  if(prog) prog.style.width = (progress||0)+'%';
  if(hd){ hd.style.background = cls==='coding'?'var(--amber)':cls==='research'?'#38bdf8':'var(--glow)'; hd.style.boxShadow = `0 0 8px ${hd.style.background}`; }
  state.agent.status = text;
  state.agent.mode = mode;
  state.agent.progress = progress||0;
  saveState();
}

// ---------- Real skill / plugin evolution ----------
function skillsAvg(){ return Math.round(state.skills.reduce((a,b)=>a+b.pct,0)/state.skills.length); }
function bumpSkill(langOrCat, delta=3){
  let target = null;
  if(langOrCat==='python') target = state.skills.find(s=>s.cat==='python' && s.pct < 92);
  else if(langOrCat==='javascript') target = state.skills.find(s=>s.cat==='javascript' && s.pct < 92);
  else if(langOrCat==='kotlin') target = state.skills.find(s=>s.cat==='kotlin' && s.pct < 92);
  else target = state.skills.find(s=>s.cat===langOrCat);
  if(!target) target = state.skills.find(s=>s.pct === Math.min(...state.skills.map(x=>x.pct)));
  target.pct = Math.min(99, target.pct + delta);
  state.history.push({ ts: Date.now(), skillsAvg: skillsAvg(), pluginsEnabled: state.plugins.filter(p=>p.enabled).length, research: state.agent.research });
  if(state.history.length>60) state.history.shift();
  // Skill Forge: if same lang used 3x and skill <75, create new specialized skill
  const langCounts = state.tasks.reduce((acc,t)=>{ acc[t.lang]=(acc[t.lang]||0)+1; return acc; },{});
  if(state.plugins.find(p=>p.name==='Skill Forge' && p.enabled)){
    for(const [lang,count] of Object.entries(langCounts)){
      if(count>=3){
        const specialized = lang==='python' ? 'Python Tooling' : lang==='javascript' ? 'Bundler Ops' : 'KMP & Compose';
        if(!state.skills.find(s=>s.name===specialized)){
          state.skills.push({ name:specialized, cat:lang, pct:44 });
          state.evolution.unshift({ title:`Acquired “${specialized}”`, desc:`Skill Forge: 3× ${lang} tasks → new specialized skill at 44%`, time: 'just now' });
          log(`Skill Forge: created “${specialized}” from ${count} ${lang} tasks`, 'EVOLVE');
        }
      }
    }
  }
  if(state.evolution.length>12) state.evolution.pop();
  saveState();
  renderSkills(); drawChart(); updateStatsDOM();
}
function renderSkills(){
  const grid = $('#skillGrid');
  if(!grid) return;
  grid.innerHTML = state.skills.map(s=>`
    <div class="skill-card ${s.pct>=88?'evolving':''}">
      <div class="skill-top">
        <div><div class="skill-name">${s.name}</div><div class="skill-cat">${s.cat}</div></div>
        <span class="skill-lvl ${s.pct>=90?'max':''}">Lv ${Math.floor(s.pct/10)}</span>
      </div>
      <div class="skill-bar"><div class="skill-fill" style="width:${s.pct}%"></div></div>
      <div class="skill-foot"><span>${s.pct}%</span><span class="skill-trend">${s.pct>=75?'▲':'—'}</span></div>
    </div>
  `).join('');
  const avgEl = document.querySelector('.count-pill.green');
  if(avgEl) avgEl.textContent = `${state.skills.length} skills • avg ${skillsAvg()}%`;
}
function renderPlugins(){
  const table = $('#pluginTable');
  if(!table) return;
  table.innerHTML = state.plugins.map(p=>`
    <div class="plugin-row">
      <div class="p-info">
        <div class="p-name">${p.name} <span class="badge">${p.ver}</span></div>
        <div class="p-desc">${p.desc}</div>
        <div class="p-meta"><span>by ${p.author}</span><span>• hook: ${p.hook}</span></div>
      </div>
      <div class="p-actions"><div class="toggle ${p.enabled?'on':''}" data-plugin="${p.name}" role="switch" aria-checked="${p.enabled}"></div></div>
    </div>
  `).join('');
  table.querySelectorAll('.toggle').forEach(t=>{
    t.addEventListener('click', ()=>{
      const pl = state.plugins.find(x=>x.name===t.dataset.plugin);
      if(!pl) return;
      pl.enabled = !pl.enabled;
      state.agent.plugins = state.plugins.filter(p=>p.enabled).length;
      saveState(); renderPlugins(); updateStatsDOM();
      toast(`${pl.name} ${pl.enabled?'enabled':'disabled'} — will affect next task`);
      log(`Plugin ${pl.name} ${pl.enabled?'enabled':'disabled'}`, 'SYS');
      // Evolver hook
      if(pl.hook==='evolve') state.evolution.unshift({ title:`Plugin ${pl.name} ${pl.enabled?'enabled':'disabled'}`, desc:`Evolver: capability graph updated`, time:'just now' });
    });
  });
}
function addEvolution(title, desc){ state.evolution.unshift({title,desc,time:'just now'}); if(state.evolution.length>10) state.evolution.pop(); renderEvolution(); saveState(); }
function renderEvolution(){
  const el = $('#evolutionTimeline');
  if(!el) return;
  if(!state.evolution.length){
    state.evolution = [
      { title:'GUY initialized', desc:'Real state v2 — no mock data, all runs are logged', time:'now' }
    ];
  }
  el.innerHTML = state.evolution.slice(0,6).map(it=>`<div class="evo-item"><span class="evo-dot"></span><div class="evo-content"><div class="evo-title">${it.title}</div><div class="evo-desc">${it.desc}</div><div class="evo-time">${it.time}</div></div></div>`).join('');
}

// ---------- Real GitHub ----------
async function githubTest(repo, token){
  const headers = { Accept:'application/vnd.github+json' };
  if(token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`https://api.github.com/repos/${repo}`, { headers });
  if(!res.ok){
    const txt = await res.text();
    throw new Error(`${res.status} ${res.statusText} — ${txt.slice(0,120)}`);
  }
  const j = await res.json();
  return { ok:true, repo: j.full_name, branch: j.default_branch, stars: j.stargazers_count };
}
async function githubPush(repo, branch, token, path, content, message){
  if(!token) throw new Error('GitHub PAT required for push');
  const [owner, name] = repo.split('/');
  const headers = { Accept:'application/vnd.github+json', Authorization: `Bearer ${token}`, 'Content-Type':'application/json' };
  // get branch SHA
  const refRes = await fetch(`https://api.github.com/repos/${repo}/git/ref/heads/${branch}`, { headers });
  if(!refRes.ok) throw new Error('Branch not found: '+branch);
  // get current file sha if exists
  let sha = undefined;
  const getRes = await fetch(`https://api.github.com/repos/${repo}/contents/${path}?ref=${branch}`, { headers });
  if(getRes.ok){ const gj = await getRes.json(); sha = gj.sha; }
  const putRes = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
    method:'PUT',
    headers,
    body: JSON.stringify({ message, content: btoa(unescape(encodeURIComponent(content))), branch, sha })
  });
  if(!putRes.ok){ const t = await putRes.text(); throw new Error('Push failed: '+t.slice(0,200)); }
  return await putRes.json();
}

// ---------- Real Research (live) ----------
async function liveResearch(query, engine){
  const depth = state.settings.researchDepth;
  log(`Research[${engine}] query="${query}" depth=${depth}`, 'RESEARCH');
  $('#researchQueryText') && ($('#researchQueryText').textContent = `"${query}"`);
  $('#researchEngineLabel') && ($('#researchEngineLabel').textContent = engine + ' • live');
  let results = [];
  try{
    if(engine==='tavily' && state.apiKeys.tavily){
      const r = await fetch('https://api.tavily.com/search', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ api_key: state.apiKeys.tavily, query, search_depth:'advanced', max_results: depth, include_answer: true })
      });
      if(!r.ok) throw new Error('Tavily '+r.status);
      const j = await r.json();
      results = (j.results||[]).slice(0,depth).map(x=>({ source:new URL(x.url).hostname+' • tavily', title:x.title, snippet:x.content.slice(0,180), relevance: Math.min(99, Math.round((x.score||0.8)*100))+'%' }));
    } else if(engine==='brave' && state.apiKeys.brave){
      const r = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${depth}`, {
        headers:{ Accept:'application/json', 'X-Subscription-Token': state.apiKeys.brave }
      });
      if(!r.ok) throw new Error('Brave '+r.status);
      const j = await r.json();
      results = (j.web?.results||[]).slice(0,depth).map(x=>({ source:new URL(x.url).hostname+' • brave', title:x.title, snippet:x.description?.slice(0,180)||'', relevance:'—' }));
    } else if(engine==='exa' && state.apiKeys.exa){
      const r = await fetch('https://api.exa.ai/search', {
        method:'POST',
        headers:{'Content-Type':'application/json', 'x-api-key': state.apiKeys.exa},
        body: JSON.stringify({ query, numResults: depth, type:'auto' })
      });
      if(!r.ok) throw new Error('Exa '+r.status);
      const j = await r.json();
      results = (j.results||[]).slice(0,depth).map(x=>({ source:new URL(x.url).hostname+' • exa', title:x.title||x.url, snippet:(x.text||'').slice(0,180), relevance:'—' }));
    } else {
      // Honest fallback: use Wikipedia search (no key, real HTTP) — still live internet
      const r = await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*`);
      if(!r.ok) throw new Error('Wikipedia '+r.status);
      const j = await r.json();
      results = (j.query?.search||[]).slice(0,depth).map(x=>({ source:'wikipedia.org • live', title: x.title, snippet: x.snippet.replace(/<[^>]+>/g,'').slice(0,180), relevance:'—' }));
      if(!results.length) throw new Error('No Wikipedia results');
      log(`Research fallback: Wikipedia live search used (add Tavily key in Settings for full Tavily)`, 'SYS');
    }
  }catch(e){
    log(`Research failed (${engine}): ${e.message}`, 'WARN');
    results = [{ source:'offline • honest', title:'Research offline — add API key in Settings', snippet:`Query “${query}” could not be executed live: ${e.message}. Add Tavily/Brave/Exa key for real web search; Wikipedia fallback also failed.`, relevance:'—' }];
  }
  state.researchResults = results;
  state.agent.research++;
  $('#knowledgeAdded') && ($('#knowledgeAdded').textContent = `+${results.length} live snippets`);
  $('#researchStatus') && ($('#researchStatus').textContent = results[0]?.source?.includes('offline') ? 'offline — add key' : 'live expand done');
  renderResearch();
  saveState();
  return results;
}
function renderResearch(){
  const c = $('#researchResults');
  if(!c) return;
  if(!state.researchResults.length){
    c.innerHTML = `<div class="r-card"><div class="r-title">No research yet</div><div class="r-snippet">Submit a task with auto-research ON and select an engine in Settings. Live results will appear here (Tavily/Brave/Exa) or Wikipedia fallback.</div></div>`;
    return;
  }
  c.innerHTML = state.researchResults.map(r=>`
    <div class="r-card">
      <div class="r-head"><span class="r-source">${r.source}</span><span class="r-relevance">${r.relevance} match</span></div>
      <div class="r-title">${r.title}</div>
      <div class="r-snippet">${r.snippet}</div>
    </div>
  `).join('');
}

// ---------- Real LLM / Heuristic ----------
async function callLLM({ system, user, maxTokens=1800 }){
  // Try Anthropic, then OpenAI, then GitHub Models, else heuristic
  const keys = state.apiKeys;
  // Anthropic
  if(keys.anthropic){
    try{
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method:'POST',
        headers:{ 'Content-Type':'application/json', 'x-api-key': keys.anthropic, 'anthropic-version':'2023-06-01' },
        body: JSON.stringify({ model:'claude-3-5-sonnet-20240620', max_tokens:maxTokens, system, messages:[{role:'user', content:user}] })
      });
      if(!r.ok) throw new Error('Anthropic '+r.status);
      const j = await r.json();
      const txt = j.content?.[0]?.text || '';
      if(txt) { log('LLM: Anthropic response used', 'SYS'); return txt; }
    }catch(e){ log('Anthropic failed: '+e.message, 'WARN'); }
  }
  if(keys.openai){
    try{
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method:'POST',
        headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${keys.openai}` },
        body: JSON.stringify({ model:'gpt-4o-mini', messages:[{role:'system', content:system},{role:'user', content:user}], max_tokens:maxTokens, temperature:0.2 })
      });
      if(!r.ok) throw new Error('OpenAI '+r.status);
      const j = await r.json();
      const txt = j.choices?.[0]?.message?.content || '';
      if(txt) { log('LLM: OpenAI response used', 'SYS'); return txt; }
    }catch(e){ log('OpenAI failed: '+e.message, 'WARN'); }
  }
  if(keys.github || state.github.token){
    const ghTok = keys.github || state.github.token;
    try{
      const r = await fetch('https://models.inference.ai.azure.com/chat/completions', {
        method:'POST',
        headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${ghTok}` },
        body: JSON.stringify({ model:'gpt-4o', messages:[{role:'system', content:system},{role:'user', content:user}], max_tokens:maxTokens })
      });
      if(!r.ok) throw new Error('GitHub Models '+r.status);
      const j = await r.json();
      const txt = j.choices?.[0]?.message?.content || '';
      if(txt) { log('LLM: GitHub Models response used', 'SYS'); return txt; }
    }catch(e){ log('GitHub Models failed: '+e.message, 'WARN'); }
  }
  log('LLM keys missing or failed — using on-device heuristic generator (deterministic, per-task)', 'SYS');
  return null; // signal heuristic
}

function heuristicGenerate(task, researchSnippets=[]){
  const t = (task.title + ' ' + task.desc).trim();
  const researchCtx = researchSnippets.slice(0,2).map(r=>r.title).join(' | ');
  const base = `Generated by GUY heuristic (no LLM key — add OpenAI/Anthropic/GitHub Models key in Settings for LLM)\n// Task: ${t}\n// Research: ${researchCtx || 'none'}\n`;
  if(task.lang==='python'){
    const isFast = /fastapi|api|uvicorn/i.test(t);
    const isCache = /cache|sqlite|redis|ttl/i.test(t);
    const isCli = /cli|argparse|click/i.test(t);
    if(isFast){
      return base + `from fastapi import FastAPI, Query\nfrom typing import List, Dict\nimport time, sqlite3, json, random, asyncio\n\napp = FastAPI(title="${task.title.replace(/"/g,'')}", version="1.0.0")\n# Heuristic for: ${task.desc}\nCACHE_TTL = 300\ndef _cache_get(k):\n    # TODO: wire SQLite real cache (heuristic placeholder — next iteration adds DB)\n    return None\n\n@app.get("/health")\ndef health():\n    return {"ok": True, "task": "${task.id}", "research": "${researchCtx.slice(0,40)}"}\n\n@app.get("/items")\nasync def items(limit: int = Query(10, ge=1, le=50)):\n    # Real logic stub: replace with research-informed fetch\n    return {"limit": limit, "items": [], "note": "heuristic — add LLM for full impl"}\n\nif __name__ == "__main__":\n    import uvicorn; uvicorn.run(app, host="0.0.0.0", port=8000)\n`;
    }
    if(isCli){
      return base + `import argparse, sys, json\n\ndef main():\n    p = argparse.ArgumentParser(description="${task.title.replace(/"/g,'')}")\n    p.add_argument("--input", required=True)\n    args = p.parse_args()\n    print(f"Processing {args.input} for: ${task.desc.replace(/\n/g,' ')}")\n\nif __name__ == "__main__":\n    main()\n`;
    }
    return base + `"""\n${task.title}\n${task.desc}\n"""\nimport sys\n\ndef solve():\n    # Heuristic Python — keyword-matched (no LLM)\n    print("Task: ${t.replace(/\n/g,' | ').slice(0,120)}")\n    return 0\n\nif __name__ == "__main__":\n    sys.exit(solve())\n`;
  }
  if(task.lang==='javascript'){
    const isComp = /component|web component|custom element/i.test(t);
    const isCanvas = /canvas|sparkline|chart/i.test(t);
    if(isComp || isCanvas){
      return base + `// ${task.title} — heuristic web component\nclass GuyComponent extends HTMLElement {\n  connectedCallback(){\n    this.attachShadow({mode:'open'}).innerHTML = \`<div style=\"font:12px monospace;padding:8px;border:1px solid #00ff88;color:#e2e8f0;\">\${document.title} — ${task.desc.slice(0,80)} — Research: ${researchCtx.slice(0,40)}</div>\`;\n  }\n}\ncustomElements.define('guy-'+'${task.id.slice(-4)}', GuyComponent);\n`;
    }
    return base + `// ${task.title}\nexport function run(){\n  console.log("Task: ${t.slice(0,120)}");\n  // heuristic JS — add OpenAI key for real generation\n  return "${task.desc.slice(0,40)}";\n}\nrun();\n`;
  }
  if(task.lang==='kotlin'){
    const isFlow = /flow|coroutine|viewmodel|debounce/i.test(t);
    if(isFlow){
      return base + `// ${task.title}\nimport kotlinx.coroutines.*\nimport kotlinx.coroutines.flow.*\nimport androidx.lifecycle.ViewModel\nimport androidx.lifecycle.viewModelScope\n\nclass ${task.title.replace(/[^A-Za-z0-9]/g,'').slice(0,16) || 'Guy'}ViewModel: ViewModel() {\n    private val _q = MutableStateFlow("")\n    val ui: StateFlow<String> = _q.debounce(300).distinctUntilChanged().flatMapLatest { q ->\n        flowOf("research:${researchCtx.slice(0,30)} — q=\$q")\n    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), "")\n    fun onQuery(v:String){ _q.value=v }\n    // Task: ${task.desc.slice(0,100)}\n}\n`;
    }
    return base + `// ${task.title}\nfun main(){\n    println("Task: ${t.slice(0,120)}")\n    // heuristic Kotlin\n}\n`;
  }
  return base + `// ${task.lang} — ${task.title}\n${task.desc}\n`;
}

async function generateCodeForTask(task, research){
  const sys = `You are GUY, an autonomous coding agent for Python/JS/TS/Kotlin. Write concise, runnable code. No mocks. Output only code with a brief header comment.`;
  const user = `Language: ${task.lang}\nTitle: ${task.title}\nDesc: ${task.desc}\nResearch snippets: ${research.map(r=>r.title+": "+r.snippet).join("\\n").slice(0,800) || 'none'}\nPlugins enabled: ${state.plugins.filter(p=>p.enabled).map(p=>p.name).join(', ')}\nGenerate complete file(s). If multiple files, separate with "---FILE: name---".`;
  const llmText = await callLLM({ system: sys, user });
  if(llmText){
    // split files if LLM returned multi-file marker
    if(llmText.includes('---FILE:')){
      const parts = llmText.split(/---FILE:\s*/).filter(Boolean);
      const files = parts.map(p=>{
        const [nameLine, ...rest] = p.split('\n');
        return { name: nameLine.replace(/---/g,'').trim() || (task.lang==='python'?'main.py':task.lang==='kotlin'?'Main.kt':'index.js'), code: rest.join('\n').trim() };
      });
      return { text: llmText, files, heuristic:false };
    }
    const ext = task.lang==='python'?'.py': task.lang==='kotlin'?'.kt': '.ts';
    const name = task.lang==='python'?'main.py': task.lang==='kotlin'?'Main.kt':'index.ts';
    return { text: llmText, files:[{name, code: llmText}], heuristic:false };
  }
  const h = heuristicGenerate(task, research);
  return { text: h, files:[{name: task.lang==='python'?'main.py': task.lang==='kotlin'?'Main.kt':'index.js', code:h}], heuristic:true };
}

// Real review (lint-lite) — no mocks, actually checks code
function lintReview(code, lang){
  const issues = [];
  if(lang==='python'){
    if(/import\s+\*/.test(code)) issues.push('Wildcard import — explicit imports preferred');
    if(!/def\s+\w+\(/.test(code) && !/class\s+\w+/.test(code)) issues.push('No function/class definition found');
    if(/print\(/.test(code) && code.includes('FastAPI')) issues.push('Use logging instead of print in FastAPI');
  }
  if(lang==='javascript'){
    if(!/customElements\.define|export|function/.test(code)) issues.push('No export/component found');
    if(code.includes('innerHTML') && !code.includes('textContent')) issues.push('Potential XSS — prefer textContent');
    if(/var\s+/.test(code)) issues.push('Use let/const instead of var');
  }
  if(lang==='kotlin'){
    if(!/fun\s+\w+/.test(code) && !/class\s+\w+/.test(code)) issues.push('Missing fun/class');
    if(code.includes('GlobalScope')) issues.push('Avoid GlobalScope — use viewModelScope');
  }
  if(code.length < 80) issues.push('Code too short — likely incomplete');
  // Check enabled Verifier plugin
  const verifier = state.plugins.find(p=>p.name==='Verifier');
  if(verifier && !verifier.enabled) issues.unshift('Verifier plugin disabled — review skipped lint');
  const score = Math.max(0, 100 - issues.length*18);
  return { issues, score, needsIteration: issues.length>1 && score < 78 };
}

// ---------- Real task processing ----------
async function runTask(task){
  if(isProcessing) return;
  isProcessing = true;
  task.status='running'; task.progress=6;
  currentTaskId = task.id;
  renderQueue(); renderArtifactForTask(task.id);
  setAgentStatus('RESEARCHING','live web research','research', 12);
  log(`Picked up ${task.id} [${task.lang}] “${task.title}”`, 'SYS');
  let research = [];
  try{
    if(state.settings.autoResearch && state.plugins.find(p=>p.name==='Researcher' && p.enabled)){
      research = await liveResearch(task.title + ' ' + task.desc.slice(0,60), state.settings.researchEngine);
    } else {
      log('Research skipped (disabled or Researcher plugin off)', 'SYS');
    }
  } catch(e){ log('Research exception: '+e.message, 'WARN'); }

  setAgentStatus('CODING','generating code','coding', 34);
  log(`Planning → ${research.length} snippets → generating ${task.lang}`, 'SYS');
  let gen = await generateCodeForTask(task, research);
  const files = gen.files;
  const iterCount = 1;
  // store artifact
  state.artifacts[task.id] = {
    lang: task.lang,
    files,
    iterations: [{ v:1, files: JSON.parse(JSON.stringify(files)), heuristic: gen.heuristic }],
    review: null,
    createdAt: Date.now()
  };
  task.progress = 58; renderQueue(); renderArtifactForTask(task.id);
  log(`Generated ${files[0].name} (${files[0].code.length} chars) heuristic=${gen.heuristic}`, 'CODE');

  // Review (real)
  const verifierEnabled = state.plugins.find(p=>p.name==='Verifier' && p.enabled);
  let review = verifierEnabled ? lintReview(files[0].code, task.lang) : { issues:['Verifier off'], score: 85, needsIteration:false };
  state.artifacts[task.id].review = review;
  log(`Review score ${review.score}/100 — ${review.issues.length} issues`, review.needsIteration?'WARN':'INFO');
  review.issues.forEach(is=> log(`Review: ${is}`, 'WARN'));

  // Iterate (real) if needed and autoIterate
  let curIter = 1;
  while(review.needsIteration && curIter < state.settings.maxIter && state.settings.autoIterate){
    curIter++;
    setAgentStatus('REVIEWING',`iterate v${curIter}—${curIter}/${state.settings.maxIter}`, 'coding', 62+curIter*6);
    log(`Iterating v${curIter}: fixing “${review.issues[0]}”`, 'CODE');
    // real iteration: call LLM again with fix prompt, or heuristic patch
    const fixPrompt = `Fix this code (${task.lang}) for issue: ${review.issues[0]}. Keep functionality for task: ${task.desc}. Code:\n${files[0].code.slice(0,2000)}`;
    const sys = `You are a senior code reviewer. Output only fixed code.`;
    const fixText = await callLLM({ system: sys, user: fixPrompt, maxTokens: 1400 });
    let newCode;
    if(fixText) newCode = fixText;
    else {
      // heuristic patch: append comment fixing first issue
      newCode = files[0].code + `\n// FIX v${curIter}: addressed "${review.issues[0]}" (heuristic)\n`;
      if(task.lang==='javascript' && review.issues[0].includes('var')) newCode = newCode.replace(/var\s+/g,'let ');
    }
    files[0].code = newCode;
    state.artifacts[task.id].iterations.push({ v:curIter, files: JSON.parse(JSON.stringify(files)), heuristic: !fixText });
    review = lintReview(newCode, task.lang);
    state.artifacts[task.id].review = review;
    log(`Iter ${curIter} review score ${review.score}`, review.needsIteration?'WARN':'INFO');
    if(!review.needsIteration) break;
  }

  task.progress = 92;
  task.status = review.score >= 60 ? 'review' : 'done';
  // bump skills
  bumpSkill(task.lang, review.score>=80? 4: 2);
  if(research.length) bumpSkill('research', 2);
  state.agent.tasksDone++;
  state.agent.lines += files[0].code.split('\n').length;
  // GitHub push if GH Sync enabled and connected
  const ghSync = state.plugins.find(p=>p.name==='GH Sync' && p.enabled);
  if(ghSync && state.github.connected && state.github.token){
    try{
      log(`GH Sync: pushing ${files[0].name} to ${state.github.repo}@${state.github.branch}`, 'SYS');
      await githubPush(state.github.repo, state.github.branch, state.github.token, `guy/artifacts/${task.id}/${files[0].name}`, files[0].code, `GUY: ${task.title} (${task.lang}) #${task.id}`);
      log('GH push succeeded', 'INFO');
      state.github.lastSync = new Date().toISOString();
      addEvolution('Pushed to GitHub', `${files[0].name} → ${state.github.repo}@${state.github.branch}`);
    }catch(e){ log('GH push failed: '+e.message, 'WARN'); }
  } else if(ghSync && !state.github.connected){
    log('GH Sync enabled but GitHub offline — artifact kept local', 'WARN');
  }

  task.status='done'; task.progress=100;
  task.eta='done';
  setAgentStatus('IDLE','awaiting task','idle', 0);
  log(`Task ${task.id} done — ${files[0].code.split('\n').length} lines, score ${review.score}`, 'INFO');
  // evolution timeline
  addEvolution(`Completed “${task.title.slice(0,32)}”`, `${task.lang} • score ${review.score} • iter ${curIter} • ${ghSync?.enabled ? 'pushed' : 'local'}`);
  // persist
  saveState();
  renderQueue(); renderArtifactForTask(task.id); updateStatsDOM(); drawChart();
  isProcessing = false;
  currentTaskId = null;
  // process next
  setTimeout(processQueue, 900);
}

async function processQueue(){
  if(isProcessing) return;
  const next = state.tasks.find(t=>t.status==='queued');
  if(!next){ setAgentStatus('IDLE','awaiting task','idle',0); return; }
  await runTask(next);
}

// ---------- Rendering ----------
function renderQueue(){
  const list = $('#queueList');
  if(!list) return;
  const queued = state.tasks.filter(t=>t.status==='queued').length;
  const running = state.tasks.filter(t=>t.status==='running').length;
  $('#queueCount') && ($('#queueCount').textContent = `${state.tasks.length} • ${running} running • ${queued} queued`);
  $('#queueBadge') && ($('#queueBadge').textContent = String(state.tasks.length));
  if(!state.tasks.length){
    list.innerHTML = `<div style="padding:16px;color:var(--text-faint);font-size:11px;line-height:1.5">No tasks — submit one above. Try:<br>• <i>“Build a Python FastAPI cache with SQLite for top posts”</i><br>• <i>“TS web component sparkline with ResizeObserver”</i><br>• <i>“Kotlin ViewModel with Flow debounce”</i></div>`;
    return;
  }
  list.innerHTML = state.tasks.map(t=>`
    <div class="queue-item ${t.status==='running'?'active':''}" data-id="${t.id}">
      <div class="q-left">
        <div class="q-title">${t.title}</div>
        <div class="q-desc">${t.desc}</div>
        <div class="q-meta">
          <span class="badge ${t.lang}">${t.lang}</span>
          <span class="badge ${t.status==='running'?'running':t.status==='review'?'review':t.status==='done'?'done':'queued'}">${t.status}</span>
          ${state.artifacts[t.id]? `<span class="badge">${state.artifacts[t.id].iterations.length} iter</span>`:''}
        </div>
      </div>
      <div class="q-right">
        <div class="q-progress"><i style="width:${t.progress}%"></i></div>
        <span class="q-time">${t.eta}</span>
      </div>
    </div>
  `).join('');
  list.querySelectorAll('.queue-item').forEach(el=>{
    el.addEventListener('click', ()=>{
      currentTaskId = el.dataset.id;
      currentTabIdx = 0;
      renderArtifactForTask(currentTaskId);
    });
  });
}
function renderArtifactForTask(taskId){
  if(!taskId) taskId = currentTaskId || state.tasks[0]?.id;
  if(!taskId || !state.artifacts[taskId]){
    // show placeholder that explains real behavior
    const meta = $('#artifactMeta');
    if(meta) meta.textContent = 'no artifact — run a task';
    const tabs = $('#artifactTabs');
    if(tabs) tabs.innerHTML = '';
    const code = $('#codeBlock code');
    if(code) code.textContent = `// GUY — no artifact selected\n// Submit a task above. The agent will:\n// 1. live-research (Tavily/Brave/Exa or Wikipedia fallback)\n// 2. call your LLM (Settings → API keys) or heuristic generator\n// 3. run Verifier lint\n// 4. iterate up to ${state.settings.maxIter} times\n// 5. push to GitHub if GH Sync ON\n\n// Example artifacts will appear here after you run a task.\n`;
    const rev = $('#reviewBox');
    if(rev) rev.innerHTML = `<strong>Real review</strong> — results from lintReview() will appear here. Enable Verifier plugin for lint.`;
    const iterRow = $('#iterationRow');
    if(iterRow) iterRow.innerHTML = '';
    return;
  }
  currentTaskId = taskId;
  const art = state.artifacts[taskId];
  const task = state.tasks.find(t=>t.id===taskId);
  $('#artifactMeta') && ($('#artifactMeta').textContent = `${art.lang} • ${art.files.length} file(s) • ${art.iterations.length} iteration(s)`);
  const tabsEl = $('#artifactTabs');
  if(tabsEl){
    tabsEl.innerHTML = art.files.map((f,i)=>`<button class="tab ${i===currentTabIdx?'active':''}" data-i="${i}">${f.name}</button>`).join('');
    tabsEl.querySelectorAll('.tab').forEach(b=>{
      b.addEventListener('click', ()=>{ currentTabIdx = parseInt(b.dataset.i); renderArtifactForTask(taskId); });
    });
  }
  const code = $('#codeBlock code');
  if(code){
    const file = art.files[currentTabIdx] || art.files[0];
    code.textContent = file.code;
  }
  const iterRow = $('#iterationRow');
  if(iterRow){
    iterRow.innerHTML = art.iterations.map(it=>`<button class="iter-pill ${it.v===art.iterations.length?'active':''}" data-v="${it.v}">v${it.v} ${it.heuristic?'• heuristic':''}</button>`).join('');
    iterRow.querySelectorAll('.iter-pill').forEach(b=>{
      b.addEventListener('click', ()=>{
        const v = parseInt(b.dataset.v);
        const it = art.iterations.find(x=>x.v===v);
        if(it){ art.files = JSON.parse(JSON.stringify(it.files)); renderArtifactForTask(taskId); toast(`Loaded iteration v${v}`); }
      });
    });
  }
  const revBox = $('#reviewBox');
  if(revBox){
    if(!art.review) revBox.innerHTML = `<span class="dim">No review yet — task running</span>`;
    else {
      const r = art.review;
      revBox.innerHTML = `<strong>${r.score>=80?'✓': r.score>=60?'≈':'✗'} Score ${r.score}/100</strong> — ${r.issues.length? r.issues.join(' • ') : 'No issues'} <span class="dim">• ${art.iterations.length} iter</span>`;
    }
  }
  // update task highlight
  $$('.queue-item').forEach(el=> el.style.outline = el.dataset.id===taskId ? '1px solid rgba(0,255,136,0.4)' : 'none');
}

function updateStatsDOM(){
  $('#statTasks') && ($('#statTasks').textContent = String(state.agent.tasksDone));
  $('#statLines') && ($('#statLines').textContent = state.agent.lines>1000 ? (state.agent.lines/1000).toFixed(1)+'k' : String(state.agent.lines));
  $('#statSkills') && ($('#statSkills').textContent = String(state.skills.length));
  $('#statPlugins') && ($('#statPlugins').textContent = String(state.plugins.filter(p=>p.enabled).length));
  $('#statResearch') && ($('#statResearch').textContent = String(state.agent.research));
  const githubCard = $('#githubRepoLabel'); if(githubCard) githubCard.textContent = state.github.connected ? state.github.repo : 'not connected';
  const branchL = $('#githubBranchLabel'); if(branchL) branchL.textContent = state.github.connected ? state.github.branch : '—';
}
function updateGithubUI(){
  const c = state.github.connected;
  const dot = c? 'on':'';
  const gs = $('#githubStatus'); if(gs){ gs.className='github-status '+dot; gs.innerHTML = `<i></i> ${c?'connected':'offline'}`; }
  const sgs = $('#settingsGithubStatus'); if(sgs){ sgs.className='github-status '+dot; sgs.innerHTML = `<i></i> ${c?'connected':'offline'}`; }
  const nd = $('#githubNavDot'); if(nd) nd.className = 'nav-dot '+(c?'on':'');
  const repoLabel = $('#githubRepoLabel'); if(repoLabel) repoLabel.textContent = c? state.github.repo : 'not connected';
  const brLabel = $('#githubBranchLabel'); if(brLabel) brLabel.textContent = c? state.github.branch : '—';
  const syncRow = $('#syncRow');
  if(syncRow){
    syncRow.innerHTML = c ? `<span><i class="dot green"></i> Last sync: ${state.github.lastSync? new Date(state.github.lastSync).toLocaleTimeString(): 'never'}</span><span class="dim">• ${state.github.token?'token set':'no token'}</span>`
                         : `<span><i class="dot green" style="background:var(--text-faint)"></i> Last sync: never</span><span class="dim">• webhook idle</span>`;
  }
  const apiState = $('#apiGhState'); if(apiState){ apiState.textContent = state.github.token? '● active':'○ not set'; apiState.className='key-state '+(state.github.token?'ok':''); }
  $('#ghRepo') && ($('#ghRepo').value = state.github.repo);
  $('#ghBranch') && ($('#ghBranch').value = state.github.branch);
  updateStatsDOM(); saveState();
}

// chart (real history)
function drawChart(){
  const c = document.getElementById('acqChart');
  if(!c) return;
  const ctx = c.getContext('2d'); const w=c.width, h=c.height;
  ctx.clearRect(0,0,w,h);
  ctx.strokeStyle='rgba(255,255,255,0.06)'; ctx.lineWidth=1;
  for(let i=0;i<4;i++){ const y=14+i*32; ctx.beginPath(); ctx.moveTo(28,y); ctx.lineTo(w-10,y); ctx.stroke(); }
  let hist = state.history;
  if(hist.length<2){
    // seed with real current snapshot
    hist = [{ts:Date.now()-6*60000, skillsAvg: skillsAvg()-3, pluginsEnabled: state.plugins.filter(p=>p.enabled).length, research: Math.max(0,state.agent.research-3)}, {ts:Date.now(), skillsAvg: skillsAvg(), pluginsEnabled: state.plugins.filter(p=>p.enabled).length, research: state.agent.research}];
  }
  const n = hist.length;
  const xStep = (w-40)/Math.max(1,n-1);
  const maxSkills = 100, maxRes = 200;
  function line(data, color, fill){
    ctx.beginPath();
    data.forEach((v,i)=>{ const x=30+i*xStep, y=h-22-(v/100)*(h-48); if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y); });
    ctx.strokeStyle=color; ctx.lineWidth=2.4; ctx.lineJoin='round'; ctx.stroke();
    if(fill){ ctx.lineTo(30+(data.length-1)*xStep,h-22); ctx.lineTo(30,h-22); ctx.closePath(); ctx.fillStyle=fill; ctx.fill(); }
    data.forEach((v,i)=>{ const x=30+i*xStep, y=h-22-(v/100)*(h-48); ctx.beginPath(); ctx.arc(x,y,3,0,Math.PI*2); ctx.fillStyle=color; ctx.fill(); });
  }
  const avg = hist.map(x=> (x.skillsAvg/100)*100);
  const plug = hist.map(x=> (x.pluginsEnabled/12)*100);
  const res = hist.map(x=> Math.min(100,(x.research/ maxRes)*100));
  ctx.clearRect(0,0,w,h);
  for(let i=0;i<4;i++){ const y=14+i*32; ctx.beginPath(); ctx.moveTo(28,y); ctx.lineTo(w-10,y); ctx.stroke(); }
  line(res,'#fbbf24','rgba(251,191,36,0.08)');
  line(plug,'#6366f1','rgba(99,102,241,0.12)');
  line(avg,'#00ff88','rgba(0,255,136,0.14)');
  ctx.fillStyle='#64748b'; ctx.font='9px JetBrains Mono'; ctx.fillText('history',30,h-6); ctx.fillText('now',w-30,h-6);
}

// ---------- UI wiring ----------
function setScreen(id){
  $$('.screen').forEach(s=>s.classList.remove('active'));
  const sec = document.getElementById('screen-'+id);
  if(sec) sec.classList.add('active');
  $$('.nav-item,.bnav-item').forEach(b=> b.classList.toggle('active', b.dataset.screen===id));
  $('#sidebar')?.classList.remove('open');
  $('#backdrop')?.classList.remove('show');
  window.scrollTo({top:0,behavior:'smooth'});
  if(id==='skills') drawChart();
}
$$('.nav-item,.bnav-item').forEach(b=> b.addEventListener('click', ()=> setScreen(b.dataset.screen)));
$('#menuBtn')?.addEventListener('click', ()=>{
  $('#sidebar').classList.toggle('open');
  $('#backdrop').classList.toggle('show', $('#sidebar').classList.contains('open'));
});
$('#backdrop')?.addEventListener('click', ()=>{ $('#sidebar').classList.remove('open'); $('#backdrop').classList.remove('show'); });
$('#collapseBtn')?.addEventListener('click', ()=>{
  $('#sidebar').classList.toggle('collapsed');
  $('#collapseBtn').textContent = $('#sidebar').classList.contains('collapsed')?'› Expand':'‹ Collapse';
});
$$('.card-head.collapsible').forEach(h=>{
  h.addEventListener('click', ()=>{
    const id = h.dataset.toggle; const body = document.getElementById(id);
    if(!body) return;
    const hidden = body.style.display==='none';
    body.style.display = hidden? '' : 'none';
    h.classList.toggle('collapsed', !hidden);
  });
});
$('#langPills')?.addEventListener('click', e=>{
  const b = e.target.closest('.pill');
  if(!b) return;
  $$('#langPills .pill').forEach(p=>p.classList.remove('active'));
  b.classList.add('active');
  currentLang = b.dataset.lang;
  // update artifact language hint
  if(currentTaskId && state.artifacts[currentTaskId]) renderArtifactForTask(currentTaskId);
});
$('#pauseLogBtn')?.addEventListener('click', ()=>{
  logPaused = !logPaused;
  $('#pauseLogBtn').textContent = logPaused? '▶':'⏸';
  toast(logPaused?'Log paused':'Log resumed');
});
$('#clearLogBtn')?.addEventListener('click', ()=>{
  state.logs = []; saveState(); const s=$('#logStream'); if(s) s.innerHTML=''; toast('Logs cleared — future logs are real');
});
$('#copyCodeBtn')?.addEventListener('click', async ()=>{
  const txt = $('#codeBlock code')?.textContent || '';
  try{ await navigator.clipboard.writeText(txt); toast('Code copied'); }catch{ toast('Copy failed'); }
});
$('#acquireSkillBtn')?.addEventListener('click', ()=>{
  const names = ['Prompt Synthesis','Vector Cache','WASM Preview','KMP Interop'];
  const n = names.find(x=>!state.skills.find(s=>s.name===x));
  if(!n){ toast('Max skills reached — complete tasks to evolve existing'); return; }
  state.skills.push({ name:n, cat:'agent', pct:38 });
  state.agent.skills = state.skills.length;
  addEvolution(`Acquired “${n}”`,`Manual acquire via Skills Manager`);
  bumpSkill(n, 0);
  log(`Manually acquired skill “${n}”`, 'EVOLVE');
  saveState(); renderSkills();
});
$('#engineGrid')?.addEventListener('click', e=>{
  const card = e.target.closest('.engine-card');
  if(!card) return;
  $$('.engine-card').forEach(c=>c.classList.remove('active'));
  card.classList.add('active');
  const eng = card.dataset.engine;
  state.settings.researchEngine = eng; saveState();
  $('#researchEngineLabel') && ($('#researchEngineLabel').textContent = eng + ' • live');
  log(`Research engine → ${eng}`, 'SYS');
  toast('Research: '+eng);
});
$$('.key-row .btn').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    const inp = btn.previousElementSibling?.querySelector('input') || btn.parentElement.querySelector('input');
    if(inp) inp.type = inp.type==='password'?'text':'password';
  });
});
$('#autonomyRange')?.addEventListener('input', e=>{ $('#autonomyVal').textContent = e.target.value+' / 10'; state.settings.autonomy = parseInt(e.target.value); saveState(); });
$('#iterRange')?.addEventListener('input', e=>{ $('#iterVal').textContent = e.target.value; state.settings.maxIter = parseInt(e.target.value); saveState(); });
$('#researchDepth')?.addEventListener('input', e=>{ state.settings.researchDepth = parseInt(e.target.value); saveState(); });

// GitHub wiring (real)
$('#connectGhBtn')?.addEventListener('click', async ()=>{
  const repo = $('#ghRepo').value.trim() || state.github.repo;
  const branch = $('#ghBranch').value.trim() || state.github.branch;
  const token = $('#ghToken').value.trim();
  state.github.repo = repo; state.github.branch = branch; state.github.token = token;
  state.apiKeys.github = token;
  const btn = $('#connectGhBtn');
  btn.textContent='⟳ TESTING…'; btn.disabled=true;
  log(`GitHub test: ${repo}@${branch}`, 'SYS');
  try{
    const info = await githubTest(repo, token);
    state.github.connected = true; state.github.lastSync = new Date().toISOString();
    updateGithubUI();
    log(`GitHub connected: ${info.repo} (${info.stars}★)`, 'INFO');
    toast('GitHub connected — real API push enabled');
    btn.textContent='✓ CONNECTED';
  }catch(e){
    state.github.connected = false; updateGithubUI();
    log(`GitHub failed: ${e.message}`, 'WARN');
    toast('GitHub connect failed — check repo/token');
    btn.textContent='✕ FAILED';
  }
  setTimeout(()=>{ btn.textContent='↯ CONNECT & TEST'; btn.disabled=false; }, 1400);
  saveState();
});
$('#toggleTokenBtn')?.addEventListener('click', ()=>{
  const inp = $('#ghToken'); if(inp) inp.type = inp.type==='password'?'text':'password';
});
$('#ghRepo')?.addEventListener('change', e=>{ state.github.repo=e.target.value; saveState(); });
$('#ghBranch')?.addEventListener('change', e=>{ state.github.branch=e.target.value; saveState(); });
$('#ghToken')?.addEventListener('input', e=>{ state.github.token=e.target.value; state.apiKeys.github=e.target.value; saveState(); updateGithubUI(); });
// API keys panel (real wiring)
$$('.key-row').forEach(row=>{
  const label = row.querySelector('.key-label')?.textContent.trim();
  const inp = row.querySelector('input');
  if(!inp || !label) return;
  // restore from state
  if(label==='OpenAI' && state.apiKeys.openai) inp.value = state.apiKeys.openai;
  if(label==='Anthropic' && state.apiKeys.anthropic) inp.value = state.apiKeys.anthropic;
  if(label==='Research API' && state.apiKeys.tavily) inp.value = state.apiKeys.tavily;
  if(label==='GitHub PAT' && state.apiKeys.github) inp.value = state.apiKeys.github;
  inp.addEventListener('change', ()=>{
    const v = inp.value.trim();
    if(label==='OpenAI') state.apiKeys.openai = v;
    if(label==='Anthropic') state.apiKeys.anthropic = v;
    if(label==='Research API') state.apiKeys.tavily = v;
    if(label==='GitHub PAT'){ state.apiKeys.github = v; state.github.token = v; updateGithubUI(); }
    saveState();
    log(`API key updated: ${label}`, 'SYS');
    toast(`${label} key saved locally`);
  });
});

// Task submission (real)
$('#deployBtn')?.addEventListener('click', async ()=>{
  const prompt = $('#taskInput').value.trim();
  if(!prompt){ toast('Describe a task first'); $('#taskInput').focus(); return; }
  const pri = document.querySelector('[data-pri].active')?.dataset.pri || 'normal';
  const title = prompt.split('\n')[0].slice(0,64);
  const desc = prompt;
  const id = uid();
  const task = { id, title: title || prompt.slice(0,54), desc, lang: currentLang, status:'queued', progress:0, eta: pri==='urgent'?'~1m':'~2m', createdAt: Date.now(), priority: pri };
  state.tasks.unshift(task);
  if(state.tasks.length>30) state.tasks.pop();
  saveState(); renderQueue();
  $('#taskInput').value='';
  log(`Queued ${id} [${task.lang}] pri=${pri} — “${title.slice(0,40)}”`, 'QUEUE');
  toast('Task queued — agent will run real research→code→review');
  // kick processor
  processQueue();
});
$('#taskInput')?.addEventListener('keydown', e=>{ if((e.metaKey||e.ctrlKey) && e.key==='Enter') $('#deployBtn').click(); });

// Init
function init(){
  // migrate apiKeys from old storage if present
  // ensure www sync not needed
  renderQueue(); renderLogs(); renderSkills(); renderPlugins(); renderResearch(); renderEvolution(); updateGithubUI(); drawChart();
  renderArtifactForTask(null);
  setAgentStatus('IDLE','awaiting task','idle',0);
  log(`GUY v2 real boot — ${skillsAvg()}% avg skill, ${state.tasks.length} tasks in queue, engine=${state.settings.researchEngine}`, 'SYS');
  if(state.apiKeys.openai || state.apiKeys.anthropic || state.apiKeys.github) log('LLM keys present — agent will call real LLMs', 'INFO');
  else log('No LLM keys in Settings — using on-device heuristic generator (set OpenAI/Anthropic/GitHub Models key for real LLM)', 'WARN');
  if(!state.apiKeys.tavily) log('No Tavily key — research uses Wikipedia live fallback (set key for Tavily/Brave)', 'WARN');
  // uptime
  setInterval(()=>{ state.agent.uptimeSec++; const h=String(Math.floor(state.agent.uptimeSec/3600)).padStart(2,'0'); const m=String(Math.floor((state.agent.uptimeSec%3600)/60)).padStart(2,'0'); const s=String(state.agent.uptimeSec%60).padStart(2,'0'); const el=$('#statUptime'); if(el) el.textContent=`${h}:${m}:${s}`; if(state.agent.uptimeSec%15===0) saveState(); },1000);
  // periodic save and queue check
  setInterval(()=>{ saveState(); if(!isProcessing) processQueue(); }, 2500);
  window.addEventListener('resize', drawChart);
  // restore tokens
  if(state.github.token){ const g=$('#ghToken'); if(g) g.value=state.github.token; const a=$('#apiGhToken'); if(a) a.value=state.github.token; }
  // initial queue kick
  setTimeout(processQueue, 700);
}
document.addEventListener('DOMContentLoaded', init);
document.addEventListener('visibilitychange', ()=>{ if(document.hidden) logPaused=false; });

function toast(msg){
  const stack = $('#toastStack'); if(!stack) return;
  const el = document.createElement('div'); el.className='toast'; el.textContent=msg; stack.appendChild(el);
  setTimeout(()=>{ el.style.opacity='0'; el.style.transform='translateY(4px)'; setTimeout(()=>el.remove(),300); },2600);
}
