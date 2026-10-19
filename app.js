// Tachivel — local EPUB listen-along reader.
// Book model: { v, id, title, author, chapters: [{ t, p, b: [[kind, n]...], s: [sentence...] }], images: [{ ch, s, alt, cap, blob }], toc: [{ t, d, g, ch, anc }] }
"use strict";

const $ = (id) => document.getElementById(id);
const THEMES = [["ember", "Ember"], ["dark", "True Dark"], ["light", "Light"]];
const STORE_KEY = "tachivel:state";

// ---------- Persistence ----------
const state = Object.assign(
  { bookId: null, ch: 0, s: 0, voice: null, rate: 1, theme: "ember", size: 20 },
  readState()
);
function readState() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; }
}
function saveState() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch {}
}

function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open("tachivel", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("books");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function dbGet(key) {
  const db = await idb();
  return new Promise((res, rej) => {
    const r = db.transaction("books").objectStore("books").get(key);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function dbPut(key, val) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction("books", "readwrite");
    tx.objectStore("books").put(val, key);
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
  });
}

// ---------- EPUB parsing ----------
// Bump when the parsed book format changes; older saved books ask for a re-import.
const BOOK_VERSION = 2;
// Block kinds inside a chapter: [kind, n]
const TEXT = 0, HEAD = 1, IMAGE = 2, BREAK = 3; // TEXT/HEAD: n sentences · IMAGE: n = image index · BREAK: scene divider
const BLOCK = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "li", "div", "section", "article", "pre", "td", "dd", "dt", "figure", "figcaption", "header", "footer", "aside", "hr", "table", "ul", "ol"]);
const HEADING = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
const SKIP = new Set(["script", "style", "head", "rt", "rp", "math", "nav"]);
const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
const HAS_WORDS = /[\p{L}\p{N}]/u;

const dirOf = (p) => p.slice(0, p.lastIndexOf("/") + 1);
function resolvePath(base, rel) {
  const u = new URL(rel, "http://x/" + base);
  return decodeURIComponent(u.pathname.slice(1));
}
function parseXml(str) { return new DOMParser().parseFromString(str, "application/xml"); }
function parseHtml(str) {
  str = str.replace(/<style[\s\S]*?<\/style>/gi, ""); // book styles are never used, and the CSP would flag each one
  let d = new DOMParser().parseFromString(str, "application/xhtml+xml");
  if (d.getElementsByTagName("parsererror").length) d = new DOMParser().parseFromString(str, "text/html");
  return d;
}
const byTag = (doc, tag) => [...doc.getElementsByTagNameNS("*", tag)];
const kids = (el, tag) => [...el.children].filter((c) => c.localName.toLowerCase() === tag);
const clean = (t) => t.replace(/\s+/g, " ").trim();

function containsBlock(el) {
  for (const d of el.getElementsByTagName("*")) {
    const t = d.localName.toLowerCase();
    if (BLOCK.has(t) || t === "br" || t === "img" || t === "image") return true;
  }
  return false;
}
// Collect a chapter's content in reading order: [TEXT|HEAD, text] | [IMAGE, {src, alt}] | [BREAK]
function walk(el, out, base) {
  let buf = "";
  const flush = () => {
    const t = clean(buf);
    buf = "";
    if (!t) return;
    out.push(HAS_WORDS.test(t) ? [TEXT, t] : [BREAK]); // "* * *" is a scene break, not something to read out
  };
  for (const n of el.childNodes) {
    if (n.nodeType === 3) { buf += n.textContent; continue; }
    if (n.nodeType !== 1) continue;
    const tag = n.localName.toLowerCase();
    if (SKIP.has(tag)) continue;
    if (tag === "br") { flush(); continue; }
    if (tag === "hr") { flush(); out.push([BREAK]); continue; }
    if (tag === "img" || tag === "image") {
      const src = n.getAttribute("src") || n.getAttribute("href") || n.getAttributeNS("http://www.w3.org/1999/xlink", "href");
      flush();
      if (src) out.push([IMAGE, { src: resolvePath(base, src), alt: clean(n.getAttribute("alt") || "") }]);
      continue;
    }
    if (tag === "figcaption") {
      flush();
      const t = clean(n.textContent);
      const last = out[out.length - 1];
      // A caption that only repeats the picture's alt text is shown under the picture, not read twice.
      if (last?.[0] === IMAGE && (n.getAttribute("aria-hidden") === "true" || t === last[1].alt)) last[1].cap = t;
      else if (t) walk(n, out, base);
      continue;
    }
    if (HEADING.has(tag)) { flush(); const t = clean(n.textContent); if (t) out.push([HEAD, t]); continue; }
    if (BLOCK.has(tag) || containsBlock(n)) { flush(); walk(n, out, base); }
    else buf += n.textContent;
  }
  flush();
}
function splitSentences(text) {
  return [...segmenter.segment(text)].map((x) => x.segment.trim()).filter(Boolean);
}

// Table of contents as nested rows: { t, p (file path), d (depth), g (has children) }
function navRows(list, depth, base, rows) {
  for (const li of kids(list, "li")) {
    const label = kids(li, "a")[0] || kids(li, "span")[0];
    const href = label?.getAttribute("href");
    const sub = kids(li, "ol")[0] || kids(li, "ul")[0];
    rows.push({ t: clean(label?.textContent || ""), p: href ? resolvePath(base, href.split("#")[0]) : null, d: depth, g: !!sub });
    if (sub) navRows(sub, depth + 1, base, rows);
  }
}
function ncxRows(parent, depth, base, rows) {
  for (const np of kids(parent, "navpoint")) {
    const src = byTag(np, "content")[0]?.getAttribute("src");
    const label = byTag(np, "text")[0]?.textContent || "";
    const subs = kids(np, "navpoint");
    rows.push({ t: clean(label), p: src ? resolvePath(base, src.split("#")[0]) : null, d: depth, g: subs.length > 0 });
    ncxRows(np, depth + 1, base, rows);
  }
}

// Only plain raster pictures become blob URLs; a book can't smuggle in HTML/SVG labelled as an image.
const RASTER = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", avif: "image/avif" };
function imageType(path, declared) {
  if (Object.values(RASTER).includes(declared)) return declared;
  return RASTER[path.split(".").pop().toLowerCase()] || null;
}

async function parseEpub(file, onProgress) {
  const zip = await JSZip.loadAsync(file);
  const entry = (p) => zip.file(p) || zip.file(decodeURIComponent(p));
  const read = async (p) => { const f = entry(p); return f ? f.async("string") : null; };
  const container = await read("META-INF/container.xml");
  if (!container) throw new Error("This file isn't an EPUB (no META-INF/container.xml).");
  const opfPath = parseXml(container).getElementsByTagNameNS("*", "rootfile")[0]?.getAttribute("full-path");
  const opf = parseXml(await read(opfPath));
  const base = dirOf(opfPath);
  const title = clean(byTag(opf, "title")[0]?.textContent || (file.name || "Untitled book").replace(/\.epub$/i, ""));
  const author = clean(byTag(opf, "creator")[0]?.textContent || "");

  const items = {};
  const typeByPath = {};
  for (const it of byTag(opf, "item")) {
    const href = resolvePath(base, it.getAttribute("href"));
    items[it.getAttribute("id")] = { href, type: it.getAttribute("media-type") || "", props: it.getAttribute("properties") || "" };
    typeByPath[href] = it.getAttribute("media-type") || "";
  }
  const spineEl = byTag(opf, "spine")[0];
  const spine = byTag(opf, "itemref").map((r) => items[r.getAttribute("idref")]).filter(Boolean);

  // Table of contents (EPUB3 nav, else EPUB2 ncx)
  let toc = [];
  const nav = Object.values(items).find((i) => i.props.split(/\s+/).includes("nav"));
  if (nav) {
    const doc = parseHtml(await read(nav.href));
    const navs = byTag(doc, "nav");
    const tocNav = navs.find((n) => (n.getAttribute("epub:type") || "").includes("toc")) || navs[0];
    const list = tocNav && (kids(tocNav, "ol")[0] || kids(tocNav, "ul")[0]);
    if (list) navRows(list, 0, dirOf(nav.href), toc);
  }
  if (!toc.length) {
    const ncx = items[spineEl?.getAttribute("toc")] || Object.values(items).find((i) => i.type.includes("dtbncx"));
    const navMap = ncx && byTag(parseXml(await read(ncx.href)), "navMap")[0];
    if (navMap) ncxRows(navMap, 0, dirOf(ncx.href), toc);
  }
  const tocTitle = {};
  for (const r of toc) if (r.p && !tocTitle[r.p]) tocTitle[r.p] = r.t;

  const chapters = [];
  const images = [];
  const imageIndex = {};
  let pending = []; // pictures from picture-only pages, carried into the next chapter
  for (let i = 0; i < spine.length; i++) {
    const item = spine[i];
    if (!/html|xml/.test(item.type)) continue;
    const html = await read(item.href);
    if (!html) continue;
    const doc = parseHtml(html);
    const body = doc.getElementsByTagName("body")[0] || doc.documentElement;
    const chunks = [];
    walk(body, chunks, dirOf(item.href));
    const isCover = /cover/i.test(item.href) || (body.getAttribute("epub:type") || "").includes("cover");
    const hasText = chunks.some((c) => c[0] === TEXT || c[0] === HEAD);
    if (!hasText) {
      if (!isCover) pending.push(...chunks.filter((c) => c[0] === IMAGE));
      continue;
    }
    const b = [], s = [];
    for (const c of [...pending, ...chunks]) {
      if (c[0] === IMAGE) {
        const key = c[1].src;
        if (imageIndex[key] == null) {
          const f = entry(key);
          if (!f) continue;
          const type = imageType(key, typeByPath[key]);
          if (!type) continue; // not a plain picture (e.g. SVG/HTML): never turn it into a page-origin blob
          const blob = new Blob([await f.async("arraybuffer")], { type });
          imageIndex[key] = images.push({ ch: chapters.length, s: s.length, alt: c[1].alt, cap: c[1].cap || "", blob }) - 1;
        }
        b.push([IMAGE, imageIndex[key]]);
      } else if (c[0] === BREAK) {
        if (b.length && b[b.length - 1][0] !== BREAK) b.push([BREAK, 0]);
      } else {
        const parts = splitSentences(c[1]);
        if (!parts.length) continue;
        b.push([c[0], parts.length]);
        s.push(...parts);
      }
    }
    pending = [];
    const firstHeading = chunks.find((c) => c[0] === HEAD)?.[1];
    chapters.push({ t: tocTitle[item.href] || firstHeading || `Section ${chapters.length + 1}`, p: item.href, b, s });
    if (i % 10 === 0) { onProgress(i + 1, spine.length); await new Promise((r) => setTimeout(r)); }
  }
  if (!chapters.length) throw new Error("No readable text found. The book may be DRM-protected or image-only.");
  return { v: BOOK_VERSION, id: `${title}|${author}`, title, author, chapters, images, toc: buildRows(toc, chapters) };
}

// Merge the table of contents with the chapters actually kept, so every chapter has exactly one row.
function buildRows(toc, chapters) {
  const byPath = {};
  chapters.forEach((c, i) => { if (byPath[c.p] == null) byPath[c.p] = i; });
  const used = new Set();
  let rows = toc.map((r) => {
    let ch = r.p != null ? byPath[r.p] : undefined;
    if (ch == null || used.has(ch)) ch = null; else used.add(ch);
    return { t: r.t, d: r.d, g: r.g, ch };
  }).filter((r) => r.g || r.ch != null);
  // Chapters the TOC never mentions (title pages etc.) slot in by reading order.
  chapters.forEach((c, i) => {
    if (used.has(i)) return;
    let at = rows.findIndex((r) => r.ch != null && r.ch > i);
    if (at < 0) at = rows.length;
    rows.splice(at, 0, { t: c.t, d: at < rows.length ? rows[at].d : 0, g: false, ch: i });
  });
  // Ancestors (indexes of group rows) for collapsing.
  const stack = [];
  rows.forEach((r, i) => {
    while (stack.length && rows[stack[stack.length - 1]].d >= r.d) stack.pop();
    r.anc = [...stack];
    if (r.g) stack.push(i);
  });
  return rows;
}

// ---------- Rendering ----------
let book = null;
let sentEls = [];
let rowEls = [];
let imageUrls = [];
const collapsed = new Set();
const rowOfChapter = (ch) => book.toc.findIndex((r) => r.ch === ch);

function renderChapterList() {
  const ul = $("chapters");
  ul.replaceChildren();
  collapsed.clear();
  const curRow = rowOfChapter(state.ch);
  book.toc.forEach((r, i) => { if (r.g && r.d > 0 && !book.toc[curRow]?.anc.includes(i) && i !== curRow) collapsed.add(i); });
  rowEls = book.toc.map((r, i) => {
    const li = document.createElement("li");
    li.style.setProperty("--d", r.d);
    if (r.g) {
      li.className = r.d === 0 ? "grp top" : "grp";
      const caret = node("span", "caret", "›");
      li.append(caret, node("span", "tt", r.t));
      li.onclick = () => { collapsed.has(i) ? collapsed.delete(i) : collapsed.add(i); updateRows(); };
    } else {
      li.append(node("span", "tt", r.t));
      li.onclick = () => { openChapter(r.ch, 0); closeDrawer(); };
    }
    ul.appendChild(li);
    return li;
  });
  updateRows();
}
// Show/hide rows for collapsed groups and the go-to filter.
function updateRows() {
  const q = $("goto").value.trim().toLowerCase();
  const text = q && !/^\d+$/.test(q) ? q : "";
  const keep = new Set();
  if (text) book.toc.forEach((r, i) => { if (!r.g && r.t.toLowerCase().includes(text)) { keep.add(i); r.anc.forEach((a) => keep.add(a)); } });
  book.toc.forEach((r, i) => {
    const li = rowEls[i];
    li.hidden = text ? !keep.has(i) : r.anc.some((a) => collapsed.has(a));
    if (r.g) li.classList.toggle("open", text ? true : !collapsed.has(i));
  });
}
function markCurrentRow() {
  const cur = rowOfChapter(state.ch);
  const anc = book.toc[cur]?.anc || [];
  let opened = false;
  for (const a of anc) if (collapsed.delete(a)) opened = true;
  if (opened) updateRows();
  book.toc.forEach((r, i) => {
    rowEls[i].classList.toggle("cur", i === cur);
    rowEls[i].classList.toggle("done", r.ch != null && r.ch < state.ch);
  });
  rowEls[cur]?.scrollIntoView({ block: "nearest" });
  // Meta line: where you are in the book's structure.
  const where = anc.map((a) => book.toc[a].t).pop();
  const pct = Math.round(((state.ch + 1) / book.chapters.length) * 100);
  $("bookMeta").textContent = where ? `${pct}% · ${where}` : `${pct}%`;
  $("progBar").style.width = `${pct}%`;
}

function renderChapter() {
  const ch = book.chapters[state.ch];
  const art = $("text");
  art.replaceChildren();
  let k = 0;
  for (const [kind, n] of ch.b) {
    if (kind === IMAGE) {
      const im = book.images[n];
      const fig = node("figure", "pic");
      const img = node("img");
      img.src = imageUrls[n];
      img.alt = im.alt;
      img.loading = "lazy";
      img.dataset.img = n;
      fig.append(img);
      if (im.cap) fig.append(node("figcaption", null, im.cap));
      art.appendChild(fig);
      continue;
    }
    if (kind === BREAK) { art.appendChild(node("div", "sep", "∗ ∗ ∗")); continue; }
    const el = document.createElement(kind === HEAD ? "h2" : "p");
    for (let j = 0; j < n; j++, k++) {
      const span = node("span", "s", ch.s[k]);
      span.dataset.i = k;
      el.append(span, " ");
    }
    art.appendChild(el);
  }
  sentEls = [...art.querySelectorAll(".s")];
  markCurrentRow();
  document.title = `${ch.t} · Tachivel`;
}

function renderGallery() {
  const grid = $("gallery");
  grid.replaceChildren();
  $("imgCount").textContent = book.images.length ? String(book.images.length) : "";
  $("tabImg").hidden = !book.images.length;
  book.images.forEach((im, i) => {
    const btn = node("button", "thumb");
    btn.type = "button";
    const img = node("img");
    img.src = imageUrls[i];
    img.alt = im.alt;
    img.loading = "lazy";
    btn.append(img, node("span", "thumb-ch", book.chapters[im.ch].t));
    btn.onclick = () => {
      openChapter(im.ch, Math.min(im.s, book.chapters[im.ch].s.length - 1));
      $("text").querySelector(`img[data-img="${i}"]`)?.scrollIntoView({ block: "start", behavior: "instant" });
      closeDrawer();
    };
    grid.appendChild(btn);
  });
}
function showTab(name) {
  const imgs = name === "images";
  $("tabCh").setAttribute("aria-selected", !imgs);
  $("tabImg").setAttribute("aria-selected", imgs);
  $("chPane").hidden = imgs;
  $("gallery").hidden = !imgs;
}

let litIndex = -1;
function highlight(scroll = true) {
  if (litIndex >= 0 && sentEls[litIndex]) {
    const old = sentEls[litIndex];
    old.classList.remove("on");
    old.textContent = book.chapters[state.ch].s[litIndex];
  }
  litIndex = state.s;
  const el = sentEls[state.s];
  if (!el) return;
  el.classList.add("on");
  $("pos").textContent = `${state.s + 1} / ${sentEls.length}`;
  if (scroll) keepInView(el);
}
function keepInView(el) {
  const main = $("main");
  const r = el.getBoundingClientRect(), m = main.getBoundingClientRect();
  if (r.top < m.top + m.height * 0.2 || r.bottom > m.top + m.height * 0.7) {
    // Glide while reading along; jump instantly when navigating.
    main.scrollTo({ top: main.scrollTop + r.top - m.top - m.height * 0.35, behavior: playing ? "smooth" : "instant" });
  }
}
function node(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
}
// Fill el with text, wrapping [a, b) in an element of the given tag/class.
function splitWrap(el, text, a, b, tag, cls) {
  el.replaceChildren(text.slice(0, a), node(tag, cls, text.slice(a, b)), text.slice(b));
}
function markWord(charIndex) {
  const el = sentEls[state.s];
  if (!el) return;
  const text = book.chapters[state.ch].s[state.s];
  const m = /\S+/.exec(text.slice(charIndex));
  if (!m) return;
  const a = charIndex + m.index;
  splitWrap(el, text, a, a + m[0].length, "span", "w");
}

// ---------- Navigation ----------
function openChapter(ch, s = 0, { speak = true, touch = true } = {}) {
  if (!book) return;
  ch = Math.max(0, Math.min(book.chapters.length - 1, ch));
  const changed = ch !== state.ch || !sentEls.length;
  state.ch = ch;
  if (changed) { litIndex = -1; renderChapter(); $("main").scrollTo({ top: 0, behavior: "instant" }); }
  goSentence(s, { speak, touch });
}
function goSentence(i, { speak = true, touch = true } = {}) {
  state.s = Math.max(0, Math.min(sentEls.length - 1, i));
  // Remember the place by chapter title and sentence text, not just numbers, so it survives a re-built EPUB.
  state.chKey = book.chapters[state.ch].t;
  state.sText = book.chapters[state.ch].s[state.s];
  highlight();
  if (touch) changed(); else saveState();
  if (playing && speak) speakCurrent();
}
function advance() {
  if (state.s + 1 < sentEls.length) goSentence(state.s + 1);
  else if (state.ch + 1 < book.chapters.length) openChapter(state.ch + 1, 0);
  else pause();
}

// ---------- Speech ----------
let playing = false;
let token = 0;
let failures = 0;
let voices = [];

// macOS ships these as joke/sound-effect voices; they should never be picked for a book.
const NOVELTY = /^(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Deranged|Good News|Hysterical|Jester|Organ|Pipe Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox|Fred|Junior|Ralph|Kathy|Princess|Grandma|Grandpa|Rocko|Shelley|Eddy|Flo|Reed|Sandy)\b/i;
// Natural-sounding English voices, best first, for when nothing is labelled Premium/Enhanced (e.g. Chrome).
const GOOD = ["Zoe", "Ava", "Evan", "Allison", "Susan", "Samantha", "Tom", "Nathan", "Noelle", "Daniel", "Karen", "Moira", "Serena", "Alex"];
function voiceRank(v) {
  const n = `${v.name} ${v.voiceURI}`.toLowerCase();
  const en = v.lang.startsWith("en");
  if (en && n.includes("premium")) return 0;
  if (en && n.includes("enhanced")) return 1;
  const g = GOOD.findIndex((name) => v.name.startsWith(name));
  if (en && g >= 0) return 2 + g / 100;
  if (en) return 3;
  return 4;
}
function loadVoices() {
  voices = speechSynthesis.getVoices()
    .filter((v) => v.lang.startsWith("en") && !NOVELTY.test(v.name))
    .sort((a, b) => voiceRank(a) - voiceRank(b) || a.name.localeCompare(b.name));
  const sel = $("voice");
  sel.replaceChildren();
  for (const v of voices) {
    const o = document.createElement("option");
    o.value = v.voiceURI;
    o.textContent = `${v.name} · ${v.lang}`;
    sel.appendChild(o);
  }
  if (!voices.length) { sel.append(node("option", null, "No voices found")); return; }
  if (!voices.some((v) => v.voiceURI === state.voice)) {
    state.voice = voices[0].voiceURI; // list is sorted best-first
  }
  sel.value = state.voice;
}
function speakCurrent() {
  const t = ++token;
  speechSynthesis.cancel();
  // Safari drops a speak() issued in the same tick as cancel(), so wait a beat.
  setTimeout(() => {
    if (t !== token || !playing) return;
    const u = new SpeechSynthesisUtterance(book.chapters[state.ch].s[state.s]);
    const v = voices.find((x) => x.voiceURI === state.voice);
    if (v) { u.voice = v; u.lang = v.lang; }
    u.rate = state.rate;
    u.onboundary = (e) => { if (t === token && (!e.name || e.name === "word")) markWord(e.charIndex); };
    u.onend = () => { if (t === token && playing) { failures = 0; advance(); } };
    u.onerror = (e) => {
      if (t !== token || e.error === "interrupted" || e.error === "canceled") return;
      // A broken voice would otherwise race through the book; give up after a few in a row.
      if (++failures >= 3) { pause(); failures = 0; return; }
      if (playing) advance();
    };
    speechSynthesis.speak(u);
  }, 40);
}
const ICON_PLAY = "M8 5v14l11-7z";
const ICON_PAUSE = "M7 5h4v14H7zM13 5h4v14h-4z";
const setPlayIcon = (d) => $("playBtn").querySelector("path").setAttribute("d", d);
function play() {
  if (!book) return;
  playing = true;
  document.body.classList.add("playing");
  setPlayIcon(ICON_PAUSE);
  $("playBtn").setAttribute("aria-label", "Pause");
  keepInView(sentEls[state.s]);
  speakCurrent();
}
function pause() {
  playing = false;
  token++;
  speechSynthesis.cancel();
  document.body.classList.remove("playing");
  setPlayIcon(ICON_PLAY);
  $("playBtn").setAttribute("aria-label", "Play");
  highlight(false); // clears the word marker
  schedulePush(true); // so another device can pick up right away
}
const toggle = () => (playing ? pause() : play());

// ---------- Settings ----------
function applySettings() {
  document.documentElement.dataset.theme = state.theme;
  $("themeBtn").textContent = THEMES.find((t) => t[0] === state.theme)?.[1] || "Ember";
  $("text").style.setProperty("--size", `${state.size}px`);
  $("rate").value = state.rate;
  $("rateOut").textContent = `${Number(state.rate).toFixed(2)}×`;
}

// ---------- Go to chapter ----------
function findChapterByNumber(n) {
  const re = new RegExp(`^(chapter|ch\\.?)\\s*${n}\\b`, "i");
  const i = book.chapters.findIndex((c) => re.test(c.t));
  return i >= 0 ? i : n - 1;
}
function filterChapters() {
  const q = $("goto").value.trim();
  rowEls.forEach((li) => li.classList.remove("hit"));
  updateRows();
  if (/^\d+$/.test(q)) {
    const r = rowOfChapter(findChapterByNumber(+q));
    if (r < 0) return;
    for (const a of book.toc[r].anc) collapsed.delete(a);
    updateRows();
    rowEls[r].classList.add("hit");
    rowEls[r].scrollIntoView({ block: "center" });
  }
}
function gotoSubmit() {
  const q = $("goto").value.trim();
  if (!q) return;
  let ch = -1;
  if (/^\d+$/.test(q)) ch = findChapterByNumber(+q);
  else ch = book.toc.find((r, i) => !r.g && !rowEls[i].hidden)?.ch ?? -1;
  if (ch >= 0 && ch < book.chapters.length) {
    $("goto").value = "";
    filterChapters();
    $("goto").blur();
    openChapter(ch, 0);
    closeDrawer();
  }
}

// ---------- Search ----------
let results = [], sel = 0, searchTimer;
function runSearch() {
  const q = $("q").value.trim().toLowerCase();
  const ul = $("results");
  ul.replaceChildren();
  results = [];
  if (q.length < 2) { $("qCount").textContent = "Type at least 2 letters."; return; }
  outer: for (let c = 0; c < book.chapters.length; c++) {
    const ss = book.chapters[c].s;
    for (let s = 0; s < ss.length; s++) {
      if (ss[s].toLowerCase().includes(q)) {
        results.push([c, s]);
        if (results.length >= 200) break outer;
      }
    }
  }
  $("qCount").textContent = results.length ? `${results.length >= 200 ? "200+" : results.length} matches` : "No matches.";
  for (const [c, s] of results) {
    const li = document.createElement("li");
    const text = book.chapters[c].s[s];
    const at = text.toLowerCase().indexOf(q);
    const rs = node("div", "rs");
    splitWrap(rs, text, at, at + q.length, "mark");
    li.append(node("div", "rc", book.chapters[c].t), rs);
    li.onclick = () => jumpTo(c, s);
    ul.appendChild(li);
  }
  sel = 0;
  markSel();
}
function markSel() {
  [...$("results").children].forEach((li, i) => li.classList.toggle("sel", i === sel));
  $("results").children[sel]?.scrollIntoView({ block: "nearest" });
}
function jumpTo(c, s) {
  $("search").close();
  openChapter(c, s);
}
function openSearch() {
  if (!book) return;
  $("search").showModal();
  $("q").select();
}

// ---------- Drawer (narrow screens) ----------
const closeDrawer = () => $("app").classList.remove("drawer");
function toggleChapters() {
  if (matchMedia("(max-width: 800px)").matches) $("app").classList.toggle("drawer");
  else { showTab("chapters"); $("goto").focus(); }
}

// ---------- Import ----------
function showLoading(text) {
  $("loading").hidden = false;
  $("loadingText").textContent = text;
  $("loadingBar").style.width = "0%";
}
const hideLoading = () => ($("loading").hidden = true);
// Parse an EPUB (a dropped file or a download from your library), save it on this device and show it.
async function openBook(file, { cloud: cloudId = null } = {}) {
  const parsed = await parseEpub(file, (i, n) => {
    $("loadingText").textContent = `Reading the book… ${i} / ${n}`;
    $("loadingBar").style.width = `${(i / n) * 100}%`;
  });
  parsed.cloud = cloudId;
  await dbPut("current", parsed);
  // Same book (by title) = a newer build: keep the place. A different book starts at the beginning.
  const same = (state.bookId || "").split("|")[0] === parsed.title;
  state.bookId = parsed.id;
  if (!same) { state.ch = 0; state.s = 0; state.chKey = null; state.sText = null; }
  saveState();
  showBook(parsed);
}
async function importFile(file) {
  if (!file) return;
  pause();
  showLoading("Reading the book…");
  try {
    await openBook(file);
  } catch (err) {
    $("loadingText").textContent = err.message || String(err);
    await new Promise((r) => setTimeout(r, 3500));
    return;
  } finally {
    hideLoading();
  }
  if (cloud === "in") uploadBook(file);
}
function showBook(b) {
  book = b;
  $("bookTitle").textContent = b.title;
  $("bookAuthor").textContent = b.author;
  $("empty").hidden = true;
  $("text").hidden = false;
  $("goto").disabled = false;
  imageUrls.forEach((u) => URL.revokeObjectURL(u));
  imageUrls = (b.images || []).map((im) => URL.createObjectURL(im.blob));
  const place = findPlace(b);
  state.ch = place.ch;
  state.s = place.s;
  renderChapterList();
  renderGallery();
  showTab("chapters");
  sentEls = [];
  state.ch = -1; // force render
  openChapter(place.ch, place.s, { speak: false, touch: false });
}
// Find the saved place in this copy of the book, which may be a newer build with renamed or moved chapters:
// exact chapter title → the exact sentence anywhere in the book → same chapter number → same position.
function findPlace(b) {
  let ch = b.chapters.findIndex((c) => c.t === state.chKey);
  if (ch < 0 && state.sText && state.sText.length > 25) ch = b.chapters.findIndex((c) => c.s.includes(state.sText));
  if (ch < 0) {
    const n = /^(?:chapter|ch\.?)\s*(\d+)\b/i.exec(state.chKey || "")?.[1];
    if (n) ch = b.chapters.findIndex((c) => new RegExp(`^(?:chapter|ch\\.?)\\s*${n}\\b`, "i").test(c.t));
  }
  if (ch < 0) ch = Math.max(0, Math.min(state.ch, b.chapters.length - 1));
  const ss = b.chapters[ch].s;
  let s = Math.min(state.s, ss.length - 1);
  if (state.sText && ss[s] !== state.sText) {
    let best = -1;
    ss.forEach((x, i) => { if (x === state.sText && (best < 0 || Math.abs(i - state.s) < Math.abs(best - state.s))) best = i; });
    if (best >= 0) s = best;
  }
  return { ch, s: Math.max(0, s) };
}

// ---------- Cloud library: sign in once, and the book and your place follow you ----------
// cloud: "off" = no server (local copy) · "out" = signed out · "in" = signed in · "error" = server unreachable
const PART = 4 * 1024 * 1024; // upload size per request (a Netlify Function body caps at 6 MB)
let cloud = "off", pushTimer = null, lastPush = 0, syncing = false;

async function apiJSON(method, path, body) {
  const res = await fetch(path, {
    method, cache: "no-store", credentials: "same-origin",
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    keepalive: method === "PUT" && path === "/api/bookmark",
  });
  if (res.status === 401 && path !== "/api/login") setCloud("out");
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `The server said no (${res.status}).`);
  return res.json();
}
async function apiBinary(method, path, body) {
  const res = await fetch(path, { method, credentials: "same-origin", body, headers: body ? { "content-type": "application/octet-stream" } : {} });
  if (res.status === 401) setCloud("out");
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `The server said no (${res.status}).`);
  return method === "GET" ? res.arrayBuffer() : res.json();
}

async function checkCloud() {
  try {
    const res = await fetch("/api/me", { cache: "no-store", credentials: "same-origin" });
    setCloud(res.status === 200 ? "in" : res.status === 401 ? "out" : "off"); // 404 = local copy without the server
  } catch { setCloud("off"); }
  if (cloud === "in") syncNow();
}
// On opening, and whenever Tachivel comes back to the front: newer book first, then the newest place.
async function syncNow() {
  if (cloud !== "in" || syncing || playing) return;
  syncing = true;
  try { await fetchNewerBook(); await pull(); }
  catch { if (cloud === "in") setCloud("error"); }
  finally { syncing = false; }
}
async function fetchNewerBook() {
  const m = await apiJSON("GET", "/api/book");
  if (!m || m.upload === book?.cloud) return;
  const isUpdate = !!book;
  showLoading(isUpdate ? "Getting the newest chapters…" : "Getting your book…");
  try {
    const parts = [];
    for (let i = 0; i < m.parts; i++) {
      parts.push(await apiBinary("GET", `/api/book/parts/${m.upload}/${i}`));
      $("loadingBar").style.width = `${((i + 1) / m.parts) * 60}%`;
    }
    const before = book?.chapters.length || 0;
    await openBook(new Blob(parts, { type: "application/epub+zip" }), { cloud: m.upload, name: m.name });
    const added = book.chapters.length - before;
    if (isUpdate) toast(added > 0 ? `New build loaded: ${added} new section${added === 1 ? "" : "s"}.` : "New build of the book loaded.");
  } finally { hideLoading(); }
}
async function uploadBook(file) {
  const upload = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const parts = Math.ceil(file.size / PART);
  try {
    for (let i = 0; i < parts; i++) {
      toast(`Saving to your library… ${i + 1} of ${parts}`, 60000);
      await apiBinary("PUT", `/api/book/parts/${upload}/${i}`, file.slice(i * PART, (i + 1) * PART));
    }
    await apiJSON("PUT", "/api/book", { upload, parts, size: file.size, name: file.name, title: book.title });
    book.cloud = upload;
    await dbPut("current", book);
    toast("Saved to your library. Your other devices get it next time they open Tachivel.");
  } catch (err) {
    toast(`Couldn't save the book to your library: ${err.message}`);
  }
}

// ---------- Bookmark sync ----------
// Something you did (moved, changed a setting): it becomes the newest bookmark.
function changed() {
  state.at = Date.now();
  saveState();
  schedulePush();
}
function bookmark() {
  return {
    at: state.at, book: book?.title || (state.bookId || "").split("|")[0],
    chKey: state.chKey, sText: state.sText, ch: Math.max(0, state.ch), s: state.s,
    rate: state.rate, voice: state.voice, theme: state.theme, size: state.size,
  };
}
// While reading, send at most every 15 s; on pause or leaving, send now.
function schedulePush(now = false) {
  if (cloud !== "in" || !state.at || !bookmark().book) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(push, now ? 0 : Math.max(0, 15000 - (Date.now() - lastPush)));
}
async function push() {
  lastPush = Date.now();
  try { await apiJSON("PUT", "/api/bookmark", bookmark()); if (cloud === "error") setCloud("in"); }
  catch { if (cloud === "in") setCloud("error"); }
}
async function pull() {
  if (cloud !== "in" || playing) return;
  const remote = await apiJSON("GET", "/api/bookmark");
  if (remote && remote.at > (state.at || 0)) applyRemote(remote);
  else if (state.at && (!remote || state.at > remote.at)) schedulePush(true); // this device is ahead
}
function applyRemote(r) {
  state.at = r.at;
  state.chKey = r.chKey; state.sText = r.sText;
  if (r.ch != null) state.ch = r.ch;
  if (r.s != null) state.s = r.s;
  if (r.rate) state.rate = r.rate;
  if (r.theme) state.theme = r.theme;
  if (r.size) state.size = r.size;
  if (r.voice && voices.some((v) => v.voiceURI === r.voice)) { state.voice = r.voice; $("voice").value = r.voice; }
  applySettings();
  if (!book || book.title !== r.book) { state.bookId = `${r.book}|`; saveState(); return; }
  saveState();
  const place = findPlace(book);
  state.ch = -1;
  openChapter(place.ch, place.s, { speak: false, touch: false });
  toast(`Picked up from your other device: ${book.chapters[place.ch].t}`);
}

// ---------- Sign-in UI ----------
function setCloud(c) {
  cloud = c;
  const btn = $("accountBtn");
  btn.hidden = c === "off";
  btn.textContent = c === "in" ? "Library: synced" : c === "error" ? "Library: can't reach server" : "Sign in";
  btn.classList.toggle("bad", c === "error");
  // Signed out with no book here (a new phone or iPad): signing in is the main action.
  const signInFirst = c === "out";
  $("emptySignIn").hidden = !signInFirst;
  $("pickBtn").className = signInFirst ? "link" : "btn";
  $("pickBtn").textContent = signInFirst ? "Or open an EPUB from this device" : "Choose a file";
  if (!$("emptyMsg").dataset.custom) {
    $("emptyTitle").textContent = signInFirst ? "Your library" : "Drop an EPUB here";
    $("emptyMsg").textContent = signInFirst ? "Sign in to get your book and pick up where you left off."
      : c === "in" ? "Your library is empty. Drop the EPUB here once, or run tachivel push on your Mac."
      : "It's read on this device and stays on it.";
  }
  $("signedOutPane").hidden = c === "in" || c === "error";
  $("signedInPane").hidden = !(c === "in" || c === "error");
}
function openAccount() { $("loginError").textContent = ""; $("accountDlg").showModal(); if (cloud === "out") $("passphrase").focus(); }
async function signIn(e) {
  e.preventDefault();
  const pass = $("passphrase").value;
  if (!pass) return;
  $("loginError").textContent = "";
  $("loginBtn").disabled = true;
  try {
    await apiJSON("POST", "/api/login", { passphrase: pass });
    $("passphrase").value = "";
    setCloud("in");
    $("accountDlg").close();
    await syncNow();
  } catch (err) {
    $("loginError").textContent = err.message;
  } finally { $("loginBtn").disabled = false; }
}
async function signOut() {
  try { await apiJSON("POST", "/api/logout"); } catch {}
  setCloud("out");
  $("accountDlg").close();
}
let toastTimer;
function toast(msg, ms = 4000) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
}

// ---------- Wiring ----------
function wire() {
  $("playBtn").onclick = toggle;
  $("prevS").onclick = () => book && goSentence(state.s - 1);
  $("nextS").onclick = () => book && goSentence(state.s + 1);
  $("prevCh").onclick = () => book && openChapter(state.ch - 1, 0);
  $("nextCh").onclick = () => book && openChapter(state.ch + 1, 0);
  $("menuBtn").onclick = toggleChapters;
  $("searchBtn").onclick = openSearch;
  $("text").onclick = (e) => {
    const s = e.target.closest(".s");
    if (s) goSentence(+s.dataset.i);
  };
  $("voice").onchange = (e) => { state.voice = e.target.value; changed(); if (playing) speakCurrent(); };
  $("rate").oninput = (e) => { state.rate = +e.target.value; applySettings(); changed(); };
  const nudgeRate = (d) => {
    state.rate = Math.round(Math.min(2.5, Math.max(0.6, state.rate + d)) * 20) / 20;
    applySettings(); changed();
    if (playing) speakCurrent();
  };
  $("rateDown").onclick = () => nudgeRate(-0.05);
  $("rateUp").onclick = () => nudgeRate(0.05);
  $("rate").onchange = () => { if (playing) speakCurrent(); };
  $("sizeDown").onclick = () => { state.size = Math.max(14, state.size - 1); applySettings(); changed(); };
  $("sizeUp").onclick = () => { state.size = Math.min(32, state.size + 1); applySettings(); changed(); };
  $("themeBtn").onclick = () => {
    const i = THEMES.findIndex((t) => t[0] === state.theme);
    state.theme = THEMES[(i + 1) % THEMES.length][0];
    applySettings(); changed();
  };

  $("goto").oninput = filterChapters;
  $("tabCh").onclick = () => showTab("chapters");
  $("tabImg").onclick = () => showTab("images");
  $("goto").onkeydown = (e) => {
    if (e.key === "Enter") { e.preventDefault(); gotoSubmit(); }
    if (e.key === "Escape") { $("goto").value = ""; filterChapters(); $("goto").blur(); }
  };

  $("q").oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 150); };
  $("q").onkeydown = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(results.length - 1, sel + 1); markSel(); }
    if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(0, sel - 1); markSel(); }
    if (e.key === "Enter" && results[sel]) { e.preventDefault(); jumpTo(...results[sel]); }
  };

  const pick = () => $("file").click();
  $("pickBtn").onclick = pick;
  $("openBtn").onclick = pick;
  $("file").onchange = (e) => { importFile(e.target.files[0]); e.target.value = ""; };
  const drop = $("drop");
  addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  addEventListener("dragleave", (e) => { if (!e.relatedTarget) drop.classList.remove("over"); });
  addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); importFile(e.dataTransfer.files[0]); });

  addEventListener("keydown", (e) => {
    const typing = e.target.closest("input, select, textarea") || $("search").open;
    if (typing || e.metaKey || e.ctrlKey || e.altKey || !book) return;
    const k = e.key;
    if (k === " ") { e.preventDefault(); toggle(); }
    else if (k === "ArrowRight") { e.preventDefault(); goSentence(state.s + 1); }
    else if (k === "ArrowLeft") { e.preventDefault(); goSentence(state.s - 1); }
    else if (k === "ArrowDown" && e.shiftKey) { e.preventDefault(); openChapter(state.ch + 1, 0); }
    else if (k === "ArrowUp" && e.shiftKey) { e.preventDefault(); openChapter(state.ch - 1, 0); }
    else if (k === "c" || k === "C") { e.preventDefault(); toggleChapters(); }
    else if (k === "g" || k === "G") { e.preventDefault(); closeDrawer(); if (matchMedia("(max-width: 800px)").matches) $("app").classList.add("drawer"); showTab("chapters"); $("goto").focus(); }
    else if (k === "/") { e.preventDefault(); openSearch(); }
    else if (k === "[" || k === "-") { e.preventDefault(); $("rateDown").click(); }
    else if (k === "]" || k === "=" || k === "+") { e.preventDefault(); $("rateUp").click(); }
  });

  $("accountBtn").onclick = openAccount;
  $("emptySignIn").onclick = openAccount;
  $("loginForm").onsubmit = signIn;
  $("signOutBtn").onclick = signOut;
  // Check for a newer book and place whenever Tachivel comes back to the front.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") syncNow();
    else schedulePush(true);
  });
  addEventListener("focus", () => syncNow());

  // Chrome stops speech silently in background tabs after ~15s of one utterance; per-sentence queueing avoids most of it.
  addEventListener("pagehide", () => speechSynthesis.cancel());
}

async function boot() {
  applySettings();
  wire();
  if ("speechSynthesis" in window) {
    loadVoices();
    speechSynthesis.onvoiceschanged = loadVoices;
  }
  try {
    const saved = await dbGet("current");
    if (saved?.v === BOOK_VERSION) showBook(saved);
    else if (saved) $("emptyMsg").dataset.custom = "1", $("emptyMsg").textContent = "Tachivel was updated to show pictures and arcs. Drop the book in once more; your place is kept.";
  } catch {}
  checkCloud();
}
boot();
