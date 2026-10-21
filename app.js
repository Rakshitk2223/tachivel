// Tachivel — local EPUB listen-along reader.
// Book model: { v, id, title, author, chapters: [{ t, p, b: [[kind, n]...], s: [sentence...] }], images: [{ ch, s, alt, cap, ng, blob }], codex: [{ kind, name, form, text: [para...], img, ch, s }], toc: [{ t, d, g, ch, anc }] }
"use strict";

const $ = (id) => document.getElementById(id);
const STORE_KEY = "tachivel:state";

// ---------- Persistence ----------
// width, panel, view and mode are this device's own; they never sync to other devices.
const state = Object.assign(
  { bookId: null, ch: 0, s: 0, voice: null, rate: 1, theme: "ember", size: 20, width: "standard", panel: true, view: "read", mode: "novel" },
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
const BOOK_VERSION = 4;
// Block kinds inside a chapter: [kind, n]
const TEXT = 0, HEAD = 1, IMAGE = 2, BREAK = 3; // TEXT/HEAD: n sentences · IMAGE: n = image index · BREAK: scene divider
const CODEX = 4; // parse-time only: a World entry, kept in book.codex and never in a chapter's blocks
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
const hasClass = (el, c) => (el.getAttribute("class") || "").split(/\s+/).includes(c);
// Pictures inside class="no-gallery" (front matter, character sheets) show while reading but stay out of the Images tab.
const noGallery = (el) => hasClass(el, "no-gallery");
// A class="codex" block is a World entry (character, place or map): it leaves the text and is never read out.
// It unlocks where it sits in the book, or at data-from="Chapter 12". Pandoc writes {kind="map"} as data-kind.
const KINDS = ["character", "place", "map"];
const attr = (el, k) => el.getAttribute(k) ?? el.getAttribute(`data-${k}`);
function codexEntry(el, base) {
  const all = [...el.getElementsByTagName("*")];
  const img = all.find((d) => /^(img|image)$/i.test(d.localName));
  const src = img && (img.getAttribute("src") || img.getAttribute("href") || img.getAttributeNS("http://www.w3.org/1999/xlink", "href"));
  const head = all.find((d) => HEADING.has(d.localName.toLowerCase()));
  const kind = (attr(el, "kind") || KINDS.find((k) => hasClass(el, k)) || "").toLowerCase();
  return {
    kind: KINDS.includes(kind) ? kind : "character",
    name: clean(attr(el, "name") || head?.textContent || img?.getAttribute("alt") || ""),
    form: clean(attr(el, "form") || ""),
    from: clean(attr(el, "from") || ""),
    src: src ? resolvePath(base, src) : null,
    alt: clean(img?.getAttribute("alt") || ""),
    text: all.filter((d) => d.localName.toLowerCase() === "p").map((p) => clean(p.textContent)).filter(Boolean),
  };
}
// Collect a chapter's content in reading order: [TEXT|HEAD, text] | [IMAGE, {src, alt, ng}] | [BREAK]
function walk(el, out, base, ng = false) {
  ng = ng || noGallery(el);
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
    if (hasClass(n, "codex")) { flush(); out.push([CODEX, codexEntry(n, base)]); continue; }
    if (tag === "br") { flush(); continue; }
    if (tag === "hr") { flush(); out.push([BREAK]); continue; }
    if (tag === "img" || tag === "image") {
      const src = n.getAttribute("src") || n.getAttribute("href") || n.getAttributeNS("http://www.w3.org/1999/xlink", "href");
      flush();
      if (src) out.push([IMAGE, { src: resolvePath(base, src), alt: clean(n.getAttribute("alt") || ""), ng: ng || noGallery(n) }]);
      continue;
    }
    if (tag === "figcaption") {
      flush();
      const t = clean(n.textContent);
      const last = out[out.length - 1];
      // A caption that only repeats the picture's alt text is shown under the picture, not read twice.
      if (last?.[0] === IMAGE && (n.getAttribute("aria-hidden") === "true" || t === last[1].alt)) last[1].cap = t;
      else if (t) walk(n, out, base, ng);
      continue;
    }
    if (HEADING.has(tag)) { flush(); const t = clean(n.textContent); if (t) out.push([HEAD, t]); continue; }
    if (BLOCK.has(tag) || containsBlock(n)) { flush(); walk(n, out, base, ng); }
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

// Open the zip and its package file (OPF): metadata, the manifest of files, and the reading order.
async function openPackage(file) {
  const zip = await JSZip.loadAsync(file);
  const entry = (p) => zip.file(p) || zip.file(decodeURIComponent(p));
  const read = async (p) => { const f = entry(p); return f ? f.async("string") : null; };
  const container = await read("META-INF/container.xml");
  if (!container) throw new Error("This file isn't an EPUB (no META-INF/container.xml).");
  const opfPath = parseXml(container).getElementsByTagNameNS("*", "rootfile")[0]?.getAttribute("full-path");
  const opf = parseXml(await read(opfPath));
  const base = dirOf(opfPath);
  const items = {};
  const typeByPath = {};
  for (const it of byTag(opf, "item")) {
    const href = resolvePath(base, it.getAttribute("href"));
    items[it.getAttribute("id")] = { href, type: it.getAttribute("media-type") || "", props: it.getAttribute("properties") || "" };
    typeByPath[href] = it.getAttribute("media-type") || "";
  }
  return { entry, read, opf, base, items, typeByPath };
}
// The cover picture: EPUB3 marks it "cover-image"; EPUB2 points at it from <meta name="cover">.
async function coverOf({ entry, opf, items }) {
  const id = byTag(opf, "meta").find((m) => m.getAttribute("name") === "cover")?.getAttribute("content");
  const it = Object.values(items).find((i) => i.props.split(/\s+/).includes("cover-image")) || items[id];
  const f = it && entry(it.href);
  const type = it && imageType(it.href, it.type);
  return f && type ? new Blob([await f.async("arraybuffer")], { type }) : null;
}

async function parseEpub(file, onProgress) {
  const pkg = await openPackage(file);
  const { entry, read, opf, items, typeByPath } = pkg;
  const title = clean(byTag(opf, "title")[0]?.textContent || (file.name || "Untitled book").replace(/\.epub$/i, ""));
  const author = clean(byTag(opf, "creator")[0]?.textContent || "");

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
  const codex = [];
  let pending = []; // pictures and World entries from pages with nothing to read, carried into the next chapter
  // One stored copy per picture file; null when it's missing or not a plain picture (e.g. SVG/HTML), which must never become a page-origin blob.
  async function addImage(key, at, alt, cap, ng) {
    if (imageIndex[key] == null) {
      const f = entry(key);
      const type = f && imageType(key, typeByPath[key]);
      if (!type) return null;
      const blob = new Blob([await f.async("arraybuffer")], { type });
      imageIndex[key] = images.push({ ...at, alt, cap, ng, blob }) - 1;
    }
    return imageIndex[key];
  }
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
      if (!isCover) pending.push(...chunks.filter((c) => c[0] === IMAGE || c[0] === CODEX));
      continue;
    }
    const b = [], s = [];
    for (const c of [...pending, ...chunks]) {
      const at = { ch: chapters.length, s: s.length };
      if (c[0] === IMAGE) {
        const n = await addImage(c[1].src, at, c[1].alt, c[1].cap || "", !!c[1].ng);
        if (n != null) b.push([IMAGE, n]);
      } else if (c[0] === CODEX) {
        const { src, alt, ...e } = c[1];
        const img = src ? await addImage(src, at, alt || e.name, "", true) : null;
        codex.push({ ...e, img, ...at });
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
  // World entries on pages after the last chapter unlock at the very end.
  const last = chapters[chapters.length - 1];
  for (const c of pending) {
    if (c[0] !== CODEX) continue;
    const { src, alt, ...e } = c[1], at = { ch: chapters.length - 1, s: last.s.length - 1 };
    codex.push({ ...e, img: src ? await addImage(src, at, alt || e.name, "", true) : null, ...at });
  }
  // data-from moves an entry's unlock point to the start of that chapter ("Chapter 12", "12", or an exact title).
  for (const e of codex) {
    if (!e.from) continue;
    const n = /^(?:(?:chapter|ch\.?)\s*)?(\d+)$/i.exec(e.from)?.[1];
    const i = n ? chapters.findIndex((c) => new RegExp(`^(?:chapter|ch\\.?)\\s*${n}\\b`, "i").test(c.t)) : chapters.findIndex((c) => c.t === e.from);
    if (i >= 0) Object.assign(e, { ch: i, s: 0 });
  }
  codex.sort((a, b) => a.ch - b.ch || a.s - b.s);
  const cover = await coverOf(pkg).catch(() => null);
  return { v: BOOK_VERSION, id: `${title}|${author}`, title, author, cover, chapters, images, codex, toc: buildRows(toc, chapters) };
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

// Each arc/book row's last chapter: once you're past it, the whole group is done.
let groupLast = [];
function renderChapterList() {
  const ul = $("chapters");
  ul.replaceChildren();
  collapsed.clear();
  groupLast = [];
  for (const r of book.toc) if (r.ch != null) for (const a of r.anc) groupLast[a] = Math.max(groupLast[a] ?? -1, r.ch);
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
      li.onclick = () => jump(r.ch, 0);
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
    rowEls[i].classList.toggle("done", r.g ? groupLast[i] < state.ch : r.ch != null && r.ch < state.ch);
  });
  rowEls[cur]?.scrollIntoView({ block: "nearest" });
}

// ---------- Progress: by words, so a long chapter counts for more than a short one ----------
const WPM = 170; // roughly what a macOS voice reads per minute at 1×
let chStart = [], totalWords = 1;
const wordCount = (t) => t.split(/\s+/).filter(Boolean).length;
function countWords(b) {
  let n = 0;
  chStart = b.chapters.map((c) => { const at = n; n += c.s.reduce((k, x) => k + wordCount(x), 0); return at; });
  totalWords = Math.max(1, n);
}
function progress() {
  const ss = book.chapters[state.ch].s;
  let read = chStart[state.ch] || 0;
  for (let i = 0; i < Math.min(state.s, ss.length); i++) read += wordCount(ss[i]);
  const mins = (totalWords - read) / (WPM * state.rate);
  const left = mins < 60 ? `about ${Math.max(1, Math.round(mins))} min left` : `about ${Math.round(mins / 60)} h left`;
  return { pct: Math.min(100, Math.round((read / totalWords) * 100)), left };
}
function updateProgress() {
  if (!book || !book.chapters[state.ch]) return;
  const { pct, left } = progress();
  const ch = book.chapters[state.ch];
  $("progBar").style.width = `${pct}%`;
  $("bookMeta").textContent = `${pct}% read, ${left}`;
  $("nowTitle").textContent = ch.t;
  $("pos").textContent = `Sentence ${state.s + 1} of ${ch.s.length}, ${pct}% of the book`;
  noteFarthest();
  far = farthest();
  renderGallery(false);
  renderWorld(false);
  if (state.view === "library") renderLibrary();
}

function renderChapter() {
  const ch = book.chapters[shownCh];
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

// The Images tab holds no spoilers: only pictures you've already read past, and none marked no-gallery.
// Pictures are stored in reading order, so the ones reached are always a prefix and a count says what's shown.
let galleryShown = -1;
// "Reached" means the furthest you've read, not where you are now: jumping back to an early picture hides nothing.
// Kept per book by chapter title, so a new build with extra front matter still lines up.
function farthest() {
  const f = state.far?.book === book.title ? state.far : null;
  let ch = f ? book.chapters.findIndex((c) => c.t === f.chKey) : -1;
  if (f && ch < 0) ch = Math.min(f.ch, book.chapters.length - 1);
  const here = { ch: state.ch, s: state.s };
  return ch < 0 || ch < here.ch || (ch === here.ch && f.s < here.s) ? here : { ch, s: f.s };
}
function noteFarthest() {
  const f = farthest();
  if (f.ch === state.ch && f.s === state.s) state.far = { book: book.title, chKey: book.chapters[f.ch].t, ch: f.ch, s: f.s };
}
let far = { ch: 0, s: 0 };
const reached = (im) => im.ch < far.ch || (im.ch === far.ch && im.s <= far.s);
function renderGallery(force = true) {
  const shown = book.images.filter((im) => !im.ng && reached(im)).length;
  if (!force && shown === galleryShown) return;
  galleryShown = shown;
  const grid = $("gallery");
  grid.replaceChildren();
  $("imgCount").textContent = shown ? String(shown) : "";
  $("tabImg").hidden = !book.images.some((im) => !im.ng);
  if (!shown) grid.append(node("p", "gallery-empty", "Pictures show up here once you've read past them."));
  book.images.forEach((im, i) => {
    if (im.ng || !reached(im)) return;
    const btn = node("button", "thumb");
    btn.type = "button";
    const img = node("img");
    img.src = imageUrls[i];
    img.alt = im.alt;
    img.loading = "lazy";
    btn.append(img, node("span", "thumb-ch", book.chapters[im.ch].t));
    btn.onclick = () => jump(im.ch, Math.min(im.s, book.chapters[im.ch].s.length - 1), `img[data-img="${i}"]`);
    grid.appendChild(btn);
  });
}
// The World tab: characters, places and maps, by the same rule. Looking things up never moves the voice.
// Entries sharing a name are one card; its forms (e.g. "Grey form") appear as you reach them.
const KIND_LABEL = { character: "Characters", place: "Places", map: "Maps" };
const KIND_EMPTY = { character: "characters", place: "places", map: "maps" };
let worldSeen = null, worldKind = null, worldOpen = null, worldForm = -1;
function worldGroups() {
  const groups = new Map();
  for (const e of book.codex || []) {
    if (!reached(e)) continue;
    const key = `${e.kind}|${e.name}`;
    if (!groups.has(key)) groups.set(key, { key, kind: e.kind, name: e.name, forms: [] });
    groups.get(key).forms.push(e);
  }
  return [...groups.values()];
}
function renderWorld(force = true) {
  const all = book.codex || [];
  $("tabWorld").hidden = !all.length;
  const open = all.filter(reached);
  const fresh = worldSeen ? open.filter((e) => !worldSeen.has(e)) : [];
  if (!force && !fresh.length && open.length === worldSeen?.size) return;
  // Met someone new in the last few sentences: say so. A big jump (or opening the book) stays quiet.
  if (!force && fresh.length && fresh.length <= 3) toast(`New in World: ${[...new Set(fresh.map((e) => (e.form ? `${e.name} (${e.form})` : e.name)))].join(", ")}`);
  worldSeen = new Set(open);
  const groups = worldGroups();
  $("worldCount").textContent = groups.length ? String(groups.length) : "";
  const kinds = KINDS.filter((k) => groups.some((g) => g.kind === k));
  if (!kinds.includes(worldKind)) worldKind = kinds[0] || "character";
  const bar = $("worldKinds");
  bar.replaceChildren();
  bar.hidden = kinds.length < 2;
  for (const k of kinds) {
    const b = node("button", null, KIND_LABEL[k]);
    b.type = "button";
    b.setAttribute("aria-pressed", k === worldKind);
    b.onclick = () => { worldKind = k; worldOpen = null; renderWorld(); };
    bar.append(b);
  }
  const list = $("worldList");
  list.replaceChildren();
  list.className = `wl ${worldKind}`;
  const shown = groups.filter((g) => g.kind === worldKind);
  if (!shown.length) list.append(node("li", "gallery-empty", "Characters, places and maps show up here as the story reaches them."));
  for (const g of shown) {
    const e = g.forms[g.forms.length - 1];
    const li = node("li");
    const b = node("button");
    b.type = "button";
    b.append(entryPicture(e, g.name));
    const words = node("span", "wt");
    words.append(node("span", "nm", g.name));
    const sub = [g.forms.length > 1 ? `${g.forms.length} forms` : e.form, e.text[0]].filter(Boolean).join(". ");
    if (sub && worldKind !== "map") words.append(node("span", "sub", sub));
    b.append(words);
    b.onclick = () => { worldOpen = g.key; worldForm = -1; renderWorldDetail(); };
    li.append(b);
    list.append(li);
  }
  renderWorldDetail();
}
function entryPicture(e, name) {
  if (e.img == null) return node("span", "ph", name.slice(0, 1));
  const img = node("img");
  img.src = imageUrls[e.img];
  img.alt = "";
  img.loading = "lazy";
  return img;
}
function renderWorldDetail() {
  const g = worldOpen && worldGroups().find((x) => x.key === worldOpen);
  const box = $("worldDetail");
  box.hidden = !g;
  $("worldList").hidden = !!g;
  if (!g) { $("worldKinds").hidden = $("worldKinds").childElementCount < 2; return; }
  $("worldKinds").hidden = true;
  const e = g.forms[worldForm < 0 ? g.forms.length - 1 : worldForm];
  box.replaceChildren();
  const back = node("button", "back");
  back.type = "button";
  back.append(svgIcon("M15.4 7.4 14 6l-6 6 6 6 1.4-1.4L10.8 12z"), node("span", null, `All ${KIND_EMPTY[g.kind]}`));
  back.onclick = () => { worldOpen = null; renderWorldDetail(); };
  box.append(back);
  if (e.img != null) {
    const img = node("img", "pic");
    img.src = imageUrls[e.img];
    img.alt = e.form ? `${g.name}, ${e.form}` : g.name;
    img.onclick = () => openViewer(imageUrls[e.img], img.alt);
    box.append(img);
  }
  box.append(node("h3", null, g.name));
  if (g.forms.length > 1) {
    const forms = node("div", "kinds");
    g.forms.forEach((f, i) => {
      const b = node("button", null, f.form || `Form ${i + 1}`);
      b.type = "button";
      b.setAttribute("aria-pressed", f === e);
      b.onclick = () => { worldForm = i; renderWorldDetail(); };
      forms.append(b);
    });
    box.append(forms);
  } else if (e.form) box.append(node("p", "form", e.form));
  for (const t of e.text) box.append(node("p", null, t));
  const first = g.forms[0];
  const seen = node("button", "link seen", `First seen in ${book.chapters[first.ch].t}`);
  seen.type = "button";
  seen.onclick = () => jump(first.ch, Math.min(first.s, book.chapters[first.ch].s.length - 1));
  box.append(seen);
}
function openViewer(src, alt) {
  $("viewerImg").src = src;
  $("viewerImg").alt = alt;
  $("viewerCap").textContent = alt;
  $("viewer").showModal();
}

let tab = "chapters";
const TABS = { chapters: ["tabCh", "chPane"], images: ["tabImg", "gallery"], world: ["tabWorld", "world"] };
function showTab(name) {
  tab = name;
  for (const [t, [btn, pane]] of Object.entries(TABS)) {
    $(btn).setAttribute("aria-selected", t === name);
    $(pane).hidden = t !== name;
  }
  applyLayout();
}

let litIndex = -1;
function highlight(scroll = true) {
  updateProgress();
  updatePill();
  if (shownCh !== state.ch) return; // reading elsewhere while the voice carries on: nothing to light up
  if (litIndex >= 0 && sentEls[litIndex]) {
    const old = sentEls[litIndex];
    old.classList.remove("on");
    old.textContent = book.chapters[state.ch].s[litIndex];
  }
  litIndex = state.s;
  const el = sentEls[state.s];
  if (!el) return;
  el.classList.add("on");
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
  if (shownCh !== state.ch) return;
  const el = sentEls[state.s];
  if (!el) return;
  const text = book.chapters[state.ch].s[state.s];
  const m = /\S+/.exec(text.slice(charIndex));
  if (!m) return;
  const a = charIndex + m.index;
  splitWrap(el, text, a, a + m[0].length, "span", "w");
}

// ---------- Navigation ----------
// Two positions: the place (where the voice is, and the bookmark that syncs) and the chapter on screen.
// They move together while you follow along. Browsing while it reads leaves the place alone.
let shownCh = -1;
let returnTo = null; // paused jump: where you were, for the "Back to" pill
function showChapter(ch) {
  shownCh = ch;
  litIndex = -1;
  renderChapter();
  $("main").scrollTo({ top: 0, behavior: "instant" });
  if (ch === state.ch) highlight();
  updatePill();
}
// Move the place (and the page with it). Prev/next, a clicked sentence, the arrow keys.
function openChapter(ch, s = 0, { speak = true, touch = true } = {}) {
  if (!book) return;
  ch = Math.max(0, Math.min(book.chapters.length - 1, ch));
  state.ch = ch;
  // Set the sentence before drawing the page: the old chapter's sentence number means nothing in this one.
  state.s = Math.max(0, Math.min(book.chapters[ch].s.length - 1, s));
  if (ch !== shownCh || !sentEls.length) showChapter(ch);
  goSentence(state.s, { speak, touch });
}
function goSentence(i, { speak = true, touch = true } = {}) {
  state.s = Math.max(0, Math.min(book.chapters[state.ch].s.length - 1, i));
  // Remember the place by chapter title and sentence text, not just numbers, so it survives a re-built EPUB.
  state.chKey = book.chapters[state.ch].t;
  state.sText = book.chapters[state.ch].s[state.s];
  highlight();
  if (touch) changed(); else saveState();
  if (playing && speak) speakCurrent();
}
function advance() {
  if (state.s + 1 < book.chapters[state.ch].s.length) goSentence(state.s + 1);
  else if (state.ch + 1 >= book.chapters.length) pause();
  else if (shownCh === state.ch) openChapter(state.ch + 1, 0); // following along: turn the page
  else { state.ch++; goSentence(0); } // reading elsewhere: the voice moves on quietly
}
// A chapter, picture or search result picked from a list. While it reads: just look, the voice carries on.
// While paused: go there, and offer the way back.
function jump(ch, s = 0, selector = null) {
  if (playing) {
    if (ch !== shownCh) showChapter(ch);
  } else {
    if (!returnTo && (ch !== state.ch || s !== state.s)) returnTo = { ch: state.ch, s: state.s };
    openChapter(ch, s);
    if (returnTo && returnTo.ch === state.ch && returnTo.s === state.s) returnTo = null;
  }
  afterJump();
  const target = selector ? $("text").querySelector(selector) : sentEls[s];
  target?.scrollIntoView({ block: selector ? "start" : "center", behavior: "instant" });
  updatePill();
}
function updatePill() {
  const pill = $("backPill");
  if (!book) { pill.hidden = true; return; }
  const away = shownCh !== state.ch;
  const back = away ? { ch: state.ch, s: state.s } : returnTo;
  pill.hidden = !back;
  if (!back) return;
  pill.dataset.kind = away && playing ? "playing" : "back";
  $("pillK").textContent = away && playing ? "Now playing" : "Back to";
  $("pillT").textContent = book.chapters[back.ch].t;
}
function pillBack() {
  if (shownCh !== state.ch) { showChapter(state.ch); keepInView(sentEls[state.s]); }
  else if (returnTo) { const r = returnTo; returnTo = null; openChapter(r.ch, r.s); }
  updatePill();
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
const voiceName = (v) => v.name.replace(/\s*\((premium|enhanced)\)\s*/i, "").trim();
function voiceTier(v) {
  const n = `${v.name} ${v.voiceURI}`.toLowerCase();
  return n.includes("premium") ? "Premium" : n.includes("enhanced") ? "Enhanced" : "";
}
function loadVoices() {
  voices = speechSynthesis.getVoices()
    .filter((v) => v.lang.startsWith("en") && !NOVELTY.test(v.name))
    .sort((a, b) => voiceRank(a) - voiceRank(b) || a.name.localeCompare(b.name));
  if (voices.length && !voices.some((v) => v.voiceURI === state.voice)) {
    state.voice = voices[0].voiceURI; // list is sorted best-first
  }
  const box = $("voices");
  box.replaceChildren();
  if (!voices.length) box.append(node("div", "label", "No voices found"));
  for (const v of voices) {
    const b = node("button", "voice");
    b.type = "button";
    b.setAttribute("role", "option");
    b.dataset.uri = v.voiceURI;
    const name = node("span", null, voiceName(v));
    name.append(node("span", "lang", v.lang));
    b.append(svgIcon("M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"), name, node("span", voiceTier(v) ? "tier" : null, voiceTier(v)));
    box.appendChild(b);
  }
  applySettings();
}
function svgIcon(d) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", d);
  svg.appendChild(p);
  return svg;
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
  returnTo = null; // listening from here: this is the place now
  if (shownCh !== state.ch) showChapter(state.ch);
  playing = true;
  document.body.classList.add("playing");
  setPlayIcon(ICON_PAUSE);
  $("playBtn").setAttribute("aria-label", "Pause");
  keepInView(sentEls[state.s]);
  if (state.view === "library") renderLibrary();
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
// Page width in characters per line. Wide stops at 84: past that, the eye loses its place on the way back.
const MEASURE = { narrow: "56ch", standard: "66ch", wide: "84ch" };
function applySettings() {
  document.documentElement.dataset.theme = state.theme;
  $("text").style.setProperty("--size", `${state.size}px`);
  $("text").style.setProperty("--measure", MEASURE[state.width] || MEASURE.standard);
  $("rate").value = state.rate;
  const rate = `${Number(state.rate).toFixed(2)}×`;
  $("rateOut").textContent = rate;
  $("rateVal").textContent = rate;
  $("sizeOut").textContent = `${state.size} px`;
  for (const b of $("presets").children) b.classList.toggle("on", Math.abs(+b.dataset.rate - state.rate) < 0.001);
  for (const b of $("widths").children) b.setAttribute("aria-checked", b.dataset.width === state.width);
  for (const b of $("swatches").children) b.setAttribute("aria-checked", b.dataset.pick === state.theme);
  for (const b of $("voices").querySelectorAll(".voice")) b.setAttribute("aria-selected", b.dataset.uri === state.voice);
  const v = voices.find((x) => x.voiceURI === state.voice);
  $("voiceName").textContent = v ? voiceName(v) : "Voice";
  updateProgress(); // time left depends on speed
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
    jump(ch, 0);
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
  jump(c, s);
}
function openSearch() {
  if (!book) return;
  $("search").showModal();
  $("q").select();
}

// ---------- Layout: Novels/Comics, reading/library, the panel ----------
// Desktop: the panel is a column beside the rail that folds away. Phone: it's a sheet that rises above the bar.
const isPhone = () => matchMedia("(max-width: 800px)").matches;
function applyLayout() {
  const app = $("app");
  const novel = state.mode === "novel";
  app.dataset.mode = state.mode;
  app.dataset.view = state.view;
  app.classList.toggle("panel-closed", !state.panel);
  $("main").hidden = !novel || state.view !== "read";
  $("library").hidden = !novel || state.view !== "library";
  $("comics").hidden = novel;
  for (const b of document.querySelectorAll("button[data-mode]")) b.setAttribute("aria-checked", b.dataset.mode === state.mode);
  $("railLibrary").classList.toggle("on", !novel || state.view === "library");
  $("railBook").classList.toggle("on", novel && state.view === "read");
  const label = state.panel ? "Hide the panel (C)" : "Show the panel (C)";
  $("panelBtn").setAttribute("aria-pressed", state.panel);
  $("panelBtn").setAttribute("aria-label", label);
  $("panelBtn").title = label;
}
function setView(view) {
  state.view = view;
  saveState();
  applyLayout();
  if (view === "library") renderLibrary();
  // The reading column was hidden, so it lost its scroll position: put the live sentence back in view.
  else if (shownCh === state.ch && sentEls[state.s]) requestAnimationFrame(() => keepInView(sentEls[state.s]));
}
function setMode(mode) {
  if (mode === state.mode) return;
  if (mode === "comic" && playing) pause();
  state.mode = mode;
  saveState();
  setSheet(false);
  setListen(false);
  applyLayout();
}
function setPanel(open) { state.panel = open; saveState(); applyLayout(); }
function setSheet(open) { $("app").classList.toggle("sheet", open); syncScrim(); }
const syncScrim = () => ($("scrim").hidden = !($("app").classList.contains("sheet") || !$("listen").hidden));
const panelOpen = () => (isPhone() ? $("app").classList.contains("sheet") : state.panel);
function openPanel(name = tab) {
  if (!isPhone() && state.view !== "read") setView("read"); // the panel lives beside the page, not the shelf
  showTab(name);
  if (isPhone()) { setListen(false); setSheet(true); } else setPanel(true);
}
function togglePanel(name = tab) {
  if (panelOpen() && tab === name) isPhone() ? setSheet(false) : setPanel(false);
  else openPanel(name);
}
// After picking a chapter, a picture or a search result: show the page (the desktop panel stays open).
function afterJump() {
  if (isPhone()) setSheet(false);
  if (state.view !== "read") setView("read");
}

// ---------- Listening panel: voice, speed, text size, page width, theme ----------
function setListen(open) {
  $("listen").hidden = !open;
  $("aaBtn").setAttribute("aria-expanded", open);
  if (open) {
    if (isPhone()) setSheet(false);
    $("voices").querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }
  syncScrim();
}

// ---------- Library ----------
let coverUrl = null;
function setCovers() {
  if (coverUrl) URL.revokeObjectURL(coverUrl);
  coverUrl = book?.cover ? URL.createObjectURL(book.cover) : null;
  for (const id of ["sideCover", "heroCover", "heroGlow", "railCover"]) {
    $(id).hidden = !coverUrl;
    if (coverUrl) $(id).src = coverUrl;
  }
  // No cover in the EPUB: a plain one made from the title.
  $("heroGen").hidden = !!coverUrl || !book;
  $("heroGenTitle").textContent = book?.title || "";
}
// Books saved before covers were kept: take the cover from the saved EPUB once, without a re-import.
async function fillCover(b) {
  const saved = await dbGet("epub").catch(() => null);
  if (saved?.id !== b.id) return;
  b.cover = await openPackage(saved.blob).then(coverOf).catch(() => null);
  if (book !== b) return;
  setCovers();
  dbPut("current", b).catch(() => {});
}
function renderLibrary() {
  $("libSub").textContent = cloud === "in" ? "Your place follows you to every device you sign in on."
    : "Sign in to keep your book and your place on every device.";
  $("libAccount").hidden = !(cloud === "in" || cloud === "error");
  $("hero").hidden = !book;
  $("shelfNote").hidden = !book;
  if (!book) return;
  const ch = book.chapters[state.ch];
  const { pct, left } = progress();
  $("hero").querySelector(".hero-kicker").textContent = playing ? "Now playing" : "Continue listening";
  $("heroTitle").textContent = book.title;
  $("heroWhere").textContent = ch.t;
  $("heroQuote").textContent = ch.s[state.s] ? `“${ch.s[state.s]}”` : "";
  $("heroBar").style.width = `${pct}%`;
  $("heroLeft").textContent = `${pct}% read, ${left} at ${Number(state.rate).toFixed(2)}×`;
  $("resumeBtn").lastChild.textContent = playing ? "Back to the page" : "Resume";
}

// ---------- Import ----------
function showLoading(text) {
  $("loading").hidden = false;
  $("loadingText").textContent = text;
  $("loadingBar").style.width = "0%";
}
const hideLoading = () => ($("loading").hidden = true);
// Parse an EPUB (a dropped file or a download from your library), save it on this device and show it.
async function openBook(file, { cloud: cloudId = null, name = null } = {}) {
  const parsed = await parseEpub(file, (i, n) => {
    $("loadingText").textContent = `Reading the book… ${i} / ${n}`;
    $("loadingBar").style.width = `${(i / n) * 100}%`;
  });
  parsed.cloud = cloudId;
  await dbPut("current", parsed);
  // Keep the original file too, so "Download EPUB" works offline and hands over the exact bytes.
  await dbPut("epub", { id: parsed.id, blob: file, name: name || file.name || `${parsed.title}.epub` }).catch(() => {});
  // Same book (by title) = a newer build: keep the place. A different book starts where you left it, or at the
  // beginning; the place in the book it replaces is kept, so swapping back (even by accident) loses nothing.
  const prev = (state.bookId || "").split("|")[0];
  const same = prev === parsed.title;
  state.bookId = parsed.id;
  if (!same) {
    const places = state.places || {};
    if (prev) places[prev] = { ch: state.ch, s: state.s, chKey: state.chKey, sText: state.sText };
    Object.assign(state, { ch: 0, s: 0, chKey: null, sText: null }, places[parsed.title]);
    delete places[parsed.title];
    state.places = Object.fromEntries(Object.entries(places).slice(-5));
  }
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
  setCovers();
  if (b.cover === undefined) fillCover(b);
  countWords(b);
  imageUrls.forEach((u) => URL.revokeObjectURL(u));
  imageUrls = (b.images || []).map((im) => URL.createObjectURL(im.blob));
  const place = findPlace(b);
  state.ch = place.ch;
  state.s = place.s;
  renderChapterList();
  far = farthest();
  renderGallery();
  worldSeen = worldOpen = null;
  renderWorld();
  showTab("chapters");
  sentEls = [];
  shownCh = -1; // force render
  returnTo = null;
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

// ---------- Download the EPUB (e.g. into Apple Books or Files on an iPad or iPhone) ----------
async function cloudEpub() {
  const m = await apiJSON("GET", "/api/book");
  if (!m) throw new Error("Your library is empty.");
  showLoading("Getting the EPUB…");
  try {
    const parts = [];
    for (let i = 0; i < m.parts; i++) {
      parts.push(await apiBinary("GET", `/api/book/parts/${m.upload}/${i}`));
      $("loadingBar").style.width = `${((i + 1) / m.parts) * 100}%`;
    }
    return { blob: new Blob(parts, { type: "application/epub+zip" }), name: m.name };
  } finally { hideLoading(); }
}
async function downloadEpub() {
  if (!book) return;
  let saved = await dbGet("epub").catch(() => null);
  let fetched = false;
  if (saved?.id !== book.id) {
    if (cloud !== "in") { toast("This book was opened before downloads existed. Sign in, or open the file once more."); return; }
    try { saved = await cloudEpub(); fetched = true; }
    catch (err) { toast(`Couldn't get the EPUB: ${err.message}`); return; }
  }
  const name = (saved.name || `${book.title}.epub`).replace(/[\\/:*?"<>|]+/g, " ").trim();
  const file = new File([saved.blob], /\.epub$/i.test(name) ? name : `${name}.epub`, { type: "application/epub+zip" });
  // Phones and iPads: the share sheet offers Books and "Save to Files". Desktops: a normal download.
  if (matchMedia("(pointer: coarse)").matches && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return; }
    catch (err) {
      if (err.name === "AbortError") return; // closed the share sheet
      // Safari wants a fresh tap after a slow fetch: keep the file so the next tap is instant.
      if (fetched) { await dbPut("epub", { id: book.id, blob: saved.blob, name: saved.name }).catch(() => {}); toast("EPUB ready. Tap Download EPUB again."); return; }
    }
  }
  const a = node("a");
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
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
// Returns what happened: "book" (newer build), "moved" (newer place), "same", "saved" (playing: place sent), "error".
async function syncNow({ manual = false } = {}) {
  if (cloud === "error" && manual) cloud = "in"; // a tap on the red cloud is a retry
  if (cloud !== "in" || syncing || (playing && !manual)) return null;
  syncing = true;
  setSyncBusy(true);
  try {
    let r;
    if (playing) { await push(); r = cloud === "error" ? "error" : "saved"; }
    else r = (await fetchNewerBook()) ? "book" : (await pull()) ? "moved" : "same";
    if (r !== "error") setCloud("in"); // turns a red cloud green again after a good retry
    return r;
  } catch { setCloud("error"); return "error"; }
  finally { syncing = false; setSyncBusy(false); }
}
const setSyncBusy = (on) => [$("accountBtn"), $("sideAccount")].forEach((b) => b.classList.toggle("busy", on));
// The cloud button: signed in, it syncs right now and says what it found; signed out, it opens sign-in.
async function cloudTap() {
  if (cloud === "out" || cloud === "off") { openAccount(); return; }
  const r = await syncNow({ manual: true });
  if (r === "same") toast("All synced: this is the newest build and your latest place.");
  else if (r === "saved") toast("Your place is saved. Your other devices pick it up when they open.");
  else if (r === "error") toast("Couldn't reach your library. Check the connection and tap the cloud again.");
  // "book" and "moved" already announce themselves.
}
async function fetchNewerBook() {
  const m = await apiJSON("GET", "/api/book");
  if (!m || m.upload === book?.cloud) return false;
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
    return true;
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
  if (cloud !== "in" || playing) return false;
  const remote = await apiJSON("GET", "/api/bookmark");
  if (remote && remote.at > (state.at || 0)) { applyRemote(remote); return true; }
  if (state.at && (!remote || state.at > remote.at)) schedulePush(true); // this device is ahead
  return false;
}
function applyRemote(r) {
  state.at = r.at;
  state.chKey = r.chKey; state.sText = r.sText;
  if (r.ch != null) state.ch = r.ch;
  if (r.s != null) state.s = r.s;
  if (r.rate) state.rate = r.rate;
  if (r.theme) state.theme = r.theme;
  if (r.size) state.size = r.size;
  if (r.voice && voices.some((v) => v.voiceURI === r.voice)) state.voice = r.voice;
  applySettings();
  if (!book || book.title !== r.book) { state.bookId = `${r.book}|`; saveState(); return; }
  saveState();
  const place = findPlace(book);
  shownCh = -1;
  returnTo = null;
  openChapter(place.ch, place.s, { speak: false, touch: false });
  toast(`Picked up from your other device: ${book.chapters[place.ch].t}`);
}

// ---------- Sign-in UI ----------
function setCloud(c) {
  cloud = c;
  // The cloud button's colour is the sync status: green synced, red can't reach the server, grey signed out.
  const label = c === "in" ? "Synced. Tap to sync now" : c === "error" ? "Can't reach the server. Tap to retry" : "Sign in";
  for (const btn of [$("accountBtn"), $("sideAccount")]) {
    btn.hidden = c === "off";
    btn.title = label;
    btn.setAttribute("aria-label", label);
    btn.classList.toggle("in", c === "in");
    btn.classList.toggle("bad", c === "error");
  }
  if (state.view === "library") renderLibrary();
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
async function signOut(everywhere = false) {
  try { await apiJSON("POST", everywhere ? "/api/logout?everywhere=1" : "/api/logout"); } catch {}
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
  $("text").onclick = (e) => {
    // Clicking a sentence is the one way to say "read from here", even from a chapter you're only browsing.
    const s = e.target.closest(".s");
    if (s) { returnTo = null; openChapter(shownCh, +s.dataset.i); }
  };

  // Rail, phone sheet header, library
  for (const b of document.querySelectorAll("button[data-mode]")) b.onclick = () => setMode(b.dataset.mode);
  $("railLibrary").onclick = () => state.mode === "novel" && setView("library");
  $("railBook").onclick = () => setView("read");
  $("railSearch").onclick = openSearch;
  $("backPill").onclick = pillBack;
  $("libAccount").onclick = openAccount;
  $("panelBtn").onclick = () => setPanel(!state.panel);
  $("menuBtn").onclick = () => togglePanel();
  $("sideLibrary").onclick = () => { setSheet(false); setView("library"); };
  $("sideSearch").onclick = () => { setSheet(false); openSearch(); };
  $("sideClose").onclick = () => setSheet(false);
  $("resumeBtn").onclick = () => { setView("read"); if (!playing) play(); };
  $("heroChapters").onclick = () => { setView("read"); openPanel("chapters"); };
  $("downloadBtn").onclick = downloadEpub;
  $("scrim").onclick = () => { setSheet(false); setListen(false); };

  // Listening panel
  for (const id of ["aaBtn", "voiceChip", "rateChip"]) $(id).onclick = () => setListen($("listen").hidden);
  $("listenClose").onclick = () => setListen(false);
  $("listenSearch").onclick = () => { setListen(false); openSearch(); };
  // Dialogs close on a click outside them, like every other popup here.
  for (const d of [$("search"), $("accountDlg")]) {
    d.addEventListener("click", (e) => {
      const r = d.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) d.close();
    });
  }
  document.addEventListener("pointerdown", (e) => {
    if (!$("listen").hidden && !isPhone() && !e.target.closest("#listen, .ctl")) setListen(false);
  });
  $("voices").onclick = (e) => {
    const b = e.target.closest(".voice");
    if (!b) return;
    state.voice = b.dataset.uri;
    applySettings(); changed();
    if (playing) speakCurrent();
  };
  const setRate = (r) => {
    state.rate = Math.round(Math.min(2.5, Math.max(0.6, r)) * 20) / 20;
    applySettings(); changed();
  };
  $("rate").oninput = (e) => setRate(+e.target.value);
  $("rate").onchange = () => { if (playing) speakCurrent(); };
  $("presets").onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    setRate(+b.dataset.rate);
    if (playing) speakCurrent();
  };
  const nudgeRate = (d) => { setRate(state.rate + d); if (playing) speakCurrent(); };
  $("sizeDown").onclick = () => { state.size = Math.max(14, state.size - 1); applySettings(); changed(); };
  $("sizeUp").onclick = () => { state.size = Math.min(32, state.size + 1); applySettings(); changed(); };
  $("widths").onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    state.width = b.dataset.width;
    applySettings(); saveState(); // this device only
    if (shownCh === state.ch && sentEls[state.s]) keepInView(sentEls[state.s]);
  };
  $("swatches").onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    state.theme = b.dataset.pick;
    applySettings(); changed();
  };

  $("goto").oninput = filterChapters;
  $("tabCh").onclick = () => showTab("chapters");
  $("tabImg").onclick = () => showTab("images");
  $("tabWorld").onclick = () => showTab("world");
  $("viewer").onclick = () => $("viewer").close();
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
  for (const id of ["pickBtn", "addBtn"]) $(id).onclick = pick;
  $("file").onchange = (e) => { importFile(e.target.files[0]); e.target.value = ""; };
  const drops = [$("drop")];
  addEventListener("dragover", (e) => { e.preventDefault(); drops.forEach((d) => d.classList.add("over")); });
  addEventListener("dragleave", (e) => { if (!e.relatedTarget) drops.forEach((d) => d.classList.remove("over")); });
  addEventListener("drop", (e) => { e.preventDefault(); drops.forEach((d) => d.classList.remove("over")); importFile(e.dataTransfer.files[0]); });

  addEventListener("keydown", (e) => {
    if (e.key === "Escape" && (!$("listen").hidden || $("app").classList.contains("sheet"))) {
      setListen(false); setSheet(false);
      return;
    }
    const typing = e.target.closest("input, select, textarea") || $("search").open || $("accountDlg").open;
    if (typing || e.metaKey || e.ctrlKey || e.altKey || !book || state.mode !== "novel") return;
    const k = e.key;
    if (k === " ") { e.preventDefault(); toggle(); }
    else if (k === "ArrowRight") { e.preventDefault(); goSentence(state.s + 1); }
    else if (k === "ArrowLeft") { e.preventDefault(); goSentence(state.s - 1); }
    else if (k === "ArrowDown" && e.shiftKey) { e.preventDefault(); openChapter(state.ch + 1, 0); }
    else if (k === "ArrowUp" && e.shiftKey) { e.preventDefault(); openChapter(state.ch - 1, 0); }
    else if (k === "c" || k === "C") { e.preventDefault(); togglePanel("chapters"); }
    else if (k === "g" || k === "G") { e.preventDefault(); openPanel("chapters"); $("goto").focus(); }
    else if (k === "/") { e.preventDefault(); openSearch(); }
    else if (k === "[" || k === "-") { e.preventDefault(); nudgeRate(-0.05); }
    else if (k === "]" || k === "=" || k === "+") { e.preventDefault(); nudgeRate(0.05); }
  });

  $("accountBtn").onclick = cloudTap;
  $("sideAccount").onclick = () => { setSheet(false); cloudTap(); };
  $("emptySignIn").onclick = openAccount;
  $("loginForm").onsubmit = signIn;
  $("signOutBtn").onclick = () => signOut(false);
  $("signOutAllBtn").onclick = () => signOut(true);
  // Check for a newer book and place whenever Tachivel comes back to the front.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      // iPhone/iPad stop speech when the app goes to the background; carry on from the same sentence on return.
      if (playing && (speechSynthesis.paused || !speechSynthesis.speaking)) speakCurrent();
      syncNow();
    } else schedulePush(true);
  });
  addEventListener("focus", () => syncNow());
  // While open and paused, look for a newer place every 30 s (e.g. the laptop just moved on).
  setInterval(() => { if (document.visibilityState === "visible" && !playing) syncNow(); }, 30000);

  // Sheets and the Listening panel sit just above the control bar, whatever its height.
  new ResizeObserver(() => document.documentElement.style.setProperty("--bar-h", `${$("bar").offsetHeight}px`)).observe($("bar"));

  // Chrome stops speech silently in background tabs after ~15s of one utterance; per-sentence queueing avoids most of it.
  addEventListener("pagehide", () => speechSynthesis.cancel());
}

async function boot() {
  applySettings();
  applyLayout();
  wire();
  if ("speechSynthesis" in window) {
    loadVoices();
    speechSynthesis.onvoiceschanged = loadVoices;
  }
  try {
    const saved = await dbGet("current");
    const epub = saved && saved.v !== BOOK_VERSION ? await dbGet("epub").catch(() => null) : null;
    if (saved?.v === BOOK_VERSION) showBook(saved);
    // Saved by an older Tachivel: read the kept EPUB again (same title, so the place stays).
    else if (epub && epub.id === saved.id) {
      showLoading("Updating the book…");
      await openBook(epub.blob, { cloud: saved.cloud, name: epub.name }).catch(() => {}).finally(hideLoading);
    }
    else if (saved)$("emptyMsg").dataset.custom = "1", $("emptyMsg").textContent = "Tachivel was updated to show pictures and arcs. Drop the book in once more; your place is kept.";
  } catch {}
  checkCloud();
}
boot();
