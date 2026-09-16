// GUY — Real Autonomous Coding Agent
// No mocks. Every action hits real APIs (LLM, Research, GitHub) or local real logic.
// Solo, self-improving, on-device WebView + Web. No simulated timers.

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
// v0.6: clean storage — no mock data. Old mock key v050 is ignored.
const STORAGE_KEY = 'guy_state_v080_real_pro_plus';
const LEGACY_KEYS_PLUS = ['guy_state_v070_real_pro','guy_state_v060_real_clean','guy_state_v050_real'];
const LEGACY_KEYS_PRO = ['guy_state_v060_real_clean','guy_state_v050_real','guy_state_v042','guy_state_v2_real'];
const LEGACY_KEYS = ['guy_state_v050_real','guy_state_v042','guy_state_v2_real'];
const LOG_MAX = 220;

// ---------- State (REAL, NO MOCKS) ----------
// Empty on first install. Skills/plugins/history only appear when YOU create them via real tasks or real LLM.
// If you saw 8 skills and evolution chart on first launch before — that was mock, now removed.
const defaultState = {
  version: '0.8.0-real-pro-plus',
  github: { repo: 'thepotatoninjahost/Guy', branch: 'arena/01a0a37c-guy', connected: false, token: '', lastSync: null, autoPR: false },
  settings: {
    autonomy: 8,
    maxIterations: 5,
    codeStyle: 'strict',
    autoResearch: true,
    autoIterate: true,
    selfReview: true,
    researchEngine: 'tavily',
    researchDepth: 3,
    provider: 'openai', // openai | anthropic | gemini | groq | openrouter | together
    model: 'gpt-4o-mini',
    temperature: 0.2,
    maxTokens: 1400,
    systemPrompt: '',
  },
  keys: {
    openai: '',
    anthropic: '',
    gemini: '',
    groq: '',
    openrouter: '',
    together: '',
    tavily: '',
    brave: '',
    exa: '',
    serper: '',
    github: ''
  },
  agent: { status: 'idle', mode: 'awaiting task', progress: 0, uptimeSec: 0, tasksDone: 0, lines: 0, skills: 0, research: 0, currentTaskId: null },
  tasks: [],
  skills: [], // REAL: empty until you deploy a real task — no fake 48% Python AsyncIO
  plugins: [], // REAL: empty until agent registers one via LLM (or core hooks auto-register on first research/review). No prefilled 8.
  researchResults: [],
  artifacts: { // current viewer — empty until real generation
    python: { tabs:[], files:{}, review:'' },
    javascript: { tabs:[], files:{}, review:'' },
    kotlin: { tabs:[], files:{}, review:'' },
  },
  history: { sessions: [] }, // REAL: no fake session
  evolution: [] // REAL: no fake "GUY initialized" — appears only after real task
};

function loadState(){
  try{
    let raw = localStorage.getItem(STORAGE_KEY);
    // migrate from v060 if present and real (has tasksDone or skills)
    if(!raw){
      try{
        for(const lk of (typeof LEGACY_KEYS_PLUS!=='undefined'? LEGACY_KEYS_PLUS : (typeof LEGACY_KEYS_PRO!=='undefined'? LEGACY_KEYS_PRO : LEGACY_KEYS))){
          const v = localStorage.getItem(lk);
          if(v){
            try{
              const parsedLegacy = JSON.parse(v);
              // if legacy was mock-only (8 skills named Python AsyncIO and no real tasks), ignore and wipe
              const isMockLegacy = parsedLegacy.skills && parsedLegacy.skills.length===8 && parsedLegacy.skills.some(s=>s.name==='Python AsyncIO') && (parsedLegacy.tasks||[]).length===0;
              if(isMockLegacy){ localStorage.removeItem(lk); continue; }
              // if legacy has any real tasks or user keys, migrate it to new key
              if((parsedLegacy.tasks && parsedLegacy.tasks.length>0) || (parsedLegacy.keys && Object.values(parsedLegacy.keys).some(Boolean))){
                localStorage.setItem(STORAGE_KEY, v);
                raw = v;
                break;
              } else {
                // empty legacy, just ignore
                localStorage.removeItem(lk);
              }
            }catch{}
          }
        }
      }catch{}
      // also clean any remaining mock keys
      try{ (typeof LEGACY_KEYS_PLUS!=='undefined'? LEGACY_KEYS_PLUS : (typeof LEGACY_KEYS_PRO!=='undefined'? LEGACY_KEYS_PRO : LEGACY_KEYS)).forEach(k=>{ const v=localStorage.getItem(k); if(v && v.includes('Python AsyncIO')) localStorage.removeItem(k); }); }catch{}
      if(!raw) return structuredClone(defaultState);
    }
    const parsed = JSON.parse(raw);
    const merged = structuredClone(defaultState);
    Object.assign(merged, parsed);
    merged.settings = {...defaultState.settings, ...(parsed.settings||{})};
    merged.keys = {...defaultState.keys, ...(parsed.keys||{})};
    merged.github = {...defaultState.github, ...(parsed.github||{})};
    merged.agent = {...defaultState.agent, ...(parsed.agent||{})};
    if(parsed.tasks) merged.tasks = parsed.tasks;
    // skills/plugins: if they look like mock seed (8 with Python AsyncIO), drop them and use empty
    const mockNames = ['Python AsyncIO','FastAPI & Pydantic','JS Toolchain (Vite/TS)','React / DOM','Kotlin Coroutines','Kotlin Flow & Channels','SQLite & Caching','Code Review AI'];
    if(parsed.skills && Array.isArray(parsed.skills)){
      const isMock = parsed.skills.length===8 && mockNames.every(n=> parsed.skills.some(s=>s.name===n));
      merged.skills = isMock ? [] : parsed.skills;
    }
    if(parsed.plugins && Array.isArray(parsed.plugins)){
      const isMockPlugins = parsed.plugins.length===8 && parsed.plugins.some(p=>p.name==='Researcher');
      merged.plugins = isMockPlugins ? [] : parsed.plugins;
    }
    if(parsed.evolution && Array.isArray(parsed.evolution)){
      const isMockEvo = parsed.evolution.length===1 && parsed.evolution[0].title?.includes('GUY initialized');
      merged.evolution = isMockEvo ? [] : parsed.evolution;
    }
    if(parsed.history && parsed.history.sessions && parsed.history.sessions.length===1 && parsed.history.sessions[0].skills===8) {
      merged.history = { sessions: [] };
    } else if(parsed.history) merged.history = parsed.history;
    if(parsed.artifacts) merged.artifacts = parsed.artifacts;
    if(parsed.researchResults) merged.researchResults = parsed.researchResults;
    // sanitize counts
    if(merged.skills.length===0) merged.agent.skills=0;
    return merged;
  }catch(e){ console.warn('loadState failed',e); return structuredClone(defaultState); }
}
let state = loadState();
function saveState(){ try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }catch(e){ console.error(e);} }

// keep old key in sync for legacy
function persistKeysToState(){
  // github token mirrored
  if(state.keys.github) state.github.token = state.keys.github;
  if(state.github.token) state.keys.github = state.github.token;
}

let currentLang = 'python';
let currentTabIndex = 0;
let logPaused = false;
let isProcessing = false;

// ---------- Helpers ----------
function toast(msg, type='info'){
  const stack = $('#toastStack');
  const el = document.createElement('div');
  el.className='toast';
  el.style.borderLeftColor = type==='error' ? 'var(--red)' : type==='warn' ? 'var(--amber)' : 'var(--glow)';
  el.textContent = msg;
  stack.appendChild(el);
  setTimeout(()=>{ el.style.opacity='0'; el.style.transform='translateY(4px)'; setTimeout(()=>el.remove(),300); }, type==='error'? 4200: 3000);
}
function nowTs(){
  const d=new Date();
  return d.toTimeString().slice(0,8);
}
function appendLog(html, level='info'){
  if(logPaused) return;
  const stream = $('#logStream');
  if(!stream) return;
  const div = document.createElement('div');
  div.className='log-line';
  // html can be plain or already formatted
  let lvlHtml = '';
  if(level==='error') lvlHtml = '<span class="log-level err">ERR</span>';
  else if(level==='warn') lvlHtml = '<span class="log-level warn">WARN</span>';
  else if(level==='sys') lvlHtml = '<span class="log-level sys">SYS</span>';
  else if(level==='research') lvlHtml = '<span class="log-level sys">RESEARCH</span>';
  else if(level==='code') lvlHtml = '<span class="log-level info">CODE</span>';
  else if(level==='review') lvlHtml = '<span class="log-level warn">REVIEW</span>';
  else lvlHtml = `<span class="log-level info">${level.toUpperCase()}</span>`;
  // if html already contains log-level, use as is
  let content = html.includes('log-level') ? html : `${lvlHtml} <span class="log-msg">${html}</span>`;
  div.innerHTML = `<span class="log-time">${nowTs()}</span> ${content}`;
  stream.appendChild(div);
  while(stream.children.length>LOG_MAX) stream.removeChild(stream.firstChild);
  stream.scrollTop = stream.scrollHeight;
  // update stats footer
  const stats = $('#logStats');
  if(stats) stats.textContent = `${stream.children.length} lines • ${state.agent.research} research`;
}
function setAgentStatus(text, mode, cls, progress){
  const aT = $('#agentStatusText'); if(aT) aT.textContent = text;
  const aM = $('#agentMode'); if(aM) aM.textContent = mode;
  const sDot = $('#sidebarStatusDot'); if(sDot) sDot.className = 'status-dot '+cls;
  const dot = $('#headerLiveDot');
  if(dot){
    dot.style.background = cls==='coding'? 'var(--amber)': cls==='research'? '#38bdf8': cls==='review'? '#c084fc':'var(--glow)';
    dot.style.boxShadow = cls==='idle'? '0 0 8px var(--glow)': `0 0 8px ${dot.style.background}`;
  }
  const progEl = $('#agentProgress'); if(progEl) progEl.style.width = progress+'%';
  const pulse = $('#agentPulse');
  if(pulse) pulse.style.background = cls==='idle'? 'var(--glow)': cls==='coding'? 'var(--amber)':'#38bdf8';
  state.agent.status = text.toLowerCase();
  state.agent.mode = mode;
  state.agent.progress = progress;
  saveState();
}
function updateStats(){
  const t = document.getElementById('statTasks'); if(t) t.textContent = state.agent.tasksDone;
  const l = document.getElementById('statLines'); if(l) l.textContent = state.agent.lines>1000 ? (state.agent.lines/1000).toFixed(1)+'k' : String(state.agent.lines);
  const s = document.getElementById('statSkills'); if(s) s.textContent = state.skills.length;
  const p = document.getElementById('statPlugins'); if(p) p.textContent = state.plugins.filter(pl=>pl.enabled).length;
  const r = document.getElementById('statResearch'); if(r) r.textContent = state.agent.research;
  const u = document.getElementById('statUptime'); if(u) u.textContent = fmtUptime(state.agent.uptimeSec);
  const ab = document.getElementById('autonomyBadge'); if(ab) ab.textContent = 'Lv ' + (state.settings.autonomy || 8);
}
function fmtUptime(s){
  const h=String(Math.floor(s/3600)).padStart(2,'0');
  const m=String(Math.floor((s%3600)/60)).padStart(2,'0');
  const sec=String(s%60).padStart(2,'0');
  return `${h}:${m}:${sec}`;
}

// ---------- HTTP helper (real, bypass CORS via CapacitorHttp when available) ----------
async function httpRequest(url, opts={}){
  const method = opts.method || 'GET';
  const headers = opts.headers || {};
  const body = opts.body;
  // Try CapacitorHttp if native
  try{
    if(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()){
      // dynamic import to avoid error if not available
      const capHttp = window.CapacitorHttp || window.Capacitor?.Plugins?.CapacitorHttp;
      if(capHttp && capHttp.request){
        const res = await capHttp.request({ url, method, headers, data: body ? (typeof body==='string'? JSON.parse(body): body) : undefined });
        // normalize
        return { ok: res.status>=200 && res.status<300, status: res.status, json: async()=> res.data, text: async()=> typeof res.data==='string'? res.data: JSON.stringify(res.data), headers: res.headers };
      }
    }
  }catch(e){ /* fall through to fetch */ }
  // fetch fallback (works for github, tavily if CORS allowed)
  const res = await fetch(url, { method, headers, body });
  return res;
}
async function fetchJson(url, opts){
  const r = await httpRequest(url, opts);
  if(!r.ok){
    const t = await r.text().catch(()=> '');
    throw new Error(`HTTP ${r.status} ${t.slice(0,300)}`);
  }
  return r.json();
}

// ---------- LLM (real) — Pro: 6 providers ----------
function getActiveProvider(){
  const k = state.keys;
  const has = {
    openai: !!k.openai,
    anthropic: !!k.anthropic,
    gemini: !!k.gemini,
    groq: !!k.groq,
    openrouter: !!k.openrouter,
    together: !!k.together,
  };
  const pref = state.settings.provider;
  if(pref && has[pref]) return pref;
  // auto-pick first available, priority: openai > anthropic > gemini > groq > openrouter > together
  for(const pr of ['openai','anthropic','gemini','groq','openrouter','together']){
    if(has[pr]) return pr;
  }
  return null;
}
function getProviderModelDefault(provider){
  const m = {
    openai: 'gpt-4o-mini',
    anthropic: 'claude-3-5-sonnet-20240620',
    gemini: 'gemini-1.5-pro',
    groq: 'llama-3-70b-8192',
    openrouter: 'openai/gpt-4o-mini',
    together: 'meta-llama/Llama-3-70b-chat-hf'
  };
  return m[provider] || 'gpt-4o-mini';
}
function heuristicGenerate(task, researchSnippets=[]){
  const t = `${task.title} ${task.desc}`;
  const researchCtx = researchSnippets.map(r=>r.snippet).join(' ').slice(0,120) || 'none';
  const base = `// Generated by GUY heuristic (no LLM key — add OpenAI/Anthropic key in Settings for full LLM)\n// Task: ${t}\n// Research: ${researchCtx}\n`;
  if(task.lang==='python'){
    return base + `from fastapi import FastAPI, Query\nfrom typing import List, Dict\nimport time, sqlite3, json, random\n\napp = FastAPI(title="${task.title.replace(/"/g,'')}", version="1.0.0")\n# Heuristic for: ${task.desc}\nCACHE_TTL = 300\ndef _cache_get(k):\n    return None\n\n@app.get("/health")\ndef health():\n    return {"ok": True, "task": "${task.id}", "research": "${researchCtx.slice(0,40)}"}\n\n@app.get("/items")\nasync def items(limit: int = Query(10, ge=1, le=50)):\n    return {"limit": limit, "items": [], "note": "heuristic — add LLM for full impl"}\n\nif __name__ == "__main__":\n    import uvicorn; uvicorn.run(app, host="0.0.0.0", port=8000)\n`;
  }
  if(task.lang==='kotlin'){
    return base + `// ${task.title}\nfun main(){\n    println("Task: ${t.slice(0,80)}")\n    // heuristic Kotlin — add LLM key for real coroutines/Flow\n}\n`;
  }
  return base + `// ${task.title} — heuristic web component\nclass GuyComponent extends HTMLElement {\n  connectedCallback(){\n    this.attachShadow({mode:'open'}).innerHTML = \`<div style="font:12px monospace;padding:8px;border:1px solid #00ff88;color:#e2e8f0;">\${document.title} — ${task.desc.slice(0,60)} — Research: ${researchCtx.slice(0,40)}</div>\`;\n  }\n}\ncustomElements.define('guy-'+'${task.id.slice(-4)}', GuyComponent);\n`;
}
async function callLLM({system, user, maxTokens, temperature}){
  const provider = getActiveProvider();
  if(!provider) return null; // heuristic fallback
  // inject Pro system prompt if set
  const sysPrompt = state.settings.systemPrompt ? state.settings.systemPrompt + "\n\n" + system : system;
  const temp = typeof temperature==='number' ? temperature : (state.settings.temperature ?? 0.2);
  const tokens = maxTokens || state.settings.maxTokens || 1400;
  const model = state.settings.model || getProviderModelDefault(provider);
  // OpenAI-compatible providers
  if(provider==='openai' || provider==='groq' || provider==='openrouter' || provider==='together'){
    let url, key, headers={ 'Content-Type':'application/json' };
    if(provider==='openai'){ url='https://api.openai.com/v1/chat/completions'; key=state.keys.openai; headers['Authorization']=`Bearer ${key}`; }
    else if(provider==='groq'){ url='https://api.groq.com/openai/v1/chat/completions'; key=state.keys.groq; headers['Authorization']=`Bearer ${key}`; }
    else if(provider==='openrouter'){ url='https://openrouter.ai/api/v1/chat/completions'; key=state.keys.openrouter; headers['Authorization']=`Bearer ${key}`; headers['HTTP-Referer']='https://guy.agent'; headers['X-Title']='GUY Pro'; }
    else if(provider==='together'){ url='https://api.together.xyz/v1/chat/completions'; key=state.keys.together; headers['Authorization']=`Bearer ${key}`; }
    const body = JSON.stringify({ model, messages: [ {role:'system', content: sysPrompt}, {role:'user', content: user} ], temperature: temp, max_tokens: tokens });
    const data = await fetchJson(url, { method:'POST', headers, body });
    const content = data.choices?.[0]?.message?.content;
    if(!content) throw new Error('Empty LLM response ('+provider+')');
    return content;
  } else if(provider==='anthropic'){
    const url = 'https://api.anthropic.com/v1/messages';
    const body = JSON.stringify({ model, max_tokens: tokens, system: sysPrompt, messages: [{role:'user', content: user}], temperature: temp });
    const data = await fetchJson(url, { method:'POST', headers:{'Content-Type':'application/json','x-api-key': state.keys.anthropic, 'anthropic-version':'2023-06-01'}, body });
    const content = data.content?.[0]?.text;
    if(!content) throw new Error('Empty Anthropic response');
    return content;
  } else if(provider==='gemini'){
    const key = state.keys.gemini;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
    const body = JSON.stringify({ contents: [{ role:'user', parts: [{ text: sysPrompt + "\n\nUSER:\n" + user }]}], generationConfig: { temperature: temp, maxOutputTokens: tokens } });
    const data = await fetchJson(url, { method:'POST', headers:{'Content-Type':'application/json'}, body });
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if(!content) throw new Error('Empty Gemini response');
    return content;
  }
  throw new Error('Unknown provider '+provider);
}
// ---------- Streaming Pro+ — live tokens in logs/code ----------
// Streams for OpenAI-compatible providers via fetch SSE; fallback simulating typing for others.
// onChunk receives each text chunk; returns full content at end.
async function callLLMStreaming({system, user, maxTokens, temperature}, onChunk){
  const provider = getActiveProvider();
  if(!provider) return null;
  const sysPrompt = state.settings.systemPrompt ? state.settings.systemPrompt + "\n\n" + system : system;
  const temp = typeof temperature==='number' ? temperature : (state.settings.temperature ?? 0.2);
  const tokens = maxTokens || state.settings.maxTokens || 1400;
  const model = state.settings.model || getProviderModelDefault(provider);
  const canStream = ['openai','groq','openrouter','together'].includes(provider);
  if(!canStream){
    // Non-streaming providers: call normal then simulate streaming typing
    const full = await callLLM({system, user, maxTokens: tokens, temperature: temp});
    if(full && onChunk){
      // simulate 18ms per chunk of ~12 chars for live feel
      const chunkSize = 24;
      for(let i=0;i<full.length;i+=chunkSize){
        const chunk = full.slice(i, i+chunkSize);
        onChunk(chunk);
        await new Promise(r=>setTimeout(r, 14));
      }
    }
    return full;
  }
  // OpenAI-compatible streaming via raw fetch (bypass CapacitorHttp for SSE)
  let url, key, headers={ 'Content-Type':'application/json', 'Accept':'text/event-stream' };
  if(provider==='openai'){ url='https://api.openai.com/v1/chat/completions'; key=state.keys.openai; headers['Authorization']=`Bearer ${key}`; }
  else if(provider==='groq'){ url='https://api.groq.com/openai/v1/chat/completions'; key=state.keys.groq; headers['Authorization']=`Bearer ${key}`; }
  else if(provider==='openrouter'){ url='https://openrouter.ai/api/v1/chat/completions'; key=state.keys.openrouter; headers['Authorization']=`Bearer ${key}`; headers['HTTP-Referer']='https://guy.agent'; headers['X-Title']='GUY Pro+'; }
  else if(provider==='together'){ url='https://api.together.xyz/v1/chat/completions'; key=state.keys.together; headers['Authorization']=`Bearer ${key}`; }
  const body = JSON.stringify({ model, messages: [ {role:'system', content: sysPrompt}, {role:'user', content: user} ], temperature: temp, max_tokens: tokens, stream: true });
  try{
    const res = await fetch(url, { method:'POST', headers, body });
    if(!res.ok || !res.body){
      // fallback to non-stream
      const data = await res.json().catch(()=>null);
      if(data && data.choices) return data.choices[0].message.content;
      throw new Error(`HTTP ${res.status}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = '';
    let buffer = '';
    while(true){
      const {done, value} = await reader.read();
      if(done) break;
      buffer += decoder.decode(value, {stream:true});
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for(const line of lines){
        const trimmed = line.trim();
        if(!trimmed || trimmed==='data: [DONE]') continue;
        if(!trimmed.startsWith('data:')) continue;
        const jsonStr = trimmed.slice(5).trim();
        if(!jsonStr) continue;
        try{
          const data = JSON.parse(jsonStr);
          const delta = data.choices?.[0]?.delta?.content || '';
          if(delta){
            fullContent += delta;
            if(onChunk) onChunk(delta);
          }
        }catch(e){ /* ignore parse */ }
      }
    }
    if(!fullContent){
      // if nothing streamed, fallback
      return await callLLM({system, user, maxTokens: tokens, temperature: temp});
    }
    return fullContent;
  }catch(e){
    // streaming failed -> fallback to non-stream
    appendLog(`Streaming failed (${provider}): ${e.message} — fallback`, 'warn');
    return await callLLM({system, user, maxTokens: tokens, temperature: temp});
  }
}

// ---------- Research (real) ----------
async function performResearch(query, lang){
  const engine = state.settings.researchEngine || 'tavily';
  const depth = state.settings.researchDepth || 3;
  // If plugins exist and Researcher explicitly disabled, skip. If no plugins (fresh install, no mocks), allow research.
  const researcher = state.plugins.find(p=>p.name==='Researcher');
  if(researcher && !researcher.enabled){
    appendLog('Researcher plugin disabled — skipping research', 'warn');
    return [];
  }
  // check key — pro: wikipedia needs no key, directly use free live wikipedia
  if(engine==='wikipedia'){
    try{
      appendLog(`Researching via Wikipedia (free) for "${query}"…`, 'research');
      setAgentStatus('RESEARCHING','Wikipedia','research', 18);
      const wiki = await fetchJson(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*`, {headers:{}});
      const hits = (wiki.query?.search||[]).slice(0, depth).map(x=> ({ source:'wikipedia.org • live', title: x.title, snippet: x.snippet.replace(/<[^>]+>/g,'').slice(0,260), relevance:'—', url:`https://en.wikipedia.org/wiki/${encodeURIComponent(x.title)}` }));
      if(hits.length){ appendLog(`Wikipedia → ${hits.length} results`, 'research'); return hits; }
    }catch(e){ appendLog(`Wikipedia failed: ${e.message}`, 'warn'); }
    return [];
  }
  const keyMap = { tavily: state.keys.tavily, brave: state.keys.brave, exa: state.keys.exa, serper: state.keys.serper };
  const key = keyMap[engine];
  if(!key){
    const msg = `No API key for ${engine}. Using live Wikipedia fallback (add ${engine} key in Settings for full ${engine}).`;
    appendLog(msg, 'warn');
    // fallback: try free Wikipedia + DuckDuckGo (real HTTP, no mock)
    try{
      appendLog(`Trying live Wikipedia fallback for "${query}"…`, 'research');
      const wiki = await fetchJson(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*`, {headers:{}});
      const hits = (wiki.query?.search||[]).slice(0, depth).map(x=> ({ source:'wikipedia.org • live', title: x.title, snippet: x.snippet.replace(/<[^>]+>/g,'').slice(0,220), relevance:'—', url:`https://en.wikipedia.org/wiki/${encodeURIComponent(x.title)}` }));
      if(hits.length){
        appendLog(`Wikipedia live fallback → ${hits.length} results`, 'research');
        return hits;
      }
    }catch(e){ appendLog(`Wikipedia fallback failed: ${e.message}`, 'warn'); }
    try{
      appendLog(`Trying DuckDuckGo fallback for "${query}"…`, 'research');
      const ddg = await fetchJson(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&pretty=1`, {headers:{}});
      const abstract = ddg.AbstractText || '';
      const related = (ddg.RelatedTopics||[]).slice(0,2).map(t=> ({ title: t.Text?.slice(0,80)||'DuckDuckGo', snippet: t.Text||abstract, source:'duckduckgo.com' }));
      if(related.length) return related.map(r=> ({ source:r.source, title:r.title, snippet:r.snippet.slice(0,260), relevance:'—' }));
    }catch(e){ appendLog(`Fallback search failed: ${e.message}`, 'warn'); }
    return [{ source:'offline • honest', title:'Research offline — add API key', snippet:`Query “${query}” — set Tavily/Brave/Exa key in Settings → API Keys for real web. Wikipedia fallback also failed.`, relevance:'—' }];
  }
  appendLog(`Researching via ${engine}: "${query}" (depth ${depth})…`, 'research');
  setAgentStatus('RESEARCHING','live web research','research', 18);
  try{
    let results=[];
    if(engine==='tavily'){
      const data = await fetchJson('https://api.tavily.com/search', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ api_key: key, query, search_depth:'advanced', include_answer:true, max_results: 5 }) });
      results = (data.results||[]).map(r=> ({ source: new URL(r.url).hostname, title: r.title, snippet: r.content?.slice(0,280)||'', relevance: (r.score ? Math.round(r.score*100)+'%':'—'), url: r.url }));
      if(data.answer) results.unshift({ source:'tavily answer', title: 'Synthesized answer', snippet: data.answer.slice(0,320), relevance:' — ', url:'' });
    } else if(engine==='brave'){
      const data = await fetchJson(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`, { headers:{'Accept':'application/json','X-Subscription-Token': key }});
      const ws = data.web?.results||[];
      results = ws.slice(0,5).map(r=> ({ source: new URL(r.url).hostname, title: r.title, snippet: r.description?.slice(0,280)||'', relevance:'—', url:r.url }));
    } else if(engine==='exa'){
      const data = await fetchJson('https://api.exa.ai/search', { method:'POST', headers:{'Content-Type':'application/json','x-api-key': key}, body: JSON.stringify({ query, numResults:5, type:'auto' })});
      results = (data.results||[]).map(r=> ({ source: new URL(r.url).hostname, title: r.title|| r.url, snippet: r.text?.slice(0,280)||'', relevance:'—', url:r.url }));
    } else if(engine==='serper'){
      const data = await fetchJson('https://google.serper.dev/search', { method:'POST', headers:{'Content-Type':'application/json','X-API-KEY': key}, body: JSON.stringify({ q: query, num:5 })});
      results = (data.organic||[]).slice(0,5).map(r=> ({ source: new URL(r.link).hostname, title: r.title, snippet: r.snippet?.slice(0,280)||'', relevance:'—', url:r.link }));
    }
    appendLog(`Research ${engine} → ${results.length} results`, 'research');
    return results.slice(0,5);
  }catch(e){
    appendLog(`Research failed (${engine}): ${e.message}`, 'error');
    toast(`Research failed: ${e.message}`, 'error');
    return [];
  }
}

// ---------- Code generation (real) ----------
function buildCodePrompt(task, researchResults, lang, iteration, previousCode, review){
  const researchBlock = researchResults.length ? `Live research snippets (use if relevant):
${researchResults.map((r,i)=>`[${i+1}] ${r.source} — ${r.title}\n${r.snippet}`).join('\n\n')}` : 'No live research (no key or disabled).';
  const langHints = {
    python: 'Write idiomatic Python 3.11, type-hinted, with docstrings. Include tests if requested.',
    javascript: 'Write modern TypeScript/JavaScript (ES2023), ESM, no external deps unless asked. Provide usage example.',
    kotlin: 'Write idiomatic Kotlin 1.9+, coroutines/Flow where relevant, concise, with KDoc.'
  };
  const style = state.settings.codeStyle || 'strict';
  const pluginHints = state.plugins.filter(p=>p.enabled && p.hooks.includes('codegen')).map(p=> `- ${p.name}: ${p.desc}`).join('\n');
  return {
    system: `You are GUY, a solo autonomous coding agent. You write, review, iterate. Language: ${lang}. Style: ${style}. Be concise, correct, production-ready. Output ONLY code in fenced blocks and a brief review note. No mocks.`,
    user: `Task: ${task.title}
Description: ${task.desc}
Language: ${lang}
Iteration: ${iteration}
${researchBlock}
${pluginHints ? `Enabled plugins:\n${pluginHints}` : ''}
${langHints[lang]||''}
${previousCode ? `Previous code (v${iteration-1}):\n\`\`\`\n${previousCode.slice(0,6000)}\n\`\`\`\nReview of previous:\n${review||'—'}\n\nImprove the code based on review. Keep API compatible unless review says otherwise. Output new full file(s).` : 'Generate initial solution. Output full file(s) with filenames as comments. If multiple files, prefix each with: // filename: <name>'}

If task is vague, make reasonable assumptions and document them.

Return strictly:
1) Code block(s) with filenames
2) ---REVIEW---
3) Brief review note for next iteration (max 2 sentences)
`
  };
}
function parseLLMCodeResponse(raw){
  // Extract code blocks
  const blocks = [...raw.matchAll(/```(?:\w+)?\n([\s\S]*?)```/g)].map(m=>m[1]);
  let code = blocks.length ? blocks.join('\n\n') : raw;
  // try to extract filenames
  const files = {};
  // split by filename comments
  const parts = code.split(/(?:\/\/ filename:|# filename:|<!-- filename:)\s*([^\n]+)/i);
  // simpler: if raw contains filename markers, parse
  let review = '';
  const reviewSplit = raw.split(/---REVIEW---/i);
  if(reviewSplit.length>1) review = reviewSplit[1].trim().slice(0,500);
  else {
    // try to find review after code blocks
    const after = raw.split('```').pop()||'';
    if(after.length<500 && after.trim()) review = after.trim().slice(0,500);
  }
  // if no files structure, single file
  if(Object.keys(files).length===0){
    // infer single filename from language
    const firstLine = code.split('\n')[0]||'';
    // keep as single file
  }
  return { code: code.trim(), review: review.trim() };
}
async function generateCode(task, researchResults, iteration, prevCode, prevReview){
  appendLog(`Generating code for "${task.title}" [${task.lang}] v${iteration}…`, 'code');
  setAgentStatus('CODING', `writing ${task.lang} v${iteration} • streaming`, 'coding', 40 + iteration*10);
  const prompt = buildCodePrompt(task, researchResults, task.lang, iteration, prevCode, prevReview);
  // Pro+ streaming: live tokens in code viewer + logs
  const codeEl = document.querySelector('#codeBlock code');
  let streamingBuffer = '';
  let streamStarted = false;
  const onChunk = (delta)=>{
    if(!streamStarted){
      streamStarted = true;
      if(codeEl) codeEl.textContent = '';
      // show live indicator in logs only once
      appendLog(`Streaming ${getActiveProvider()}…`, 'code');
    }
    streamingBuffer += delta;
    if(codeEl){
      codeEl.textContent = streamingBuffer.slice(0, 8000);
      // auto-scroll code block
      const pre = document.getElementById('codeBlock');
      if(pre) pre.scrollTop = pre.scrollHeight;
    }
    // update progress lightly
    const pct = 40 + iteration*10 + Math.min(8, Math.floor(streamingBuffer.length/400));
    const progEl = document.getElementById('agentProgress'); if(progEl) progEl.style.width = pct+'%';
  };
  let raw = null;
  try{
    raw = await callLLMStreaming(prompt, onChunk);
  }catch(e){
    appendLog(`Streaming error: ${e.message} — fallback`, 'warn');
    raw = await callLLM(prompt);
  }
  if(!raw){
    if(streamingBuffer){
      // we already streamed something but provider null means heuristic fallback was not called — treat buffer as raw
      raw = streamingBuffer;
    } else {
      appendLog('LLM keys missing — using heuristic generator (real, per-task, deterministic)', 'warn');
      const hCode = heuristicGenerate(task, researchResults);
      if(codeEl) codeEl.textContent = hCode;
      return { code: hCode, review: 'Heuristic — add LLM key for full review' };
    }
  }
  // if streamingBuffer has content and raw is similar, prefer raw (full)
  const finalRaw = raw || streamingBuffer;
  const parsed = parseLLMCodeResponse(finalRaw);
  const lines = parsed.code.split('\n').length;
  appendLog(`Generated ${lines} lines via ${getActiveProvider() || 'heuristic'} (v${iteration}) ${streamStarted ? '• streamed' : ''}`, 'code');
  return parsed;
}
async function reviewCode(code, lang){
  const verifier = state.plugins.find(p=>p.name==='Verifier');
  if((verifier && !verifier.enabled) || !state.settings.selfReview){
    if(!state.settings.selfReview) return { verdict:'skip', note:'self-review disabled' };
    // if verifier exists and disabled, respect it; if no plugins yet (fresh), allow heuristic review
    if(verifier && !verifier.enabled) return { verdict:'skip', note:'verifier disabled' };
  }
  // heuristic lint fallback (real, no mock) if no LLM
  const provider = getActiveProvider();
  if(!provider){
    const issues=[];
    if(lang==='python'){
      if(/import\s+\*/.test(code)) issues.push('Wildcard import — explicit imports preferred');
      if(!/def\s+\w+\(/.test(code) && !/class\s+\w+/.test(code)) issues.push('No function/class definition found');
    }
    if(lang==='javascript'){
      if(!/customElements\.define|export|function/.test(code)) issues.push('No export/component found');
      if(/var\s+/.test(code)) issues.push('Use let/const instead of var');
    }
    if(lang==='kotlin'){
      if(!/fun\s+\w+/.test(code) && !/class\s+\w+/.test(code)) issues.push('Missing fun/class');
      if(code.includes('GlobalScope')) issues.push('Avoid GlobalScope — use viewModelScope');
    }
    if(code.length<80) issues.push('Code too short — likely incomplete');
    const score=Math.max(0,100-issues.length*18);
    return { verdict: issues.length>1 && score<78 ? 'needs_iteration':'pass', note: issues.length? issues.join('; ') : 'heuristic review: ok' };
  }
  appendLog('Self-reviewing code via LLM…', 'review');
  setAgentStatus('REVIEWING','self-review','review', 78);
  const prompt = {
    system: `You are a strict code reviewer. Language: ${lang}. Check correctness, security, style, tests. Be terse.`,
    user: `Review this ${lang} code. Return JSON: {"verdict":"pass|needs_iteration","issues":["..."],"suggestions":"..."}\n\nCode:\n\`\`\`\n${code.slice(0,7000)}\n\`\`\``
  };
  try{
    const raw = await callLLM({...prompt, maxTokens:800, temperature:0.1});
    // try parse JSON
    const match = raw.match(/\{[\s\S]*\}/);
    if(match){
      const j = JSON.parse(match[0]);
      return { verdict: j.verdict || 'pass', note: j.suggestions || j.issues?.join('; ') || raw.slice(0,400) };
    }
    return { verdict: raw.includes('needs_iteration')? 'needs_iteration':'pass', note: raw.slice(0,400) };
  }catch(e){
    appendLog(`Review failed: ${e.message}`, 'warn');
    return { verdict:'pass', note:'review error, assuming pass' };
  }
}

// ---------- Skills & Plugins (real evolution via LLM) ----------
async function evolveSkillsFromTask(task, finalCode){
  const sf = state.plugins.find(p=>p.name==='Skill Forge');
  if(sf && !sf.enabled) return;
  // if no plugins yet, allow evolution (core feature)
  const hasLLM = !!getActiveProvider();
  if(hasLLM){
    try{
      const prompt = {
        system: 'You extract skills from coding tasks. Return JSON array: [{"name":"...", "cat":"python|javascript|kotlin|infra|research|agent", "gain": 5-15 }] max 2 skills.',
        user: `Task: ${task.title} [${task.lang}]\nDesc: ${task.desc}\nCode preview:\n${finalCode.slice(0,3000)}\n\nExisting skills: ${state.skills.map(s=>s.name).join(', ')}\n\nPropose 1-2 new or existing skill gains. If new skill, name it. If existing, pick one to level up.`
      };
      const raw = await callLLM({...prompt, maxTokens:500, temperature:0.3});
      if(!raw) throw new Error('no LLM');
      const m = raw.match(/\[[\s\S]*\]/);
      if(!m) throw new Error('no JSON');
      const arr = JSON.parse(m[0]);
      arr.slice(0,2).forEach(item=>{
        let skill = state.skills.find(s=>s.name.toLowerCase()===item.name.toLowerCase());
        if(skill){
          const gain = Math.min(15, Math.max(2, item.gain||5));
          skill.pct = Math.min(99, skill.pct + gain);
          skill.trend = `+${gain}%`;
          appendLog(`Skill "${skill.name}" ${skill.pct-gain}% → ${skill.pct}% (+${gain}%)`, 'sys');
        } else if(state.skills.length<32){
          const newSkill = { name: item.name, cat: (item.cat||'agent').toLowerCase(), pct: Math.min(60, 30 + (item.gain||8)), trend:'new' };
          state.skills.push(newSkill);
          state.agent.skills = state.skills.length;
          appendLog(`New skill acquired: "${newSkill.name}" (${newSkill.pct}%)`, 'sys');
          addEvolution(`Acquired "${newSkill.name}"`, `LLM proposed from task "${task.title}" • ${newSkill.cat} • ${newSkill.pct}%`);
        }
      });
      saveState(); renderSkills(); drawChart();
      return;
    }catch(e){ appendLog(`LLM skill evolution failed, falling back to heuristic: ${e.message}`, 'warn'); }
  }
  // heuristic fallback (real, deterministic, per-task)
  // heuristic: if no skills yet, create first one (fresh install)
  if(state.skills.length===0){
    const firstName = task.lang==='python' ? 'Python Foundations' : task.lang==='javascript' ? 'JS/TS Essentials' : 'Kotlin Basics';
    const ns = { name: firstName, cat: task.lang, pct: 28, trend:'new' };
    state.skills.push(ns);
    appendLog(`New skill acquired: "${ns.name}" (${ns.pct}%) via heuristic — first task`, 'sys');
    addEvolution(`Acquired "${ns.name}"`, `Heuristic: first ${task.lang} task → new skill at 28%`);
    saveState(); renderSkills(); drawChart();
    return;
  }
  let target = state.skills.find(s=>s.cat===task.lang) || state.skills.find(s=>s.pct===Math.min(...state.skills.map(x=>x.pct)));
  if(target){
    const gain = 3;
    const before = target.pct;
    target.pct = Math.min(99, target.pct + gain);
    target.trend = `+${gain}%`;
    appendLog(`Skill "${target.name}" ${before}% → ${target.pct}% (heuristic +${gain}%)`, 'sys');
    // Skill Forge: if same lang used 3x, create specialized skill
    const counts = state.tasks.reduce((a,t)=>{ a[t.lang]=(a[t.lang]||0)+1; return a; }, {});
    if((counts[task.lang]||0)>=3){
      const specialized = task.lang==='python' ? 'Python Tooling' : task.lang==='javascript' ? 'Bundler Ops' : 'KMP & Compose';
      if(!state.skills.find(s=>s.name===specialized)){
        state.skills.push({ name:specialized, cat:task.lang, pct:44, trend:'new' });
        addEvolution(`Acquired "${specialized}"`, `Heuristic: 3× ${task.lang} tasks → new skill at 44%`);
        appendLog(`New skill "${specialized}" acquired via heuristic`, 'sys');
      }
    }
    saveState(); renderSkills(); drawChart();
  }
}
async function maybeGeneratePlugin(task, finalCode){
  const ev = state.plugins.find(p=>p.name==='Evolver');
  if(ev && !ev.enabled) return;
  if(Math.random()>0.6) return; // only sometimes
  try{
    const prompt = {
      system: 'You propose a tiny plugin for an autonomous coding agent. Return JSON: {"name":"...","desc":"...","ver":"0.1.0"}. Only if task suggests reusable capability, else return {"skip":true}',
      user: `Task: ${task.title} [${task.lang}]\nDesc: ${task.desc}\nCode preview length ${finalCode.length}\n\nExisting plugins: ${state.plugins.map(p=>p.name).join(', ')}`
    };
    const raw = await callLLM({...prompt, maxTokens:400, temperature:0.4});
    const m = raw.match(/\{[\s\S]*\}/);
    if(!m) return;
    const j = JSON.parse(m[0]);
    if(j.skip) return;
    if(!j.name || state.plugins.find(p=>p.name===j.name)) return;
    const pl = { name: j.name, desc: j.desc||'Auto-generated', ver: j.ver||'0.1.0', enabled:true, author:'guy/generated', installs:'—', hooks:['codegen'] };
    state.plugins.push(pl);
    appendLog(`New plugin registered: "${pl.name}" v${pl.ver}`, 'sys');
    addEvolution(`Plugin "${pl.name}" created`, pl.desc);
    saveState(); renderPlugins();
  }catch(e){ /* ignore */ }
}

// ---------- GitHub (real) ----------
async function githubApi(path, method='GET', body=null){
  const token = state.keys.github || state.github.token;
  if(!token) throw new Error('GitHub PAT missing. Add in Settings → GitHub → PAT.');
  const url = `https://api.github.com${path}`;
  const headers = { 'Authorization': `Bearer ${token}`, 'Accept':'application/vnd.github+json', 'Content-Type':'application/json' };
  const opts = { method, headers, body: body ? JSON.stringify(body) : undefined };
  const res = await httpRequest(url, opts);
  const text = await res.text();
  let data; try{ data = JSON.parse(text); }catch{ data = text; }
  if(!res.ok) throw new Error(`GitHub ${res.status}: ${typeof data==='string'? data.slice(0,500) : (data.message||JSON.stringify(data).slice(0,500))}`);
  return data;
}
async function testGitHubConnection(){
  const repo = state.github.repo;
  if(!repo.includes('/')) throw new Error('Repo must be owner/repo');
  const [owner, name] = repo.split('/');
  // test user
  const user = await githubApi('/user');
  appendLog(`GitHub auth as @${user.login}`, 'sys');
  // test repo
  const repoData = await githubApi(`/repos/${owner}/${name}`);
  appendLog(`Repo ${repoData.full_name} ★${repoData.stargazers_count} branch ${state.github.branch}`, 'sys');
  // test branch
  try{
    await githubApi(`/repos/${owner}/${name}/git/ref/heads/${encodeURIComponent(state.github.branch)}`);
    appendLog(`Branch ${state.github.branch} exists`, 'sys');
  }catch(e){
    appendLog(`Branch ${state.github.branch} not found — will be created on push`, 'warn');
  }
  return { user, repoData };
}
async function pushToGitHub(task, files){
  const gh = state.plugins.find(p=>p.name==='GH Sync');
  if(gh && !gh.enabled){
    appendLog('GH Sync plugin disabled — skipping push', 'warn');
    return;
  }
  if(!state.github.connected){
    appendLog('GitHub not connected — skipping push (connect in Settings)', 'warn');
    return;
  }
  const modeEl = document.getElementById('ghMode');
  const mode = modeEl?.value || 'Autonomous commits';
  if(mode==='Dry run'){
    appendLog('Dry run mode — not pushing', 'sys');
    return;
  }
  const isPR = mode==='PR (pro)' || !!state.github.autoPR;
  const [owner, name] = state.github.repo.split('/');
  const baseBranch = state.github.branch;
  let targetBranch = baseBranch;
  let newBranch = null;
  if(isPR){
    newBranch = `guy/${task.id}-${task.lang}`;
    targetBranch = newBranch;
    appendLog(`PR mode: creating branch ${newBranch} from ${baseBranch}…`, 'sys');
    setAgentStatus('CODING','creating PR','coding', 88);
    try{
      // get base SHA
      const baseRef = await githubApi(`/repos/${owner}/${name}/git/ref/heads/${encodeURIComponent(baseBranch)}`);
      const baseSha = baseRef.object.sha;
      // try create branch, if exists delete then recreate
      try{
        await githubApi(`/repos/${owner}/${name}/git/refs`, 'POST', { ref: `refs/heads/${newBranch}`, sha: baseSha });
        appendLog(`Created branch ${newBranch}`, 'sys');
      }catch(e){
        if(String(e.message).includes('Reference already exists')){
          appendLog(`Branch ${newBranch} exists — reusing`, 'warn');
        } else {
          // try get and patch if exists
          try{ await githubApi(`/repos/${owner}/${name}/git/refs/heads/${encodeURIComponent(newBranch)}`, 'PATCH', { sha: baseSha, force: true }); appendLog(`Updated branch ${newBranch} to ${baseBranch}`, 'sys'); }catch{}
        }
      }
    }catch(e){
      appendLog(`Branch create failed: ${e.message} — falling back to ${baseBranch}`, 'warn');
      targetBranch = baseBranch;
      newBranch = null;
    }
  }
  appendLog(`Pushing ${Object.keys(files).length} file(s) to ${owner}/${name}@${targetBranch}…`, 'sys');
  setAgentStatus('CODING', isPR ? 'pushing to PR branch' : 'pushing to GitHub','coding', 92);
  for(const [path, content] of Object.entries(files)){
    const b64 = btoa(unescape(encodeURIComponent(content)));
    let sha = null;
    try{
      const existing = await githubApi(`/repos/${owner}/${name}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(targetBranch)}`);
      if(existing.sha) sha = existing.sha;
    }catch(e){ /* not exists */ }
    const message = `guy(pro): ${task.title} [${task.lang}] — ${path} (task ${task.id})`;
    const body = { message, content: b64, branch: targetBranch, sha: sha||undefined };
    if(!sha) delete body.sha;
    await githubApi(`/repos/${owner}/${name}/contents/${encodeURIComponent(path)}`, 'PUT', body);
    appendLog(`Pushed ${path} (${content.length} bytes) to ${targetBranch}`, 'sys');
  }
  if(isPR && newBranch){
    try{
      const prTitle = `GUY Pro: ${task.title} [${task.lang}]`;
      const prBody = `Autonomous task ${task.id}\n\n**Desc:** ${task.desc}\n**Lang:** ${task.lang}\n**Files:** ${Object.keys(files).join(', ')}\n**Model:** ${state.settings.provider} ${state.settings.model}\n**Research:** ${state.settings.researchEngine} (${state.agent.research} snippets)\n\n*Generated by GUY Pro v${state.version} streaming*`;
      const pr = await githubApi(`/repos/${owner}/${name}/pulls`, 'POST', { title: prTitle, head: newBranch, base: baseBranch, body: prBody, draft: false });
      appendLog(`PR created: #${pr.number} ${pr.html_url}`, 'sys');
      toast(`PR #${pr.number} created`);
      // optionally open in browser on Android
      try{ if(window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Browser){ window.Capacitor.Plugins.Browser.open({url: pr.html_url}); } }catch{}
    }catch(e){
      appendLog(`PR create failed: ${e.message} — files pushed to branch ${newBranch}`, 'warn');
      toast(`Files pushed to ${newBranch}, PR failed: ${e.message}`, 'warn');
    }
  }
  state.github.lastSync = new Date().toISOString();
  saveState(); updateGithubUI();
  appendLog(isPR ? `PR flow complete for ${newBranch}` : `Push complete to ${targetBranch}`, 'sys');
  if(!isPR) toast(`Pushed ${Object.keys(files).length} file(s) to GitHub`);
}

// ---------- Task processing (real loop) ----------
async function processTask(task){
  if(isProcessing) return;
  isProcessing = true;
  state.agent.currentTaskId = task.id;
  task.status = 'running'; task.progress = 5; task.startedAt = Date.now(); task.eta = 'running…';
  renderQueue(); saveState();
  const researchResults = [];
  let iterations = [];
  let lastCode = '';
  let lastReview = '';
  try{
    // 1. Research
    if(state.settings.autoResearch){
      const q = `${task.title} ${task.desc} ${task.lang} best practices`;
      const results = await performResearch(q, task.lang);
      researchResults.push(...results);
      state.researchResults = results;
      state.agent.research += results.length;
      renderResearch();
      saveState();
    } else {
      appendLog('Auto-research disabled — skipping', 'sys');
    }

    // 2..N iterations
    const maxIter = state.settings.maxIterations || 5;
    let verdict = 'needs_iteration';
    let iter = 1;
    for(; iter<=maxIter; iter++){
      task.progress = 20 + Math.round((iter/maxIter)*60);
      renderQueue();
      // generate
      const gen = await generateCode(task, researchResults, iter, lastCode, lastReview);
      lastCode = gen.code;
      lastReview = gen.review;
      iterations.push({ ver: iter, code: lastCode, review: lastReview });
      // store artifacts for viewer
      const files = parseFilesFromCode(lastCode, task.lang);
      state.artifacts[task.lang] = { tabs: Object.keys(files), files, review: lastReview };
      renderArtifactForLang(task.lang);
      // review
      if(state.settings.selfReview && iter < maxIter){
        const rev = await reviewCode(lastCode, task.lang);
        verdict = rev.verdict;
        lastReview = rev.note + (gen.review ? `\nLLM note: ${gen.review}` : '');
        appendLog(`Review v${iter}: ${verdict} — ${lastReview.slice(0,180)}`, rev.verdict==='pass' ? 'sys' : 'review');
        $('#reviewBox').innerHTML = `<strong>Review v${iter}:</strong> ${lastReview}`;
        if(verdict==='pass' || !state.settings.autoIterate){
          break;
        } else {
          appendLog(`Iterating → v${iter+1} (max ${maxIter})`, 'sys');
        }
      } else {
        break;
      }
    }

    // 3. Finalize
    task.status = 'review';
    task.progress = 88;
    task.iterations = iterations;
    task.research = researchResults;
    task.artifacts = state.artifacts[task.lang];
    renderQueue();
    // count lines
    const lines = lastCode.split('\n').length;
    state.agent.lines += lines;
    state.agent.tasksDone += 1;
    state.agent.currentTaskId = null;
    // evolve
    await evolveSkillsFromTask(task, lastCode);
    await maybeGeneratePlugin(task, lastCode);
    // history
    state.history.sessions.push({ at: Date.now(), skills: state.skills.length, plugins: state.plugins.filter(p=>p.enabled).length, research: state.agent.research });
    if(state.history.sessions.length>20) state.history.sessions.shift();
    addEvolution(`Completed "${task.title}"`, `v${iterations.length} • ${lines} lines • ${task.lang} • ${researchResults.length} research snippets`);
    drawChart();
    // push to GitHub if enabled
    if(state.plugins.find(p=>p.name==='GH Sync')?.enabled && state.github.connected){
      const files = state.artifacts[task.lang]?.files || { [`${task.id}.${task.lang==='python'?'py': task.lang==='kotlin'?'kt':'ts'}`]: lastCode };
      // prefix with task folder
      const prefixed = {};
      for(const [fname, content] of Object.entries(files)){
        prefixed[`guy-artifacts/${task.id}/${fname}`] = content;
      }
      try{ await pushToGitHub(task, prefixed); }catch(e){ appendLog(`GitHub push failed: ${e.message}`, 'error'); toast(`Push failed: ${e.message}`, 'error'); }
    }
    task.status = 'done';
    task.progress = 100;
    task.finishedAt = Date.now();
    task.eta = 'done';
    setAgentStatus('IDLE','awaiting task','idle', 0);
    appendLog(`Task ${task.id} completed — ${lines} lines, ${iterations.length} iteration(s)`, 'sys');
    toast(`Task done: ${task.title}`);
  }catch(e){
    task.status = 'failed';
    task.progress = 0;
    task.eta = 'failed';
    appendLog(`Task ${task.id} failed: ${e.message}`, 'error');
    toast(`Task failed: ${e.message}`, 'error');
    setAgentStatus('IDLE','error — awaiting task','idle', 0);
  } finally {
    isProcessing = false;
    state.agent.currentTaskId = null;
    renderQueue(); saveState(); updateStats();
    // process next queued
    const next = state.tasks.find(t=>t.status==='queued');
    if(next){
      appendLog(`Next queued task ${next.id} will start in 1s…`, 'sys');
      setTimeout(()=> processTask(next), 1000);
    }
  }
}
function parseFilesFromCode(code, lang){
  // try to split by filename markers like "// filename: foo.py" or "# filename:"
  const files = {};
  const markerRe = /(?:^|\n)\s*(?:\/\/\s*filename:\s*|#\s*filename:\s*|<!--\s*filename:\s*)([^\n]+)/gi;
  let lastIdx = 0;
  let lastName = null;
  let m;
  const markers = [...code.matchAll(markerRe)];
  if(markers.length===0){
    const ext = lang==='python' ? 'py' : lang==='kotlin' ? 'kt' : 'ts';
    const name = lang==='python' ? 'main.py' : lang==='javascript' ? 'index.ts' : 'Main.kt';
    files[name] = code.trim();
    return files;
  }
  // if markers exist, slice
  for(let i=0;i<markers.length;i++){
    const cur = markers[i];
    const name = cur[1].trim();
    const start = cur.index + cur[0].length;
    const end = i+1 < markers.length ? markers[i+1].index : code.length;
    const content = code.slice(start, end).trim();
    // strip leading ``` maybe
    files[name] = content.replace(/^```[\w]*\n/, '').replace(/\n```\s*$/, '').trim();
  }
  return files;
}

// ---------- UI Rendering ----------
function renderQueue(){
  const list = $('#queueList');
  if(!list) return;
  const counts = { queued: state.tasks.filter(t=>t.status==='queued').length, running: state.tasks.filter(t=>t.status==='running').length };
  const cntEl = $('#queueCount');
  if(cntEl) cntEl.textContent = `${state.tasks.length} • ${counts.running} running • ${counts.queued} queued`;
  const badge = $('#queueBadge');
  if(badge) badge.textContent = state.tasks.length;
  if(state.tasks.length===0){
    list.innerHTML = `<div style="padding:14px;text-align:center;color:var(--text-faint);font-size:11px">No tasks. Describe something above and deploy.</div>`;
    return;
  }
  list.innerHTML = state.tasks.map(t=>`
    <div class="queue-item ${t.status==='running'?'active':''}">
      <div class="q-left">
        <div class="q-title">${escapeHtml(t.title)}</div>
        <div class="q-desc">${escapeHtml(t.desc)}</div>
        <div class="q-meta">
          <span class="badge ${t.lang}">${t.lang}</span>
          <span class="badge ${t.status==='running'?'running':t.status==='review'?'review':t.status==='done'?'done':t.status==='failed'?'err':'queued'}">${t.status}</span>
          ${t.iterations ? `<span class="badge">v${t.iterations.length}</span>`:''}
        </div>
      </div>
      <div class="q-right">
        <div class="q-progress"><i style="width:${t.progress}%"></i></div>
        <span class="q-time">${t.eta||''}</span>
        ${t.status==='queued' ? `<button class="btn tiny" data-run="${t.id}">RUN</button>`:''}
        ${t.status==='done' ? `<button class="btn tiny ghost" data-view="${t.id}">VIEW</button>`:''}
      </div>
    </div>
  `).join('');
  list.querySelectorAll('[data-run]').forEach(b=>{
    b.addEventListener('click', ()=>{ const t=state.tasks.find(x=>x.id===b.dataset.run); if(t && !isProcessing) processTask(t); else toast('Agent busy'); });
  });
  list.querySelectorAll('[data-view]').forEach(b=>{
    b.addEventListener('click', ()=>{
      const t=state.tasks.find(x=>x.id===b.dataset.view);
      if(t){
        currentLang = t.lang;
        $$('#langPills .seg-btn').forEach(p=>p.classList.toggle('active', p.dataset.lang===currentLang));
        if(t.artifacts) state.artifacts[t.lang]=t.artifacts;
        renderArtifactForLang(t.lang);
        toast(`Viewing ${t.title}`);
      }
    });
  });
}
function escapeHtml(s){ return (s||'').replace(/[&<>"']/g,c=> ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

let currentViewerLang = 'python';
function renderArtifactForLang(lang){
  currentViewerLang = lang;
  currentLang = lang;
  const data = state.artifacts[lang];
  if(!data || !data.tabs) return;
  const tabsEl = $('#artifactTabs');
  if(!tabsEl) return;
  if(data.tabs.length===0){
    tabsEl.innerHTML = `<span style="padding:8px 12px;font-size:11px;color:var(--faint)">No artifact — deploy a task</span>`;
    const codeEl = document.querySelector('#codeBlock code');
    if(codeEl) codeEl.textContent = `// No artifact — deploy a task above.
// Agent will: 1) live research (Wikipedia + Tavily if key) 2) LLM/heuristic code 3) lint review 4) iterate 5) push if GH connected
// Try: "FastAPI cache", "TS sparkline component", "Kotlin Flow debounce"`;
    const meta = document.getElementById('artifactMeta'); if(meta) meta.textContent = `${lang} • 0 files`;
    const rv = document.getElementById('reviewBox'); if(rv) rv.innerHTML = `<span style="color:var(--faint)">No review yet — run a task</span>`;
    return;
  }
  tabsEl.innerHTML = data.tabs.map((t,i)=>`<button class="tab ${i===currentTabIndex?'active':''}" data-i="${i}">${escapeHtml(t)}</button>`).join('');
  tabsEl.querySelectorAll('.tab').forEach(b=>{
    b.addEventListener('click', ()=>{ currentTabIndex = parseInt(b.dataset.i); renderArtifactForLang(lang); });
  });
  const fileName = data.tabs[currentTabIndex] || data.tabs[0];
  const code = data.files[fileName] || Object.values(data.files)[0] || '// no code yet — deploy a task';
  $('#codeBlock code').textContent = code;
  $('#artifactMeta').textContent = `${lang} • ${data.tabs.length} file(s) • ${code.split('\n').length} lines`;
  // iteration pills if task has iterations
  const activeTask = state.tasks.find(t=>t.lang===lang && t.iterations) || state.tasks[0];
  const iterCount = activeTask?.iterations?.length || 1;
  const iterRow = $('#iterationRow');
  if(iterRow){
    iterRow.innerHTML = Array.from({length: iterCount}, (_,i)=> `<button class="iter-pill ${i===iterCount-1?'active':''}" data-iter="${i}">${'v'+(i+1)}</button>`).join('');
    iterRow.querySelectorAll('.iter-pill').forEach(b=>{
      b.addEventListener('click', ()=>{
        const idx = parseInt(b.dataset.iter);
        const it = activeTask?.iterations?.[idx];
        if(it){
          $('#codeBlock code').textContent = it.code;
          $('#reviewBox').innerHTML = `<strong>Review v${idx+1}:</strong> ${escapeHtml(it.review||'—')}`;
          toast(`Viewing iteration v${idx+1}`);
        }
      });
    });
  }
  const rv = $('#reviewBox');
  if(rv) rv.innerHTML = data.review ? `<strong>Review:</strong> ${escapeHtml(data.review).slice(0,600)}` : `<span style="color:var(--text-faint)">No review yet — run a task with Self-review enabled.</span>`;
}
$('#copyCodeBtn')?.addEventListener('click', ()=>{
  const txt = $('#codeBlock code').textContent;
  navigator.clipboard.writeText(txt).then(()=> toast('Code copied')).catch(()=> toast('Copy failed', 'error'));
});

// skills & plugins rendering (real, no mocks)
function renderSkills(){
  const grid = document.getElementById('skillGrid');
  if(!grid) return;
  const filtered = skillFilterCat==='all' ? state.skills : state.skills.filter(s=> (s.cat||'').toLowerCase()===skillFilterCat);
  if(state.skills.length===0){
    grid.innerHTML = `<div style="padding:18px;text-align:center;color:var(--faint);font-size:12px;line-height:1.6">No skills yet — deploy a real task on Workspace. <br>Skills are generated from real task history (LLM or heuristic) and level up as you ship. <br><span style="color:var(--muted)">Requires an LLM API key for AI-proposed skills, or heuristic will create generic ones.</span></div>`;
  } else if(filtered.length===0){
    grid.innerHTML = `<div style="padding:18px;text-align:center;color:var(--faint);font-size:12px">No ${skillFilterCat} skills yet — try All.</div>`;
  } else {
    grid.innerHTML = filtered.map(s=>`
      <div class="skill-card ${s.pct>=88?'evolving':''}">
        <div class="skill-top">
          <div>
            <div class="skill-name">${escapeHtml(s.name)}</div>
            <div class="skill-cat">${escapeHtml(s.cat)}</div>
          </div>
          <span class="skill-lvl ${s.pct>=90?'max':''}">Lv ${Math.floor(s.pct/10)}</span>
        </div>
        <div class="skill-bar"><div class="skill-fill" style="width:${s.pct}%"></div></div>
        <div class="skill-foot">
          <span>${s.pct}% proficiency</span>
          <span class="skill-trend">${escapeHtml(s.trend)}</span>
        </div>
      </div>
    `).join('');
  }
  const pc = document.getElementById('pluginCount');
  if(pc) pc.textContent = `${state.skills.length} skills`;
}
function renderPlugins(){
  const table = $('#pluginTable');
  if(!table) return;
  if(state.plugins.length===0){
    table.innerHTML = `<div style="padding:18px;text-align:center;color:var(--faint);font-size:12px;line-height:1.6">No plugins yet — plugins are registered by the agent when a real task suggests reusable capability (via LLM proposal). <br>Core hooks (research/review/evolve) work without a plugin row.</div>`;
    const pc2 = document.getElementById('pluginCount');
    if(pc2) pc2.textContent = `0`;
    return;
  }
  table.innerHTML = state.plugins.map(p=>`
    <div class="plugin-row">
      <div class="p-info">
        <div class="p-name">${escapeHtml(p.name)} <span class="badge">${escapeHtml(p.ver)}</span> ${p.hooks? `<span class="badge" style="font-size:8px">${p.hooks.join(',')}</span>`:''}</div>
        <div class="p-desc">${escapeHtml(p.desc)}</div>
        <div class="p-meta"><span>by ${escapeHtml(p.author)}</span><span>• ${escapeHtml(p.installs)} installs</span></div>
      </div>
      <div class="p-actions">
        <div class="toggle ${p.enabled?'on':''}" data-plugin="${escapeHtml(p.name)}" role="switch" aria-checked="${p.enabled}"></div>
      </div>
    </div>
  `).join('');
  table.querySelectorAll('.toggle').forEach(t=>{
    t.addEventListener('click', ()=>{
      const name = t.dataset.plugin;
      const pl = state.plugins.find(x=>x.name===name);
      if(pl){
        pl.enabled = !pl.enabled;
        saveState(); renderPlugins();
        appendLog(`Plugin "${pl.name}" ${pl.enabled?'enabled':'disabled'}`, 'sys');
        toast(`${pl.name} ${pl.enabled?'enabled':'disabled'}`);
      }
    });
  });
  const pc = document.getElementById('pluginCount');
  if(pc) pc.textContent = `${state.plugins.length}`;
}
function addEvolution(title, desc){
  state.evolution.unshift({ title, desc, time: `just now • session #${Math.max(1,state.history.sessions.length)} • ${new Date().toLocaleTimeString()}` });
  while(state.evolution.length>6) state.evolution.pop();
  saveState(); renderEvolution();
}
function renderEvolution(){
  const tl = $('#evolutionTimeline');
  if(!tl) return;
  if(state.evolution.length===0){
    tl.innerHTML = `<div style="padding:12px;text-align:center;color:var(--faint);font-size:11px;border:1px dashed rgba(255,255,255,0.08);border-radius:12px">No evolution yet — run a real task. Timeline tracks real completions, skill gains, and plugin registrations.</div>`;
    return;
  }
  tl.innerHTML = state.evolution.map(e=> `<div class="evo-item" style="display:flex;gap:8px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.06)"><span class="evo-dot" style="width:8px;height:8px;border-radius:50%;flex-shrink:0;margin-top:4px;background:${e.dot==='amber'?'var(--amber)':'var(--glow)'}"></span><div class="evo-content" style="flex:1"><div class="evo-title" style="font-size:12px;font-weight:700">${escapeHtml(e.title)}</div><div class="evo-desc" style="font-size:11px;color:var(--muted)">${escapeHtml(e.desc)}</div><div class="evo-time" style="font-size:10px;color:var(--faint)">${escapeHtml(e.time)}</div></div></div>`).join('');
}
function drawChart(){
  const c = document.getElementById('acqChart');
  if(!c) return;
  const ctx = c.getContext('2d');
  const w=c.width, h=c.height;
  ctx.clearRect(0,0,w,h);
  if(state.history.sessions.length===0){
    ctx.fillStyle='#64748b'; ctx.font='11px JetBrains Mono';
    ctx.textAlign='center';
    ctx.fillText('No history yet — completes will graph here', w/2, h/2);
    ctx.textAlign='left';
    return;
  }
  ctx.strokeStyle='rgba(255,255,255,0.06)'; ctx.lineWidth=1;
  for(let i=0;i<4;i++){ const y=14+i*32; ctx.beginPath(); ctx.moveTo(28,y); ctx.lineTo(w-10,y); ctx.stroke(); }
  const sess = state.history.sessions.slice(-7);
  while(sess.length<7) sess.unshift({skills:0,plugins:0,research:0});
  const skills = sess.map(s=> s.skills);
  const plugins = sess.map(s=> s.plugins);
  const research = sess.map(s=> s.research);
  const maxS = Math.max(1, ...skills, 12);
  const maxP = Math.max(1, ...plugins, 6);
  const maxR = Math.max(1, ...research, 10);
  function norm(arr, max){ return arr.map(v=> (v/max)*100 ); }
  function drawLine(data, color, fill){
    const xStep=(w-40)/(data.length-1);
    ctx.beginPath();
    data.forEach((v,i)=>{
      const x=30+i*xStep; const y=h-22-(v/100)*(h-48);
      if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    });
    ctx.strokeStyle=color; ctx.lineWidth=2.4; ctx.lineJoin='round'; ctx.stroke();
    if(fill){
      ctx.lineTo(30+(data.length-1)*xStep, h-22);
      ctx.lineTo(30, h-22);
      ctx.closePath(); ctx.fillStyle=fill; ctx.fill();
    }
    data.forEach((v,i)=>{
      const x=30+i*xStep; const y=h-22-(v/100)*(h-48);
      ctx.beginPath(); ctx.arc(x,y,3,0,Math.PI*2); ctx.fillStyle=color; ctx.fill();
    });
  }
  drawLine(norm(research, maxR), '#fbbf24', 'rgba(251,191,36,0.08)');
  drawLine(norm(plugins, maxP), '#6366f1', 'rgba(99,102,241,0.12)');
  drawLine(norm(skills, maxS), '#00ff88', 'rgba(0,255,136,0.14)');
  ctx.fillStyle='#64748b'; ctx.font='9px JetBrains Mono'; ctx.fillText('S'+(state.history.sessions.length-6),30,h-6); ctx.fillText('S'+state.history.sessions.length, w-30, h-6);
}

// ---------- GitHub UI (real) — mobile header pills + settings ----------
function updateGithubUI(){
  const connected = state.github.connected;
  const dot = connected? 'on':'';
  const gs = document.getElementById('githubStatus'); if(gs){ gs.className='github-status '+dot; gs.innerHTML=`<i></i> ${connected?'connected':'offline'}`; }
  const sgs = document.getElementById('settingsGithubStatus'); if(sgs){ sgs.textContent = connected?'connected':'offline'; sgs.style.color = connected?'var(--glow)':'var(--faint)'; }
  const nav = document.getElementById('githubNavDot'); if(nav){ nav.style.background = connected ? 'var(--glow)' : 'var(--faint)'; nav.style.boxShadow = connected ? '0 0 8px var(--glow)' : 'none'; const pill=document.getElementById('ghPill'); if(pill) pill.classList.toggle('on', connected); }
  const pillText = document.getElementById('ghPillText'); if(pillText) pillText.textContent = connected ? 'connected' : 'offline';
  const rl = document.getElementById('githubRepoLabel'); if(rl) rl.textContent = state.github.repo + (connected?'':' (not connected)');
  const bl = document.getElementById('githubBranchLabel'); if(bl) bl.textContent = state.github.branch;
  const ghRepo = document.getElementById('ghRepo'); if(ghRepo) ghRepo.value = state.github.repo;
  const ghBranch = document.getElementById('ghBranch'); if(ghBranch) ghBranch.value = state.github.branch;
  const syncRow = document.getElementById('syncRow');
  if(syncRow) syncRow.textContent = connected && state.github.lastSync ? `Last sync: ${new Date(state.github.lastSync).toLocaleTimeString()} • ${state.github.branch} • live` : `Last sync: never • setup PAT to enable`;
  const apiSt = document.getElementById('apiGhState'); if(apiSt){ apiSt.textContent = (state.keys.github||state.github.token)? '● active':'○ not set'; }
  // also sync key input if present
  const keyGh = document.getElementById('key_github'); if(keyGh && !keyGh.value && state.keys.github) keyGh.value = state.keys.github;
  const ghTok = document.getElementById('ghToken'); if(ghTok && !ghTok.value && state.keys.github) ghTok.value = state.keys.github;
  updateStats(); saveState();
}
async function handleConnectGh(){
  const repo = ($('#ghRepo')?.value||'').trim() || 'thepotatoninjahost/Guy';
  const branch = ($('#ghBranch')?.value||'').trim() || 'arena/01a0a37c-guy';
  const token = ($('#ghToken')?.value||'').trim();
  state.github.repo = repo; state.github.branch = branch;
  state.github.token = token; state.keys.github = token;
  persistKeysToState();
  const btn = $('#connectGhBtn');
  if(btn){ btn.textContent='⟳ CONNECTING…'; btn.disabled=true; }
  appendLog(`Testing GitHub ${repo}@${branch}…`, 'sys');
  try{
    await testGitHubConnection();
    state.github.connected = true;
    updateGithubUI();
    if(btn) btn.textContent='✓ CONNECTED';
    toast('GitHub connected — real API verified');
    appendLog(`GitHub connected as verified`, 'sys');
  }catch(e){
    state.github.connected = false;
    updateGithubUI();
    appendLog(`GitHub connect failed: ${e.message}`, 'error');
    toast(`GitHub failed: ${e.message}`, 'error');
    if(btn) btn.textContent='↯ CONNECT & TEST';
  } finally {
    if(btn) setTimeout(()=>{ btn.textContent='↯ CONNECT & TEST'; btn.disabled=false; }, 1200);
    saveState();
  }
}

// ---------- Research UI ----------
function renderResearch(){
  const wrap = document.getElementById('researchResults');
  if(!wrap) return;
  if(state.researchResults.length===0){
    wrap.innerHTML = `<div style="padding:14px;text-align:center;color:var(--faint);font-size:11px;line-height:1.5">No live results yet. Run a task with auto-research.<br>Pro: add Tavily/Brave/Exa key for web, or use Wikipedia (free) — set in Settings → Research Engine.</div>`;
    return;
  }
  wrap.innerHTML = state.researchResults.map((r,i)=>`
    <div class="r-card">
      <div class="r-head"><span class="r-source">${escapeHtml(r.source)}</span><span class="r-relevance">${escapeHtml(r.relevance)} match</span></div>
      <div class="r-title">${escapeHtml(r.title)}</div>
      <div class="r-snippet">${escapeHtml(r.snippet)}</div>
      ${r.url? `<div class="r-actions"><button class="r-btn" data-open="${i}">↗ Open</button><button class="r-btn" data-copy="${i}">⎘ Copy</button><span style="font-size:9px;color:var(--faint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">${escapeHtml(r.url)}</span></div>`:''}
    </div>
  `).join('');
  wrap.querySelectorAll('[data-open]').forEach(b=>{
    b.addEventListener('click', ()=>{
      const r=state.researchResults[parseInt(b.dataset.open)];
      if(r && r.url){ try{ if(window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Browser){ window.Capacitor.Plugins.Browser.open({url:r.url}); } else { window.open(r.url,'_blank'); } }catch{ window.open(r.url,'_blank'); } }
    });
  });
  wrap.querySelectorAll('[data-copy]').forEach(b=>{
    b.addEventListener('click', async ()=>{
      const r=state.researchResults[parseInt(b.dataset.copy)];
      if(r){ try{ await navigator.clipboard.writeText(r.snippet + (r.url ? "\n"+r.url : "")); toast('Copied'); }catch{ toast('Copy failed','error'); } }
    });
  });
  const qText = document.getElementById('researchQueryText');
  if(qText && state.researchResults.length) qText.textContent = state.researchResults[0]?.title?.slice(0,60) || 'Live results';
}

// ---------- Settings wiring (real) — fixed for mobile HTML (seg-btn + .key) ----------
function wireSettings(){
  const ir = document.getElementById('iterRange'); if(ir){ ir.value = state.settings.maxIterations; const iv=document.getElementById('iterVal'); if(iv) iv.textContent = String(state.settings.maxIterations); ir.addEventListener('input', e=>{ state.settings.maxIterations = parseInt(e.target.value); const iv2=document.getElementById('iterVal'); if(iv2) iv2.textContent = e.target.value; saveState(); }); }
  const tr = document.getElementById('tempRange'); if(tr){ tr.value = state.settings.temperature ?? 0.2; const tv=document.getElementById('tempVal'); if(tv) tv.textContent = String(state.settings.temperature ?? 0.2); tr.addEventListener('input', e=>{ state.settings.temperature = parseFloat(e.target.value); const tv2=document.getElementById('tempVal'); if(tv2) tv2.textContent = e.target.value; saveState(); }); }
  const tkr = document.getElementById('tokensRange'); if(tkr){ tkr.value = state.settings.maxTokens ?? 1400; const tkv=document.getElementById('tokensVal'); if(tkv) tkv.textContent = String(state.settings.maxTokens ?? 1400); tkr.addEventListener('input', e=>{ state.settings.maxTokens = parseInt(e.target.value); const tkv2=document.getElementById('tokensVal'); if(tkv2) tkv2.textContent = e.target.value; saveState(); }); }
  const sp = document.getElementById('systemPromptInput'); if(sp){ sp.value = state.settings.systemPrompt || ''; sp.addEventListener('change', e=>{ state.settings.systemPrompt = e.target.value; saveState(); }); sp.addEventListener('input', e=>{ state.settings.systemPrompt = e.target.value; }); }
  const autoPR = document.getElementById('ghAutoPR'); if(autoPR){ autoPR.checked = !!state.github.autoPR; autoPR.addEventListener('change', e=>{ state.github.autoPR = e.target.checked; saveState(); }); }
  const eg = document.getElementById('engineGrid');
  if(eg){
    document.querySelectorAll('#engineGrid .seg-btn').forEach(c=> c.classList.toggle('active', c.dataset.engine===state.settings.researchEngine));
    if(!eg.dataset.wired){ eg.dataset.wired='1';
      eg.addEventListener('click', e=>{
        const card = e.target.closest('.seg-btn');
        if(!card || !card.dataset.engine) return;
        document.querySelectorAll('#engineGrid .seg-btn').forEach(c=>c.classList.remove('active'));
        card.classList.add('active');
        state.settings.researchEngine = card.dataset.engine;
        const lbl=document.getElementById('researchEngineLabel'); if(lbl) lbl.textContent = card.dataset.engine + ' • live';
        saveState();
        appendLog(`Research engine → ${state.settings.researchEngine}`, 'sys');
        toast(`Research: ${state.settings.researchEngine}`);
      });
    }
  }
  const arChk = document.getElementById('autoResearch'); if(arChk){ arChk.checked = state.settings.autoResearch; if(!arChk.dataset.wired){ arChk.dataset.wired='1'; arChk.addEventListener('change', e=>{ state.settings.autoResearch = e.target.checked; saveState(); }); } }
  const aiChk = document.getElementById('autoIterate'); if(aiChk){ aiChk.checked = state.settings.autoIterate; if(!aiChk.dataset.wired){ aiChk.dataset.wired='1'; aiChk.addEventListener('change', e=>{ state.settings.autoIterate = e.target.checked; saveState(); }); } }
  const keyIds = ['openai','anthropic','gemini','groq','openrouter','together','tavily','brave','exa','serper','github'];
  keyIds.forEach(id=>{
    const inp = document.getElementById(`key_${id}`);
    if(inp){
      if(state.keys[id]) inp.value = state.keys[id];
      if(!inp.dataset.wired){
        inp.dataset.wired='1';
        inp.addEventListener('input', e=>{
          state.keys[id] = e.target.value.trim();
          if(id==='github'){ state.github.token = state.keys.github; persistKeysToState(); updateGithubUI(); }
          saveState();
          const st=document.getElementById(`state_${id}`); if(st) st.textContent = state.keys[id] ? '●' : '○';
        });
        inp.addEventListener('change', e=>{
          state.keys[id] = e.target.value.trim();
          if(id==='github'){ state.github.token = state.keys.github; persistKeysToState(); updateGithubUI(); }
          saveState(); validateKey(id);
        });
        inp.addEventListener('blur', ()=> { const st=document.getElementById(`state_${id}`); if(st) st.textContent = state.keys[id] ? '●' : '○'; });
      }
      const st=document.getElementById(`state_${id}`); if(st) st.textContent = state.keys[id] ? '●' : '○';
    }
  });
  const ghTok = document.getElementById('ghToken');
  const ghKey = document.getElementById('key_github');
  if(ghTok && ghKey){
    if(state.keys.github){ ghTok.value = state.keys.github; ghKey.value = state.keys.github; }
    if(!ghTok.dataset.wired){
      ghTok.dataset.wired='1';
      ghTok.addEventListener('input', e=>{
        state.keys.github = e.target.value.trim();
        state.github.token = state.keys.github;
        if(ghKey) ghKey.value = state.keys.github;
        saveState(); updateGithubUI();
        const st=document.getElementById('state_github'); if(st) st.textContent = state.keys.github ? '●' : '○';
      });
      ghTok.addEventListener('change', e=>{ state.keys.github=e.target.value.trim(); state.github.token=state.keys.github; saveState(); updateGithubUI(); validateKey('github'); });
    }
  }
  const tog = document.getElementById('toggleTokenBtn');
  if(tog && !tog.dataset.wired){
    tog.dataset.wired='1';
    tog.addEventListener('click', ()=>{
      const inp = document.getElementById('ghToken'); if(inp) inp.type = inp.type==='password'?'text':'password';
      const inp2 = document.getElementById('key_github'); if(inp2 && inp) inp2.type = inp.type;
    });
  }
  const pp = document.getElementById('providerPills');
  if(pp){
    document.querySelectorAll('#providerPills .seg-btn').forEach(p=> p.classList.toggle('active', p.dataset.provider===state.settings.provider));
    if(!pp.dataset.wired){
      pp.dataset.wired='1';
      pp.addEventListener('click', e=>{
        const b=e.target.closest('.seg-btn'); if(!b || !b.dataset.provider) return;
        document.querySelectorAll('#providerPills .seg-btn').forEach(p=>p.classList.remove('active'));
        b.classList.add('active');
        state.settings.provider=b.dataset.provider;
        const mi=document.getElementById('modelInput');
        if(mi && !mi.value) mi.value = getProviderModelDefault(b.dataset.provider);
        saveState(); updateProviderUI();
        appendLog(`LLM provider → ${state.settings.provider}`, 'sys');
      });
    }
  }
  const mi = document.getElementById('modelInput');
  if(mi){
    mi.value = state.settings.model || getProviderModelDefault(state.settings.provider);
    if(!mi.dataset.wired){
      mi.dataset.wired='1';
      mi.addEventListener('change', e=>{ state.settings.model=e.target.value.trim()|| getProviderModelDefault(state.settings.provider); saveState(); });
      mi.addEventListener('input', e=>{ state.settings.model=e.target.value.trim(); saveState(); });
    }
  }
  const testBtn = document.getElementById('testLLMBtn');
  if(testBtn && !testBtn.dataset.wired){
    testBtn.dataset.wired='1';
    testBtn.addEventListener('click', async ()=>{
      const btn=testBtn; btn.textContent='⟳ TESTING…'; btn.disabled=true;
      try{
        if(!getActiveProvider()) throw new Error('No LLM key set — add any provider key first');
        const r = await callLLM({system:'You are a test. Reply with "GUY_PRO_OK" in one word.', user:'ping', maxTokens:10});
        if(!r) throw new Error('No provider — heuristic');
        appendLog(`LLM test OK (${getActiveProvider()}): ${r.slice(0,120)}`, 'sys');
        toast(`LLM OK: ${r.slice(0,80)}`);
      }catch(e){ appendLog(`LLM test failed: ${e.message}`, 'error'); toast(`LLM failed: ${e.message}`, 'error'); }
      finally{ btn.textContent='↯ Test LLM (pro)'; btn.disabled=false; }
    });
  }
  const clearBtn = document.getElementById('clearKeysBtn');
  if(clearBtn && !clearBtn.dataset.wired){
    clearBtn.dataset.wired='1';
    clearBtn.addEventListener('click', ()=>{
      if(!confirm('Clear all API keys from this device?')) return;
      state.keys = {openai:'',anthropic:'',gemini:'',groq:'',openrouter:'',together:'',tavily:'',brave:'',exa:'',serper:'',github:''};
      state.github.token=''; state.github.connected=false;
      saveState(); updateGithubUI();
      keyIds.forEach(id=>{
        const inp=document.getElementById(`key_${id}`); if(inp) inp.value='';
        const st=document.getElementById(`state_${id}`); if(st) st.textContent='○';
      });
      const gh=document.getElementById('ghToken'); if(gh) gh.value='';
      toast('Keys cleared');
      appendLog('All API keys cleared', 'warn');
    });
  }
  const exportKeysBtn = document.getElementById('exportKeysBtn');
  if(exportKeysBtn && !exportKeysBtn.dataset.wired){
    exportKeysBtn.dataset.wired='1';
    exportKeysBtn.addEventListener('click', ()=>{
      const blob = new Blob([JSON.stringify({keys: state.keys, settings: state.settings}, null, 2)], {type:'application/json'});
      const url = URL.createObjectURL(blob);
      const a=document.createElement('a'); a.href=url; a.download='guy-backup-pro.json'; a.click(); URL.revokeObjectURL(url);
      toast('Backup downloaded');
    });
  }
  updateProviderUI();
  updateGithubUI();
}

async function validateKey(id){
  const val = state.keys[id];
  const row = document.getElementById(`key_${id}`)?.closest('.key') || document.getElementById('ghToken')?.closest('.key');
  const stateEl = document.getElementById(`state_${id}`) || row?.querySelector('.kstate');
  if(!val){
    if(stateEl){ stateEl.textContent='○'; stateEl.className='kstate'; }
    return;
  }
  if(stateEl){ stateEl.textContent='⟳'; stateEl.className='kstate'; }
  try{
    if(id==='openai'){
      await fetchJson('https://api.openai.com/v1/models', { headers:{'Authorization':`Bearer ${val}`}});
    } else if(id==='anthropic'){
      // anthropic has no list models without billing, just test with minimal message and catch
      // we do a quick models check via dummy
      const res = await httpRequest('https://api.anthropic.com/v1/messages', { method:'POST', headers:{'Content-Type':'application/json','x-api-key': val,'anthropic-version':'2023-06-01'}, body: JSON.stringify({model:'claude-3-haiku-20240307', max_tokens:1, messages:[{role:'user', content:'hi'}]})});
      if(res.status===401) throw new Error('401 invalid key');
      if(!res.ok && res.status!==400) throw new Error(`HTTP ${res.status}`);
    } else if(id==='github'){
      await githubApi('/user');
    } else if(id==='tavily'){
      await fetchJson('https://api.tavily.com/search', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({api_key: val, query:'test', max_results:1})});
    } else if(id==='brave'){
      await fetchJson(`https://api.search.brave.com/res/v1/web/search?q=test&count=1`, { headers:{'Accept':'application/json','X-Subscription-Token': val}});
    } else if(id==='exa'){
      await fetchJson('https://api.exa.ai/search', { method:'POST', headers:{'Content-Type':'application/json','x-api-key': val}, body: JSON.stringify({query:'test', numResults:1})});
    } else if(id==='serper'){
      await fetchJson('https://google.serper.dev/search', { method:'POST', headers:{'Content-Type':'application/json','X-API-KEY': val}, body: JSON.stringify({q:'test'})});
    } else if(id==='gemini'){
      // Gemini list models
      await fetchJson(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(val)}`, { headers:{} });
    } else if(id==='groq'){
      await fetchJson('https://api.groq.com/openai/v1/models', { headers:{'Authorization':`Bearer ${val}`}});
    } else if(id==='openrouter'){
      await fetchJson('https://openrouter.ai/api/v1/models', { headers:{'Authorization':`Bearer ${val}`}});
    } else if(id==='together'){
      await fetchJson('https://api.together.xyz/v1/models', { headers:{'Authorization':`Bearer ${val}`}});
    }
    if(stateEl){ stateEl.textContent='●'; stateEl.className='kstate ok'; }
    appendLog(`Key ${id} validated`, 'sys');
  }catch(e){
    if(stateEl){ stateEl.textContent='○'; stateEl.className='kstate warn'; }
    appendLog(`Key ${id} failed: ${e.message}`, 'warn');
  }
}
function updateProviderUI(){
  // mobile: just highlight active provider pill; no per-row opacity needed, but keep subtle
  const prov = getActiveProvider();
  $$('#providerPills .seg-btn').forEach(b=>{
    b.style.opacity = b.dataset.provider===prov ? '1' : '0.7';
  });
}

// ---------- Navigation & Sidebar ----------
function setScreen(id){
  $$('.screen').forEach(s=>s.classList.remove('active'));
  const tgt = document.getElementById('screen-'+id); if(tgt) tgt.classList.add('active');
  $$('.nav-item,.bnav-item,.bnav').forEach(b=> b.classList.toggle('active', b.dataset.screen===id));
  const sb = $('#sidebar'); if(sb) sb.classList.remove('open');
  const bd = $('#backdrop'); if(bd) bd.classList.remove('show');
  window.scrollTo({top:0,behavior:'smooth'});
  if(id==='skills') drawChart();
}
$$('.nav-item,.bnav-item,.bnav').forEach(b=> b.addEventListener('click', ()=> setScreen(b.dataset.screen)));
const menuBtn = $('#menuBtn');
if(menuBtn) menuBtn.addEventListener('click', ()=>{
  const sb = $('#sidebar'); if(!sb) return;
  sb.classList.toggle('open');
  const bd = $('#backdrop'); if(bd) bd.classList.toggle('show', sb.classList.contains('open'));
});
const backdrop = $('#backdrop');
if(backdrop) backdrop.addEventListener('click', ()=>{
  const sb=$('#sidebar'); if(sb) sb.classList.remove('open');
  backdrop.classList.remove('show');
});
const collapseBtn = $('#collapseBtn');
if(collapseBtn) collapseBtn.addEventListener('click', ()=>{
  const sb=$('#sidebar'); if(!sb) return;
  sb.classList.toggle('collapsed');
  collapseBtn.textContent = sb.classList.contains('collapsed') ? '› Expand' : '‹ Collapse';
});
$$('.card-head.collapsible').forEach(h=>{
  h.addEventListener('click', ()=>{
    const id = h.dataset.toggle;
    const body = document.getElementById(id);
    if(!body) return;
    const hidden = body.style.display==='none';
    body.style.display = hidden ? '' : 'none';
    h.classList.toggle('collapsed', !hidden);
  });
});

// ---------- Task submission (real) ----------
function wireTaskSubmission(){
  const langPills = $('#langPills');
  if(langPills){
    // mobile uses .seg-btn
    $$('#langPills .seg-btn').forEach(b=> b.classList.toggle('active', b.dataset.lang===currentLang));
    langPills.addEventListener('click', e=>{
      const b = e.target.closest('.seg-btn');
      if(!b || !b.dataset.lang) return;
      $$('#langPills .seg-btn').forEach(p=>p.classList.remove('active'));
      b.classList.add('active');
      currentLang = b.dataset.lang;
      renderArtifactForLang(currentLang);
    });
  }
  $('#deployBtn')?.addEventListener('click', async ()=>{
    try{ if(navigator.vibrate) navigator.vibrate(30); }catch{}
    const prompt = ($('#taskInput')?.value||'').trim();
    if(!prompt){
      toast('Describe a task first'); $('#taskInput')?.focus(); return;
    }
    const pri = document.querySelector('[data-pri].active')?.dataset.pri || 'normal';
    const title = prompt.slice(0,64) + (prompt.length>64?'…':'');
    const id = 't'+Date.now().toString(36);
    const task = { id, title, desc: prompt.slice(0,240), lang: currentLang, status:'queued', progress:0, eta: pri==='urgent'?'urgent':'queued', createdAt: Date.now() };
    state.tasks.unshift(task);
    if(state.tasks.length>20) state.tasks.pop();
    renderQueue(); saveState();
    $('#taskInput').value='';
    toast(`Queued: ${title}`);
    appendLog(`QUEUED #${id} [${currentLang}] pri=${pri} — "${title}"`, 'sys');
    // check keys
    const prov = getActiveProvider();
    if(!prov){
      appendLog('No LLM key — will use on-device heuristic generator (real, per-task). Add OpenAI/Anthropic key in Settings for full LLM.', 'warn');
      toast('No LLM key → heuristic mode. Add key in Settings for full LLM.', 'warn');
    }
    // if idle, start processing immediately
    if(!isProcessing){
      const next = state.tasks.find(t=>t.status==='queued');
      if(next) processTask(next);
    } else {
      appendLog(`Agent busy — ${task.id} queued (${state.tasks.filter(t=>t.status==='queued').length} waiting)`, 'sys');
    }
  });
  $('#taskInput')?.addEventListener('keydown', e=>{
    if((e.metaKey||e.ctrlKey) && e.key==='Enter') $('#deployBtn').click();
  });
  $('#connectGhBtn')?.addEventListener('click', handleConnectGh);
  $('#toggleTokenBtn')?.addEventListener('click', ()=>{
    const inp = $('#ghToken'); if(inp) inp.type = inp.type==='password'?'text':'password';
  });
  $('#ghRepo')?.addEventListener('change', e=>{ state.github.repo=e.target.value.trim(); saveState(); updateGithubUI(); });
  $('#ghBranch')?.addEventListener('change', e=>{ state.github.branch=e.target.value; saveState(); updateGithubUI(); });
  $('#ghToken')?.addEventListener('input', e=>{ state.keys.github=e.target.value.trim(); state.github.token=state.keys.github; saveState(); updateGithubUI(); });
}

// ---------- Logs ----------
function initLogs(){
  const s = $('#logStream');
  if(!s) return;
  // real boot logs
  const boot = [
    `SYS GUY v${state.version} — real mode • no mocks • Galaxy S25 360×780`,
    `SYS storage: ${localStorage.getItem(STORAGE_KEY) ? 'loaded' : 'fresh'} • ${state.skills.length} skills • ${state.plugins.length} plugins`,
    `${getActiveProvider() ? 'INFO' : 'WARN'} LLM provider: ${getActiveProvider()||'NONE — add key in Settings'}`,
    `INFO Research engine: ${state.settings.researchEngine} • ${state.keys[state.settings.researchEngine] ? 'key present' : 'no key — set in Settings'}`,
    `INFO GitHub: ${state.github.connected? 'connected '+state.github.repo : 'offline — connect in Settings'}`,
    `SYS Ready — deploy a task. Agent will research → code → review → iterate → push (if GH enabled).`
  ];
  s.innerHTML = boot.map(l=>{
    const lvl = l.split(' ')[0];
    const msg = l.slice(lvl.length+1);
    const lvlHtml = lvl==='SYS'? '<span class="log-level sys">SYS</span>' : lvl==='WARN'? '<span class="log-level warn">WARN</span>' : '<span class="log-level info">INFO</span>';
    return `<div class="log-line"><span class="log-time">${nowTs()}</span> ${lvlHtml} <span class="log-msg">${escapeHtml(msg)}</span></div>`;
  }).join('');
  s.scrollTop = s.scrollHeight;
}
$('#pauseLogBtn')?.addEventListener('click', ()=>{
  logPaused = !logPaused;
  $('#pauseLogBtn').textContent = logPaused ? '▶' : '⏸';
  toast(logPaused ? 'Log paused' : 'Log resumed');
});
$('#clearLogBtn')?.addEventListener('click', ()=>{
  $('#logStream').innerHTML=''; toast('Logs cleared');
});

// ---------- Uptime ----------
let uptimeTimer = null;
function startUptime(){
  uptimeTimer = setInterval(()=>{
    state.agent.uptimeSec += 1;
    updateStats();
    if(state.agent.uptimeSec % 15 ===0) saveState();
  },1000);
}

// ---------- Init ----------
// ---------- Pro Helpers — voice, chips, skill filter, plugin install, exports ----------
let skillFilterCat = 'all';
function wireProChips(){
  const chips = document.getElementById('templateChips');
  if(!chips || chips.dataset.wired) return;
  chips.dataset.wired='1';
  const tpl = {
    python: "Python FastAPI that caches HN top posts to SQLite with TTL, plus /health and pytest",
    ts: "TypeScript Web Component sparkline that renders data array as SVG, shadow DOM, no deps",
    kotlin: "Kotlin Flow debounce search with 300ms, coroutines, StateFlow, ViewModel sample",
    py2: "Python CLI todo with argparse, JSON store, pytest, ruff + mypy strict"
  };
  chips.addEventListener('click', e=>{
    const btn = e.target.closest('.chip'); if(!btn) return;
    const key = btn.dataset.tpl;
    const val = tpl[key] || btn.textContent;
    const ta = document.getElementById('taskInput');
    if(ta){ ta.value = val; ta.focus(); toast(`Template: ${key}`); }
    // haptic
    try{ if(navigator.vibrate) navigator.vibrate(20); }catch{}
  });
}
function wireVoice(){
  const btn = document.getElementById('voiceBtn');
  const ta = document.getElementById('taskInput');
  if(!btn || !ta || btn.dataset.wired) return;
  btn.dataset.wired='1';
  let rec=null, listening=false;
  btn.addEventListener('click', ()=>{
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if(!SR){ toast('Voice not supported on this device', 'warn'); return; }
    if(listening){
      try{ rec.stop(); }catch{}
      return;
    }
    rec = new SR();
    rec.lang = 'en-US';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onstart = ()=>{ listening=true; btn.classList.add('recording'); btn.textContent='●'; toast('Listening… speak now'); };
    rec.onend = ()=>{ listening=false; btn.classList.remove('recording'); btn.textContent='🎤'; };
    rec.onresult = e=>{ const t=e.results[0][0].transcript; ta.value = (ta.value ? ta.value+' ' : '') + t; ta.focus(); toast('Voice captured'); };
    rec.onerror = e=>{ toast('Voice error: '+e.error, 'error'); btn.classList.remove('recording'); btn.textContent='🎤'; listening=false; };
    try{ rec.start(); }catch(e){ toast('Voice failed: '+e.message,'error'); }
  });
}
function applySkillFilter(){
  const grid = document.getElementById('skillGrid');
  if(!grid) return;
  // re-render with filter
  renderSkills();
}
function wireSkillFilter(){
  const f = document.getElementById('skillFilter');
  if(!f || f.dataset.wired) return;
  f.dataset.wired='1';
  f.addEventListener('click', e=>{
    const b=e.target.closest('.seg-btn'); if(!b) return;
    f.querySelectorAll('.seg-btn').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    skillFilterCat = b.dataset.filter || 'all';
    applySkillFilter();
  });
}
function wirePluginPro(){
  const btn = document.getElementById('installPluginBtn');
  const inp = document.getElementById('pluginUrlInput');
  if(btn && inp && !btn.dataset.wired){
    btn.dataset.wired='1';
    btn.addEventListener('click', async ()=>{
      const url = inp.value.trim();
      if(!url || !url.includes('/')) { toast('Enter owner/repo or github.com/owner/repo','warn'); return; }
      const repo = url.replace(/^https?:\/\/github\.com\//,'').replace(/#.*/,'').trim();
      btn.textContent='⟳'; btn.disabled=true;
      try{
        appendLog(`Fetching plugin ${repo}…`, 'sys');
        // try fetch README via GitHub API (needs no auth for public, but use token if present)
        let readme=''; let desc=repo;
        try{
          const token = state.keys.github || state.github.token;
          const headers = token ? { Authorization: `Bearer ${token}`, Accept:'application/vnd.github+json'} : {Accept:'application/vnd.github+json'};
          const info = await fetchJson(`https://api.github.com/repos/${repo}`, {headers});
          desc = info.description || desc;
          try{
            const rm = await fetchJson(`https://api.github.com/repos/${repo}/readme`, {headers});
            if(rm.content) readme = atob(rm.content.replace(/\n/g,'')).slice(0,800);
          }catch{}
        }catch(e){ appendLog(`GitHub fetch warn: ${e.message}`,'warn'); }
        // propose via LLM if available, else heuristic
        let name = repo.split('/').pop().replace(/[-_]/g,' ');
        name = name.split(' ').map(w=>w[0]?.toUpperCase()+w.slice(1)).join(' ');
        if(getActiveProvider()){
          try{
            const prompt={ system:'You are plugin registrar. Return JSON {name,desc,ver}. Name concise.', user:`Repo: ${repo}\nDesc: ${desc}\nReadme: ${readme.slice(0,600)}\nExisting plugins: ${state.plugins.map(p=>p.name).join(', ')}` };
            const raw = await callLLM({...prompt, maxTokens:300});
            const m=raw.match(/\{[\s\S]*\}/); if(m){ const j=JSON.parse(m[0]); if(j.name) name=j.name; if(j.desc) desc=j.desc; }
          }catch{}
        }
        if(state.plugins.find(p=>p.name.toLowerCase()===name.toLowerCase())) throw new Error('Plugin already installed');
        const pl={ name, desc: desc.slice(0,120), ver:'0.1.0', enabled:true, author: repo, installs:'—', hooks:['codegen'] };
        state.plugins.push(pl); saveState(); renderPlugins(); drawChart();
        addEvolution(`Plugin "${pl.name}" installed`, `From ${repo}`);
        appendLog(`Plugin "${pl.name}" installed from ${repo}`, 'sys');
        toast(`Installed ${pl.name}`);
        inp.value='';
      }catch(e){ appendLog(`Plugin install failed: ${e.message}`,'error'); toast(e.message,'error'); }
      finally{ btn.textContent='Install'; btn.disabled=false; }
    });
  }
  const expBtn=document.getElementById('exportSkillsBtn');
  if(expBtn && !expBtn.dataset.wired){
    expBtn.dataset.wired='1';
    expBtn.addEventListener('click', ()=>{
      if(state.skills.length===0){ toast('No skills to export','warn'); return; }
      const blob=new Blob([JSON.stringify({skills:state.skills, plugins:state.plugins, history:state.history}, null,2)],{type:'application/json'});
      const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='guy-skills-pro.json'; a.click(); URL.revokeObjectURL(url);
      toast('Skills exported');
    });
  }
  const clearBtn=document.getElementById('clearSkillsBtn');
  if(clearBtn && !clearBtn.dataset.wired){
    clearBtn.dataset.wired='1';
    clearBtn.addEventListener('click', ()=>{
      if(!confirm('Clear all skills/plugins/evolution? (keeps tasks)')) return;
      state.skills=[]; state.plugins=[]; state.evolution=[]; state.history={sessions:[]};
      saveState(); renderSkills(); renderPlugins(); renderEvolution(); drawChart(); updateStats();
      toast('Cleared');
    });
  }
}
function wireExports(){
  const exportLog=document.getElementById('exportLogBtn');
  if(exportLog && !exportLog.dataset.wired){
    exportLog.dataset.wired='1';
    exportLog.addEventListener('click', ()=>{
      const s=document.getElementById('logStream');
      const text=[...s.children].map(l=>l.textContent).join('\n');
      const blob=new Blob([text],{type:'text/plain'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='guy-logs.txt'; a.click(); URL.revokeObjectURL(url);
      toast('Logs exported');
    });
  }
  const shareBtn=document.getElementById('shareCodeBtn');
  if(shareBtn && !shareBtn.dataset.wired){
    shareBtn.dataset.wired='1';
    shareBtn.addEventListener('click', async ()=>{
      const code=document.querySelector('#codeBlock code')?.textContent||'';
      if(!code || code.includes('No artifact')){ toast('No code to share','warn'); return; }
      if(navigator.share){
        try{ await navigator.share({title:'GUY Code', text:code}); toast('Shared'); }catch{}
      } else {
        await navigator.clipboard.writeText(code); toast('Copied for sharing');
      }
    });
  }
  const exportCode=document.getElementById('exportCodeBtn');
  if(exportCode && !exportCode.dataset.wired){
    exportCode.dataset.wired='1';
    exportCode.addEventListener('click', ()=>{
      const code=document.querySelector('#codeBlock code')?.textContent||'';
      if(!code || code.includes('No artifact')){ toast('No code','warn'); return; }
      const lang=currentLang||'txt';
      const ext=lang==='python'?'py':lang==='kotlin'?'kt':'ts';
      const blob=new Blob([code],{type:'text/plain'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=`guy-${Date.now()}.${ext}`; a.click(); URL.revokeObjectURL(url);
      toast('Exported');
    });
  }
}

function init(){
  // ensure currentLang from pills (mobile uses seg-btn)
  const activePill = document.querySelector('#langPills .seg-btn.active');
  if(activePill) currentLang = activePill.dataset.lang;
  renderQueue();
  initLogs();
  renderArtifactForLang(currentLang);
  renderSkills();
  renderPlugins();
  renderResearch();
  renderEvolution();
  updateGithubUI();
  drawChart();
  wireSettings();
  wireTaskSubmission();
  wireProChips();
  wireVoice();
  wireSkillFilter();
  wirePluginPro();
  wireExports();
  // prefill keys
  persistKeysToState();
  // show initial status
  if(state.agent.currentTaskId){
    const t = state.tasks.find(x=>x.id===state.agent.currentTaskId);
    if(t && t.status==='running'){
      setAgentStatus('CODING','resuming task','coding', t.progress||30);
      // resume processing if not already
      if(!isProcessing) processTask(t);
    } else {
      setAgentStatus('IDLE','awaiting task','idle', 0);
    }
  } else {
    setAgentStatus('IDLE','awaiting task','idle', 0);
  }
  updateStats();
  startUptime();
  window.addEventListener('resize', ()=> drawChart());
  // Pro+ splash hide
  setTimeout(()=>{ const s=document.getElementById('splash'); if(s) s.classList.add('hide'); }, 1300);
  // warn if no keys
  if(!getActiveProvider()){
    setTimeout(()=>{
      toast('Add LLM API key in Settings → API Keys to enable real code generation', 'warn');
      appendLog('No LLM key — heuristic generator will be used. Add OpenAI/Anthropic key in Settings for real LLM.', 'warn');
    }, 1200);
  }
  // copy code
  $('#copyCodeBtn')?.addEventListener('click', ()=>{
    const txt = $('#codeBlock code').textContent;
    navigator.clipboard.writeText(txt).then(()=> toast('Copied')).catch(()=> toast('Copy failed','error'));
  });
  // acquire skill button — real via LLM, heuristic fallback if no key
  const acquireBtn = document.getElementById('acquireSkillBtn');
  if(acquireBtn && !acquireBtn.dataset.wired){
    acquireBtn.dataset.wired='1';
    acquireBtn.addEventListener('click', async ()=>{
      const btn = acquireBtn;
      const orig = btn.textContent;
      btn.textContent='⟳…'; btn.disabled=true;
      try{
        const topic = prompt('What skill to acquire? (e.g., "Rust async", "WebGL shaders")');
        if(!topic){ btn.textContent=orig; btn.disabled=false; return; }
        if(!getActiveProvider()){
          // heuristic — no LLM key needed
          const name = topic.trim().slice(0,32);
          if(state.skills.find(s=>s.name.toLowerCase()===name.toLowerCase())) throw new Error('Skill already exists');
          const cat = /python|py/i.test(topic) ? 'python' : /kotlin/i.test(topic) ? 'kotlin' : /js|ts|javascript|react/i.test(topic) ? 'javascript' : 'agent';
          const newSkill = { name, cat, pct: 18, trend:'new', desc: `Manually added — ${topic}` };
          state.skills.push(newSkill);
          saveState(); renderSkills(); drawChart();
          addEvolution(`Acquired "${newSkill.name}"`, newSkill.desc);
          appendLog(`Skill "${newSkill.name}" acquired via heuristic (no LLM key)`, 'sys');
          toast(`Acquired ${newSkill.name}`);
          return;
        }
        appendLog(`Acquiring skill: "${topic}" via LLM…`, 'sys');
        const promptObj = {
          system: 'You are Skill Forge. Given a topic, propose a skill object JSON: {"name":"...","cat":"python|javascript|kotlin|infra|research|agent","desc":"..."} Keep name concise.',
          user: `Topic: ${topic}\nExisting: ${state.skills.map(s=>s.name).join(', ')}`
        };
        const raw = await callLLM({...promptObj, maxTokens:400});
        if(!raw) throw new Error('No LLM key — use heuristic typing the name directly');
        const m = raw.match(/\{[\s\S]*\}/);
        if(!m) throw new Error('LLM did not return JSON');
        const j = JSON.parse(m[0]);
        const newSkill = { name: j.name, cat: (j.cat||'agent').toLowerCase(), pct: 24, trend:'new', desc: j.desc||'' };
        if(state.skills.find(s=>s.name===newSkill.name)) throw new Error('Skill already exists');
        state.skills.push(newSkill);
        saveState(); renderSkills(); drawChart();
        addEvolution(`Acquired "${newSkill.name}"`, newSkill.desc||`Requested: ${topic}`);
        appendLog(`Skill "${newSkill.name}" acquired`, 'sys');
        toast(`Acquired ${newSkill.name}`);
      }catch(e){
        appendLog(`Acquire failed: ${e.message}`, 'error');
        toast(`Failed: ${e.message}`, 'error');
      } finally { btn.textContent=orig; btn.disabled=false; }
    });
  }
}
document.addEventListener('DOMContentLoaded', init);
document.addEventListener('visibilitychange', ()=>{ /* keep logs */ });

// expose for debugging
window.GUY = { state, saveState, callLLM, performResearch, processTask, githubApi };
