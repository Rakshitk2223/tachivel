// Comic reader (Figma V3 / L14 / I4 / I5, phone P3 / P4): webtoon or paged (left-to-right / right-to-left),
// two-page spreads on wide screens, tap zones, place saved to the server, next chapters saved ahead.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { gql, media, Q, M } from "../lib/gql.js";
import { Button, IconButton, Row, Segmented, Spinner, chapterLabel, friendlyError } from "../ui/kit.jsx";
import { Icon } from "../ui/icons.jsx";
import { useComicPrefs, readReaderPrefs, readerPrefsKey, num } from "./data.js";

// Tap zones, like Mihon: where a tap lands (x, y from 0 to 1) decides previous, next or the menu.
export const ZONES = {
  edges: (x) => (x < 1 / 3 ? "prev" : x > 2 / 3 ? "next" : "menu"),
  lshape: (x, y) => (y < 1 / 3 || (y < 2 / 3 && x < 1 / 3) ? "prev" : y > 2 / 3 || x > 2 / 3 ? "next" : "menu"),
  kindle: (x, y) => (y < 1 / 3 ? "menu" : x < 1 / 3 ? "prev" : "next"),
  off: () => "menu",
};
const zoneAt = (prefs, rtl, x, y) => {
  const inv = prefs.invert || "none";
  if (rtl !== (inv === "h" || inv === "both")) x = 1 - x; // right-to-left reads the other way round
  if (inv === "v" || inv === "both") y = 1 - y;
  return (ZONES[prefs.zones] || ZONES.edges)(x, y);
};
const MODES = [["webtoon", "Webtoon", "webtoon"], ["ltr", "Left → right", "paged"], ["rtl", "Right → left", "paged"]];

const pagesFor = async (chapterId) => (await gql(M.pages, { id: chapterId })).fetchChapterPages.pages.map(media);

// Warm the next chapters into this device's cache (the service worker keeps page images), so they open instantly and offline.
async function saveAhead(nextIds) {
  for (const id of nextIds) {
    try { for (const url of await pagesFor(id)) await fetch(url, { credentials: "same-origin" }).catch(() => {}); } catch { /* source refused: it reads live later */ }
  }
}

export default function Reader() {
  const { chapterId } = useParams();
  const cid = Number(chapterId);
  const nav = useNavigate();
  const [comicPrefs] = useComicPrefs();
  const [chapter, setChapter] = useState(null);
  const [siblings, setSiblings] = useState([]); // oldest → newest
  const [pages, setPages] = useState(null);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState("");
  const [ui, setUi] = useState(true);
  const [panel, setPanel] = useState(false);
  const [page, setPage] = useState(0);
  const [prefs, setPrefs] = useState(null);
  const [ahead, setAhead] = useState("");
  const [hint, setHint] = useState(false);
  const [flash, setFlash] = useState("");
  const scroller = useRef(null);
  const saveTimer = useRef();
  // Which chapter the loaded pages belong to. Saving waits for this to match, so arriving at the next
  // chapter (while the previous one's last page is still in state) can never mark it read.
  const [loadedFor, setLoadedFor] = useState(null);

  // Load the chapter, its siblings and its pages.
  useEffect(() => {
    let live = true;
    setPages(null); setError(null); setPage(0); setLoadedFor(null);
    (async () => {
      try {
        const c = (await gql(Q.chapter, { id: cid })).chapter;
        if (!live) return;
        setChapter(c);
        setPrefs(readReaderPrefs(c.mangaId));
        const list = (await gql(Q.chapters, { id: c.mangaId })).chapters.nodes.slice().reverse();
        if (!live) return;
        setSiblings(list);
        let p;
        try { p = await pagesFor(cid); }
        catch (e) {
          // After a restore, Suwayomi refuses pages until the series' chapter list has come from the source itself.
          // Fetch it (as Mihon does), then open the same chapter, or the one with the same number if its id changed.
          if (!/Refresh Chapter List/i.test(e.message)) throw e;
          setStatus("Getting the latest chapter list from the source…");
          await gql(M.refreshManga, { id: c.mangaId });
          const fresh = (await gql(Q.chapters, { id: c.mangaId })).chapters.nodes;
          if (!live) return;
          const same = fresh.find((x) => x.id === cid) || fresh.find((x) => x.chapterNumber === c.chapterNumber);
          if (!same) throw new Error("This chapter isn't on the source any more.");
          if (same.id !== cid) { nav(`/comics/read/${same.id}`, { replace: true }); return; }
          setSiblings(fresh.slice().reverse());
          p = await pagesFor(cid);
          setStatus("");
        }
        if (!live) return;
        setPages(p);
        setLoadedFor(cid);
        const start = c.isRead ? 0 : Math.min(c.lastPageRead || 0, p.length - 1);
        setPage(start);
        if (scroller.current && start > 0) requestAnimationFrame(() => scroller.current?.querySelectorAll("img")[start]?.scrollIntoView());
      } catch (e) { if (live) setError(e); }
    })();
    return () => { live = false; };
  }, [cid]);

  const idx = siblings.findIndex((c) => c.id === cid);
  const prev = idx > 0 ? siblings[idx - 1] : null;
  const next = idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1] : null;

  // Save ahead once this chapter is showing.
  useEffect(() => {
    if (!pages || idx < 0 || !comicPrefs.saveAhead) return;
    const ids = siblings.slice(idx + 1, idx + 1 + comicPrefs.saveAhead).map((c) => c.id);
    if (!ids.length) return;
    setAhead(`Saving the next ${ids.length} chapter${ids.length === 1 ? "" : "s"}…`);
    saveAhead(ids).then(() => setAhead(`Next ${ids.length} chapter${ids.length === 1 ? "" : "s"} saved on this device`));
  }, [pages, idx]); // eslint-disable-line

  // Your place goes to the server (unless incognito); the last page marks the chapter read.
  const total = pages?.length || 0;
  useEffect(() => {
    if (!total || comicPrefs.incognito || loadedFor !== cid) return;
    clearTimeout(saveTimer.current);
    const done = page >= total - 1, at = Math.min(page, total - 1);
    saveTimer.current = setTimeout(() => gql(M.updateChapter, { id: cid, patch: done ? { isRead: true, lastPageRead: at } : { lastPageRead: at } }).catch(() => {}), done ? 0 : 1200);
    return () => clearTimeout(saveTimer.current);
  }, [page, total, cid, loadedFor, comicPrefs.incognito]);

  useEffect(() => { document.documentElement.dataset.mode = "comics"; }, []);

  // Show the tap zones the first time this device opens the reader.
  useEffect(() => {
    if (!prefs || prefs.zones === "off") return;
    try { if (!localStorage.getItem("tachivel:zoneHint")) { setHint(true); localStorage.setItem("tachivel:zoneHint", "1"); } } catch {}
  }, [!!prefs]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the screen awake while reading.
  useEffect(() => {
    if (!prefs?.keepAwake || !("wakeLock" in navigator)) return;
    let lock; navigator.wakeLock.request("screen").then((l) => (lock = l)).catch(() => {});
    return () => lock?.release().catch(() => {});
  }, [prefs?.keepAwake]);

  const webtoon = prefs?.mode === "webtoon";
  const rtl = prefs?.mode === "rtl";
  const wide = typeof innerWidth !== "undefined" && innerWidth > innerHeight && innerWidth >= 1000;
  const spread = !webtoon && (prefs?.spread === "on" || (prefs?.spread === "auto" && wide));
  const step = spread ? 2 : 1;

  const go = useCallback((delta) => {
    if (!total) return;
    // One step past the last page is the "Finished / Next" page; the step after that opens the next chapter.
    if (page >= total) { if (delta > 0) { if (next) nav(`/comics/read/${next.id}`, { replace: true }); } else setPage(Math.max(0, total - step)); return; }
    const n = page + delta * step;
    if (n >= total) { setPage(total); return; }
    if (n < 0) { if (prev) nav(`/comics/read/${prev.id}`, { replace: true }); return; }
    setPage(n);
  }, [page, total, step, next, prev, nav]);

  // Webtoon: the page in the middle of the screen is the current one.
  useEffect(() => {
    if (!webtoon || !pages || !scroller.current) return;
    const imgs = [...scroller.current.querySelectorAll("img[data-i]")];
    const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && setPage(Number(e.target.dataset.i))), { root: scroller.current, rootMargin: "-50% 0px -50% 0px" });
    imgs.forEach((i) => io.observe(i));
    // The last page never reaches the middle of the screen (the end card sits below it): reaching the end card counts as reading it.
    const end = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && setPage(imgs.length - 1)), { root: scroller.current, threshold: 0.3 });
    const card = scroller.current.querySelector(".chapter-end");
    if (card) end.observe(card);
    return () => { io.disconnect(); end.disconnect(); };
  }, [webtoon, pages]);

  useEffect(() => {
    const key = (e) => {
      if (e.target?.closest?.("input")) return;
      if (e.key === "Escape") { panel ? setPanel(false) : nav(`/comics/series/${chapter?.mangaId}`); return; }
      if (webtoon) { if (e.key === " ") { e.preventDefault(); scroller.current?.scrollBy({ top: innerHeight * 0.85 * (e.shiftKey ? -1 : 1), behavior: "smooth" }); } return; }
      const fwd = rtl ? "ArrowLeft" : "ArrowRight", back = rtl ? "ArrowRight" : "ArrowLeft";
      if (e.key === fwd || e.key === " " || e.key === "ArrowDown") { e.preventDefault(); go(1); }
      if (e.key === back || e.key === "ArrowUp") { e.preventDefault(); go(-1); }
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [go, webtoon, rtl, panel, chapter, nav]);

  const tap = (e) => {
    if (hint) { setHint(false); return; }
    const zone = zoneAt(prefs, rtl && !webtoon, e.clientX / innerWidth, e.clientY / innerHeight);
    if (zone === "menu") { setUi((u) => !u); return; }
    setUi(false);
    if (webtoon) scroller.current?.scrollBy({ top: innerHeight * 0.8 * (zone === "next" ? 1 : -1), behavior: "smooth" });
    else go(zone === "next" ? 1 : -1);
  };
  const setPref = (patch, scope = "series") => {
    const nextPrefs = { ...prefs, ...patch };
    setPrefs(nextPrefs);
    try { localStorage.setItem(scope === "series" ? readerPrefsKey(chapter.mangaId) : "tachivel:reader:default", JSON.stringify(nextPrefs)); } catch {}
  };
  const cycleMode = () => {
    const i = MODES.findIndex(([m]) => m === prefs.mode), [mode, label] = MODES[(i + 1) % MODES.length];
    setPref({ mode }); setFlash(label); setTimeout(() => setFlash(""), 1400);
  };

  const shown = useMemo(() => {
    if (!pages || webtoon) return [];
    if (page >= pages.length) return [];
    const p = spread ? pages.slice(page, page + 2) : [pages[page]];
    return rtl ? p.reverse() : p;
  }, [pages, page, spread, rtl, webtoon]);

  if (error) return (
    <div className="reader" data-bg="theme"><div className="chapter-end reader-error">
      <Icon name="alert" size={28} className="warn" /><h2>This chapter didn't load</h2><p>{friendlyError(error)}</p>
      <div className="actions">
        <Button kind="accent" icon="refresh" onClick={() => location.reload()}>Try again</Button>
        {chapter && <Button icon="migrate" onClick={() => nav(`/comics/migrate/${chapter.mangaId}`)}>Read from another source</Button>}
        <Button onClick={() => nav(chapter ? `/comics/series/${chapter.mangaId}` : -1)}>Back to the series</Button>
      </div>
    </div></div>
  );
  if (!prefs || !chapter) return <div className="reader" data-bg="theme"><Spinner /></div>;

  return (
    <div className={`reader${ui ? "" : " hide-ui"}`} data-bg={prefs.bg}>
      {webtoon ? (
        <div className="reader-scroll" ref={scroller} onClick={tap}>
          <div className="strip" style={{ "--page-gap": prefs.gap === "small" ? "8px" : prefs.gap === "large" ? "24px" : "0px" }}>
            {!pages ? <div className="reader-wait"><Spinner />{status && <p>{status}</p>}</div> : pages.map((u, i) => <img key={u} src={u} data-i={i} alt={`Page ${i + 1}`} loading={i < 4 ? "eager" : "lazy"} decoding="async" />)}
            {pages && <ChapterEnd chapter={chapter} next={next} onNext={() => nav(`/comics/read/${next.id}`)} onBack={() => nav(`/comics/series/${chapter.mangaId}`)} />}
          </div>
        </div>
      ) : (
        <>
          <div className={`paged${prefs.fit === "width" ? " fit-width" : ""}${spread ? " spread" : ""}`}>
            {!pages ? <div className="reader-wait"><Spinner />{status && <p>{status}</p>}</div> : page >= total ? null : shown.map((u) => <img key={u} src={u} alt="" className="page-img" decoding="async" />)}
          </div>
          {pages && page >= total && <div className="transition"><ChapterEnd chapter={chapter} next={next} onNext={() => nav(`/comics/read/${next.id}`, { replace: true })} onBack={() => nav(`/comics/series/${chapter.mangaId}`)} /></div>}
          {pages && pages.slice(page + step, page + step + 3).map((u) => <link key={u} rel="prefetch" href={u} />)}
          <button type="button" className="zones" aria-label="Turn the page, or show the controls" onClick={tap} />
        </>
      )}

      {prefs.dim > 0 && <div className="reader-dim" style={{ opacity: prefs.dim / 100 }} aria-hidden />}
      {hint && <ZoneMap prefs={prefs} rtl={rtl && !webtoon} overlay onClick={() => setHint(false)} />}
      {flash && <div className="reader-flash" role="status">{flash}</div>}
      <header className="reader-top">
        <IconButton icon="back" label="Back to the series" onClick={() => nav(`/comics/series/${chapter.mangaId}`)} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="row-title">{chapter.manga.title}</div>
          <div className="row-sub">{chapterLabel(chapter)} · {chapter.manga.source?.displayName}</div>
        </div>
        <div className="seg hide-phone" role="radiogroup" aria-label="Reading mode">
          <button type="button" className={webtoon ? "on" : ""} onClick={() => setPref({ mode: "webtoon" })}><Icon name="webtoon" size={16} /> Webtoon</button>
          <button type="button" className={!webtoon ? "on" : ""} onClick={() => setPref({ mode: webtoon ? "rtl" : prefs.mode })}><Icon name="paged" size={16} /> Paged</button>
        </div>
        <IconButton icon="settings" label="Reader settings" onClick={() => setPanel(true)} />
      </header>

      <footer className="reader-bottom">
        <div className="reader-ctl">
          <IconButton icon={rtl ? "nextch" : "prevch"} label={rtl ? "Next chapter" : "Previous chapter"} disabled={rtl ? !next : !prev} onClick={() => nav(`/comics/read/${(rtl ? next : prev).id}`, { replace: true })} />
          <input type="range" min={0} max={Math.max(0, total - 1)} value={Math.min(page, Math.max(0, total - 1))} dir={rtl ? "rtl" : "ltr"} aria-label="Page"
            onChange={(e) => { const p = Number(e.target.value); setPage(p); if (webtoon) scroller.current?.querySelectorAll("img[data-i]")[p]?.scrollIntoView(); }} />
          <IconButton icon={rtl ? "prevch" : "nextch"} label={rtl ? "Previous chapter" : "Next chapter"} disabled={rtl ? !prev : !next} onClick={() => nav(`/comics/read/${(rtl ? prev : next).id}`, { replace: true })} />
        </div>
        <div className="reader-meta">
          <button type="button" className="mode-btn only-phone" onClick={cycleMode} aria-label="Change reading mode"><Icon name={webtoon ? "webtoon" : "paged"} size={16} />{MODES.find(([m]) => m === prefs.mode)?.[1]}</button>
          {prefs.pageNumber && <b>Page {Math.min(page + 1, total)}{spread && page + 2 <= total ? `–${page + 2}` : ""} of {total}</b>}
          {ahead && <span><Icon name="ok" size={14} className="ok" /> {ahead}</span>}
          {comicPrefs.incognito && <span>Incognito</span>}
        </div>
      </footer>

      {panel && <ReaderPanel prefs={prefs} setPref={setPref} rtl={rtl && !webtoon} onClose={() => setPanel(false)} />}
    </div>
  );
}

// Between chapters (end of a webtoon strip, or the page after the last one in paged mode), like Mihon's transition page.
function ChapterEnd({ chapter, next, onNext, onBack }) {
  const gap = next && chapter.chapterNumber > 0 && next.chapterNumber > 0 ? Math.ceil(next.chapterNumber - chapter.chapterNumber) - 1 : 0;
  const stop = (fn) => (e) => { e.stopPropagation(); fn(); };
  return (
    <div className="chapter-end" onClick={(e) => e.stopPropagation()}>
      <div className="transition-rows">
        <div><span className="caps-sm">Finished</span><b>{chapterLabel(chapter)}</b></div>
        <div><span className="caps-sm">Next</span><b>{next ? chapterLabel(next) : "Nothing yet"}</b></div>
      </div>
      {gap > 0 && <p className="warn"><Icon name="alert" size={14} /> {gap} chapter{gap === 1 ? "" : "s"} missing between these two</p>}
      {next ? <Button kind="accent" icon="nextch" onClick={stop(onNext)}>Read {chapterLabel(next)}</Button> : <p>You're caught up. New chapters show up in Updates.</p>}
      <Button onClick={stop(onBack)}>Back to the series</Button>
    </div>
  );
}

// A picture of the tap zones: as a one-time overlay on the reader, or small, inside the settings.
function ZoneMap({ prefs, rtl, overlay, onClick }) {
  const cells = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) cells.push(zoneAt(prefs, rtl, (c + 0.5) / 3, (r + 0.5) / 3));
  const label = { prev: "Previous", next: "Next", menu: "Menu" };
  return (
    <div className={`zone-map${overlay ? " overlay" : ""}`} onClick={onClick} aria-hidden={!overlay}>
      {cells.map((z, i) => <span key={i} className={`z-${z}`}>{i === cells.indexOf(z) && z !== "menu" ? label[z] : overlay && i === cells.indexOf(z) ? label[z] : ""}</span>)}
      {overlay && <p>Tap anywhere to start reading</p>}
    </div>
  );
}

function ReaderPanel({ prefs, setPref, onClose, rtl }) {
  const [scope, setScope] = useState("series");
  const [tab, setTab] = useState("reading");
  const set = (patch) => setPref(patch, scope);
  const opt = (label, key, options) => (<div className="panel-opt"><label className="lbl">{label}</label><Segmented options={options} value={prefs[key]} onChange={(v) => set({ [key]: v })} label={label} /></div>);
  const phone = innerWidth < 700;
  return (
    <>
      <div className="reader-scrim" onClick={onClose} />
      <aside className="reader-panel" role="dialog" aria-label="Reader settings">
        <div className="grab only-phone" aria-hidden />
        <div className="sheet-head"><h2>Reader</h2><IconButton icon="close" label="Close" onClick={onClose} /></div>
        <Segmented options={[{ value: "reading", label: "Reading" }, { value: "zones", label: "Tap zones" }, { value: "display", label: "Display" }]} value={tab} onChange={setTab} label="Settings" />
        {tab === "reading" && <>
          {opt("READING MODE", "mode", MODES.map(([value, label]) => ({ value, label })))}
          {!phone && opt("TWO PAGES SIDE BY SIDE", "spread", [{ value: "off", label: "Off" }, { value: "auto", label: "Wide screens" }, { value: "on", label: "On" }])}
          {opt("PAGE FIT", "fit", [{ value: "screen", label: "Screen" }, { value: "width", label: "Width" }])}
          <Row title="Keep the screen awake" toggle={prefs.keepAwake} onToggle={(v) => set({ keepAwake: v })} />
        </>}
        {tab === "zones" && <>
          {opt("LAYOUT", "zones", [{ value: "edges", label: "Edges" }, { value: "lshape", label: "L-shape" }, { value: "kindle", label: "Kindle" }, { value: "off", label: "Off" }])}
          {prefs.zones !== "off" && opt("FLIP", "invert", [{ value: "none", label: "None" }, { value: "h", label: "Sideways" }, { value: "v", label: "Up–down" }, { value: "both", label: "Both" }])}
          {prefs.zones !== "off" && <ZoneMap prefs={prefs} rtl={rtl} />}
          <p className="sub">{prefs.zones === "off" ? "Taps only show and hide the controls. Swipe or scroll to turn pages." : "The shaded parts turn the page; the clear part shows and hides the controls."}</p>
        </>}
        {tab === "display" && <>
          {opt("BACKGROUND", "bg", [{ value: "theme", label: "Theme" }, { value: "black", label: "Black" }, { value: "white", label: "White" }, { value: "grey", label: "Grey" }])}
          <div className="panel-opt"><label className="lbl">DIM THE PAGES · {prefs.dim || 0}%</label>
            <input type="range" min={0} max={80} step={5} value={prefs.dim || 0} onChange={(e) => set({ dim: Number(e.target.value) })} aria-label="Dim the pages" /></div>
          {prefs.mode === "webtoon" && opt("GAP BETWEEN PAGES", "gap", [{ value: "none", label: "None" }, { value: "small", label: "Small" }, { value: "large", label: "Large" }])}
          <Row title="Show page number" toggle={prefs.pageNumber} onToggle={(v) => set({ pageNumber: v })} />
        </>}
        <div className="panel-opt"><label className="lbl">APPLY TO</label><Segmented options={[{ value: "series", label: "This series" }, { value: "default", label: "All series" }]} value={scope} onChange={setScope} label="Apply to" /></div>
      </aside>
    </>
  );
}
