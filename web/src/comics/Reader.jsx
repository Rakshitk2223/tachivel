// Comic reader (Figma V3 / L14 / I4 / I5, phone P3 / P4): webtoon or paged (left-to-right / right-to-left),
// two-page spreads on wide screens, tap zones, place saved to the server, next chapters saved ahead.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { gql, media, Q, M } from "../lib/gql.js";
import { Button, IconButton, Row, Segmented, Spinner, chapterLabel, friendlyError } from "../ui/kit.jsx";
import { Icon } from "../ui/icons.jsx";
import { useComicPrefs, readReaderPrefs, readerPrefsKey, num } from "./data.js";

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
    const done = page >= total - 1;
    saveTimer.current = setTimeout(() => gql(M.updateChapter, { id: cid, patch: done ? { isRead: true, lastPageRead: page } : { lastPageRead: page } }).catch(() => {}), done ? 0 : 1200);
    return () => clearTimeout(saveTimer.current);
  }, [page, total, cid, loadedFor, comicPrefs.incognito]);

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
    const n = page + delta * step;
    if (n >= total) { if (next) nav(`/comics/read/${next.id}`, { replace: true }); else setPage(total - 1); return; }
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

  const tap = (zone) => {
    if (zone === "mid" || prefs.zones === "off") { setUi((u) => !u); return; }
    if (webtoon) { scroller.current?.scrollBy({ top: innerHeight * 0.8 * (zone === "right" ? 1 : -1), behavior: "smooth" }); return; }
    const forward = rtl ? zone === "left" : zone === "right";
    go(forward ? 1 : -1);
    setUi(false);
  };
  const setPref = (patch, scope = "series") => {
    const nextPrefs = { ...prefs, ...patch };
    setPrefs(nextPrefs);
    try { localStorage.setItem(scope === "series" ? readerPrefsKey(chapter.mangaId) : "tachivel:reader:default", JSON.stringify(nextPrefs)); } catch {}
  };

  const shown = useMemo(() => {
    if (!pages || webtoon) return [];
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
        <div className="reader-scroll" ref={scroller} onClick={(e) => { const x = e.clientX / innerWidth; tap(prefs.zones === "edges" && x < 0.25 ? "left" : prefs.zones === "edges" && x > 0.75 ? "right" : "mid"); }}>
          <div className="strip" style={{ "--page-gap": prefs.gap === "small" ? "8px" : prefs.gap === "large" ? "24px" : "0px" }}>
            {!pages ? <div className="reader-wait"><Spinner />{status && <p>{status}</p>}</div> : pages.map((u, i) => <img key={u} src={u} data-i={i} alt={`Page ${i + 1}`} loading={i < 4 ? "eager" : "lazy"} decoding="async" />)}
            {pages && <ChapterEnd next={next} onNext={() => nav(`/comics/read/${next.id}`)} onBack={() => nav(`/comics/series/${chapter.mangaId}`)} />}
          </div>
        </div>
      ) : (
        <>
          <div className={`paged${prefs.fit === "width" ? " fit-width" : ""}${spread ? " spread" : ""}`}>
            {!pages ? <div className="reader-wait"><Spinner />{status && <p>{status}</p>}</div> : shown.map((u) => <img key={u} src={u} alt="" className="page-img" decoding="async" />)}
          </div>
          {pages && pages.slice(page + step, page + step + 3).map((u) => <link key={u} rel="prefetch" href={u} />)}
          <div className="zones">{["left", "mid", "right"].map((z) => <button key={z} type="button" aria-label={z === "mid" ? "Show or hide controls" : z === "left" ? "Left" : "Right"} onClick={() => tap(z)} />)}</div>
        </>
      )}

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
          <input type="range" min={0} max={Math.max(0, total - 1)} value={page} dir={rtl ? "rtl" : "ltr"} aria-label="Page"
            onChange={(e) => { const p = Number(e.target.value); setPage(p); if (webtoon) scroller.current?.querySelectorAll("img[data-i]")[p]?.scrollIntoView(); }} />
          <IconButton icon={rtl ? "prevch" : "nextch"} label={rtl ? "Previous chapter" : "Next chapter"} disabled={rtl ? !prev : !next} onClick={() => nav(`/comics/read/${(rtl ? prev : next).id}`, { replace: true })} />
        </div>
        <div className="reader-meta">
          {prefs.pageNumber && <b>Page {Math.min(page + 1, total)}{spread && page + 2 <= total ? `–${page + 2}` : ""} of {total}</b>}
          {ahead && <span><Icon name="ok" size={14} className="ok" /> {ahead}</span>}
          {comicPrefs.incognito && <span>Incognito</span>}
        </div>
      </footer>

      {panel && <ReaderPanel prefs={prefs} setPref={setPref} onClose={() => setPanel(false)} />}
    </div>
  );
}

function ChapterEnd({ next, onNext, onBack }) {
  return (
    <div className="chapter-end">
      <Icon name="ok" size={28} className="ok" />
      <h2>End of the chapter</h2>
      {next ? <Button kind="accent" icon="nextch" onClick={(e) => { e.stopPropagation(); onNext(); }}>Next · {chapterLabel(next)}</Button> : <p>You're caught up. New chapters show up in Updates.</p>}
      <Button onClick={(e) => { e.stopPropagation(); onBack(); }}>Back to the series</Button>
    </div>
  );
}

function ReaderPanel({ prefs, setPref, onClose }) {
  const [scope, setScope] = useState("series");
  const set = (patch) => setPref(patch, scope);
  const opt = (label, key, options) => (<div style={{ display: "grid", gap: 8 }}><label className="lbl">{label}</label><Segmented options={options} value={prefs[key]} onChange={(v) => set({ [key]: v })} label={label} /></div>);
  return (
    <aside className="reader-panel" role="dialog" aria-label="Reader settings">
      <div className="sheet-head"><h2>Reader</h2><IconButton icon="close" label="Close" onClick={onClose} /></div>
      <Segmented options={[{ value: "series", label: "This series" }, { value: "default", label: "All series" }]} value={scope} onChange={setScope} />
      {opt("READING MODE", "mode", [{ value: "webtoon", label: "Webtoon" }, { value: "ltr", label: "Left → right" }, { value: "rtl", label: "Right → left" }])}
      {opt("TWO PAGES SIDE BY SIDE", "spread", [{ value: "off", label: "Off" }, { value: "auto", label: "Wide screens" }, { value: "on", label: "On" }])}
      {opt("PAGE FIT", "fit", [{ value: "screen", label: "Screen" }, { value: "width", label: "Width" }])}
      {opt("TAP ZONES", "zones", [{ value: "edges", label: "Edges" }, { value: "off", label: "Off" }])}
      {opt("BACKGROUND", "bg", [{ value: "theme", label: "Theme" }, { value: "black", label: "Black" }, { value: "white", label: "White" }, { value: "grey", label: "Grey" }])}
      {opt("GAP BETWEEN WEBTOON PAGES", "gap", [{ value: "none", label: "None" }, { value: "small", label: "Small" }, { value: "large", label: "Large" }])}
      <Row title="Show page number" toggle={prefs.pageNumber} onToggle={(v) => set({ pageNumber: v })} />
      <Row title="Keep the screen awake" toggle={prefs.keepAwake} onToggle={(v) => set({ keepAwake: v })} />
      <p className="sub">Pinch to zoom works in every mode. How many chapters to save ahead is in Settings → Reader.</p>
    </aside>
  );
}
