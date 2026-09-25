/* ============================================================
   Gunther · GLASS HOUSE CONSOLE — js/ui/render.js
   Shared rendering: escaping, number/duration formatting,
   the small markdown engine (fences, lists, headings, inline),
   toasts and the clipboard.
   ============================================================ */

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function fmtTok(n) {
  n = n || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + "K";
  return String(Math.round(n));
}

export function fmtDur(ms) {
  const s = Math.max(0, Math.ceil((ms || 0) / 1000));
  if (s < 60) return s + "s";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m";
  const h = Math.floor(m / 60);
  return h + "h " + (m % 60) + "m";
}

export function fmtClock(d = new Date()) {
  return d.toISOString().slice(11, 19) + "Z";
}

export function fmtClockHM(d = new Date()) {
  return d.toISOString().slice(11, 16) + "Z";
}

function codeBlockHtml(block) {
  return (
    '<figure class="codeblock">' +
    '<figcaption class="codeblock__bar">' +
    '<span class="codeblock__lang">' + escapeHtml(block.lang || "code") + "</span>" +
    '<button class="codeblock__copy" type="button">COPY</button>' +
    "</figcaption>" +
    "<pre><code>" + escapeHtml(block.code) + "</code></pre>" +
    "</figure>"
  );
}

const PH = "\u0001"; // placeholder marker char for extracted fences

/**
 * Tiny, defensive markdown → HTML.
 * Supports: fenced code (```lang), inline code, **bold**, *em*,
 * [links](url), #..#### headings, - / 1. lists, paragraphs.
 * Everything is escaped first; the only tags that exist after
 * processing are the ones we emitted.
 */
export function mdToHtml(src) {
  if (!src) return "";
  const blocks = [];
  let s = String(src).replace(/\r\n/g, "\n");

  // 1) pull fenced code out before escaping
  s = s.replace(/```([^\n`]*)\n?([\s\S]*?)(?:```|$)/g, (m, lang, code) => {
    blocks.push({ lang: (lang || "").trim(), code: code.replace(/\n$/, "") });
    return PH + "C" + (blocks.length - 1) + PH;
  });

  s = escapeHtml(s);

  const inline = (t) =>
    t
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, "$1<em>$2</em>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

  const out = [];
  let list = null;
  let para = [];

  const flushPara = () => {
    if (para.length) {
      out.push("<p>" + para.map(inline).join("<br>") + "</p>");
      para = [];
    }
  };
  const closeList = () => {
    if (list) {
      out.push(list === "ul" ? "</ul>" : "</ol>");
      list = null;
    }
  };

  for (const raw of s.split("\n")) {
    const line = raw.replace(/\s+$/, "");
    const ph = line.match(/^\u0001C(\d+)\u0001$/);
    if (ph) {
      flushPara();
      closeList();
      const b = blocks[+ph[1]];
      if (b) out.push(codeBlockHtml(b));
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flushPara();
      closeList();
      const lv = Math.min(h[1].length + 2, 6);
      out.push("<h" + lv + ">" + inline(h[2]) + "</h" + lv + ">");
      continue;
    }
    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    if (ul) {
      flushPara();
      if (list !== "ul") {
        closeList();
        out.push("<ul>");
        list = "ul";
      }
      out.push("<li>" + inline(ul[1]) + "</li>");
      continue;
    }
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ol) {
      flushPara();
      if (list !== "ol") {
        closeList();
        out.push("<ol>");
        list = "ol";
      }
      out.push("<li>" + inline(ol[1]) + "</li>");
      continue;
    }
    if (!line.trim()) {
      flushPara();
      closeList();
      continue;
    }
    closeList();
    para.push(line);
  }
  flushPara();
  closeList();

  // any fence that never closed still becomes a block
  return out
    .join("\n")
    .replace(new RegExp(PH + "C(\\d+)" + PH, "g"), (m, i) => {
      const b = blocks[+i];
      return b ? codeBlockHtml(b) : "";
    });
}

/* ---------- toasts ---------- */

export function toast(msg, tone) {
  if (typeof document === "undefined") return;
  let wrap = document.querySelector(".toasts");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.className = "toasts";
    document.body.appendChild(wrap);
  }
  const el = document.createElement("div");
  el.className = "toast" + (tone ? " toast--" + tone : "");
  el.textContent = msg;
  wrap.appendChild(el);
  while (wrap.children.length > 4) wrap.firstChild.remove();
  setTimeout(() => {
    el.classList.add("toast--out");
    setTimeout(() => el.remove(), 340);
  }, 3400);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
