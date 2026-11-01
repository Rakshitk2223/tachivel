// Series page (Figma V2 / L9 / L10, phone P2 / M10 / M15), laid out like Mihon / Suwayomi-WebUI:
// sticky app bar, about block, a "N chapters" row (filter & sort, download, select), long-press to select,
// a bottom action bar while selecting, and a Continue button that stays within reach.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { gql, Q, M } from "../lib/gql.js";
import { AppBar, Button, Chip, Cover, ErrorNote, IconButton, Menu, Progress, Row, Segmented, Sheet, Spinner, timeAgo, chapterLabel, friendlyError } from "../ui/kit.jsx";
import { Icon } from "../ui/icons.jsx";
import { useGql, useDownloads, chapterStatus, STATUS, num, connectTracker } from "./data.js";
import { CategorySheet } from "./Library.jsx";

const FILTERS = [["all", "All"], ["new", "Unread"], ["server", "Downloaded"], ["bookmarked", "Bookmarked"]];

export default function Series() {
  const { id } = useParams();
  const mid = Number(id);
  const nav = useNavigate();
  const manga = useGql(Q.manga, { id: mid }, [mid]);
  const chapters = useGql(Q.chapters, { id: mid }, [mid]);
  const cats = useGql(Q.categories);
  const trackers = useGql(Q.trackers);
  const dl = useDownloads();
  const [filter, setFilter] = useState("all");
  const [order, setOrder] = useState("new");
  const [sel, setSel] = useState(null);
  const [menu, setMenu] = useState(null);
  const [more, setMore] = useState(null);
  const [dlMenu, setDlMenu] = useState(null);
  const [sheet, setSheet] = useState(null); // "categories" | "tracking" | "filter"
  const [refreshing, setRefreshing] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [showTitle, setShowTitle] = useState(false);
  const [toast, setToast] = useState("");
  const toastTimer = useRef();

  const m = manga.data?.manga;
  const all = chapters.data?.chapters.nodes || [];
  const list = useMemo(() => {
    let l = all;
    if (filter === "new") l = l.filter((c) => !c.isRead);
    if (filter === "server") l = l.filter((c) => c.isDownloaded);
    if (filter === "bookmarked") l = l.filter((c) => c.isBookmarked);
    return order === "old" ? [...l].reverse() : l;
  }, [all, filter, order]);
  const readCount = all.filter((c) => c.isRead).length;
  const asc = useMemo(() => [...all].reverse(), [all]);
  // Continue: a chapter you're partway through, else the first unread after the last one you read.
  const resume = useMemo(() => {
    const partway = asc.find((c) => !c.isRead && c.lastPageRead > 0);
    if (partway) return partway;
    const lastRead = asc.map((c) => c.isRead).lastIndexOf(true);
    return asc[lastRead + 1] || asc.find((c) => !c.isRead) || null;
  }, [asc]);

  const say = (t) => { setToast(t); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(""), 3000); };
  async function refresh() {
    setRefreshing(true);
    try { await gql(M.refreshManga, { id: mid }); await Promise.all([manga.reload(), chapters.reload()]); } catch (e) { say(friendlyError(e)); } finally { setRefreshing(false); }
  }
  // A series whose chapter list never came from the source (e.g. restored from a backup) fetches it once, by itself.
  const autoFetched = useRef(false);
  useEffect(() => {
    if (!m || autoFetched.current || (m.chaptersLastFetchedAt && m.chaptersLastFetchedAt !== "0")) return;
    autoFetched.current = true;
    refresh();
  }, [m]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (query, vars, done) => { try { await gql(query, vars); if (done) say(done); } catch (e) { say(friendlyError(e)); } chapters.reload(); manga.reload(); dl.refresh(); };
  const enqueue = (ids) => {
    if (!ids.length) { say("Nothing left to download."); return; }
    gql(M.enqueue, { ids }).catch(() => {});
    say(`Queued ${ids.length} chapter${ids.length === 1 ? "" : "s"} for download.`);
    setTimeout(() => dl.refresh(), 800);
  };
  const toggle = useCallback((cid) => setSel((s) => { const n = new Set(s); n.has(cid) ? n.delete(cid) : n.add(cid); return n.size ? n : null; }), []);
  // Rows get stable handlers (latest state read through refs), so a tap only redraws the rows it changes, not all 600.
  const selRef = useRef(sel), enqueueRef = useRef(enqueue);
  selRef.current = sel; enqueueRef.current = enqueue;
  const openChapter = useCallback((cid) => (selRef.current ? toggle(cid) : nav(`/comics/read/${cid}`)), [nav, toggle]);
  const pressChapter = useCallback((cid) => setSel((s) => new Set([...(s || []), cid])), []);
  const menuChapter = useCallback((at, c) => setMenu({ at, c }), []);
  const downloadChapter = useCallback((cid) => enqueueRef.current([cid]), []);
  const toDownload = asc.filter((c) => !c.isRead && !c.isDownloaded);
  const selected = sel ? all.filter((c) => sel.has(c.id)) : [];
  const selIds = selected.map((c) => c.id);
  const allBookmarked = selected.length > 0 && selected.every((c) => c.isBookmarked);
  const markPrevious = (c) => { const i = asc.findIndex((x) => x.id === c.id); return run(M.updateChapters, { ids: asc.slice(0, i).filter((x) => !x.isRead).map((x) => x.id), patch: { isRead: true } }, "Marked the earlier chapters read."); };
  const act = (fn) => () => { fn(); setSel(null); };
  // Tracking only shows up once a tracker is signed in on the comics server (or this series is already linked).
  const tracking = (trackers.data?.trackers.nodes || []).some((t) => t.isLoggedIn) || (m?.trackRecords?.nodes || []).length > 0;
  const anchor = (e, w) => { const r = e.currentTarget.getBoundingClientRect(); return { x: Math.max(8, r.right - w), y: r.bottom + 4 }; };

  if (manga.error && !m) return <div className="page"><AppBar title="Series" /><ErrorNote error={manga.error} onRetry={manga.reload} /></div>;
  if (!m) return <div className="page"><AppBar title="" /><Spinner /></div>;

  return (
    <div className={`page series-page${sel ? " selecting" : ""}`}>
      {sel ? (
        <AppBar back={false} title={`${sel.size} selected`} actions={<>
          <IconButton icon="select" label="Select all" onClick={() => setSel(new Set(list.map((c) => c.id)))} />
          <IconButton icon="invert" label="Invert selection" onClick={() => setSel((s) => { const n = new Set(list.filter((c) => !s.has(c.id)).map((c) => c.id)); return n.size ? n : null; })} />
          <IconButton icon="close" label="Stop selecting" onClick={() => setSel(null)} />
        </>} />
      ) : (
        <AppBar title={m.title} actions={<>
          <IconButton icon="refresh" label="Refresh from source" className={refreshing ? "spinning" : ""} disabled={refreshing} onClick={refresh} />
          <IconButton icon="more" label="More" onClick={(e) => setMore(anchor(e, 260))} />
        </>} />
      )}

      <div className="series">
        <aside className="series-about">
          <div className="series-head">
            <Cover src={m.thumbnailUrl} title={m.title} />
            <div className="series-title">
              <h1 className={`${m.title.length > 40 ? "long" : ""}${showTitle ? " open" : ""}`} onClick={() => setShowTitle(!showTitle)} title={m.title}>{m.title}</h1>
              <p className="sub">{[m.author, STATUS[m.status], m.source?.displayName].filter(Boolean).join(" · ")}</p>
              {!m.inLibrary && <div className="actions"><Button kind="accent" small icon="plus" onClick={() => run(M.setInLibrary, { id: mid, on: true }, "Added to your library.")}>Add to library</Button></div>}
            </div>
          </div>
          {all.length > 0 && <div className="series-progress"><Progress value={readCount / all.length} /><p className="sub">Read {readCount} of {all.length} · {m.unreadCount} unread · {m.downloadCount} downloaded</p></div>}
          {resume && <Button kind="accent" icon="play" className="hide-phone" onClick={() => nav(`/comics/read/${resume.id}`)}>{readCount ? "Continue" : "Start"} · Ch {num(resume.chapterNumber)}</Button>}
          {m.genre?.length > 0 && <div className="chips wrap genres">{m.genre.slice(0, 12).map((g) => <button type="button" key={g} className="chip tag" title={`Search ${m.source?.displayName || "this source"} for ${g}`}
            onClick={() => nav(m.source?.id ? `/comics/source/${m.source.id}?q=${encodeURIComponent(g)}` : `/comics/search?q=${encodeURIComponent(g)}`)}>{g}</button>)}</div>}
          {m.description && <p className={`sub series-desc${showAll ? " open" : ""}`} onClick={() => setShowAll(!showAll)}>{m.description}</p>}
        </aside>

        <section className="series-chapters">
          <div className="chapters-head">
            <b>{list.length === all.length ? `${all.length} chapter${all.length === 1 ? "" : "s"}` : `${list.length} of ${all.length} chapters`}</b>
            <span className="grow" />
            <IconButton icon="filter" label="Filter and sort" active={filter !== "all" || order === "old"} onClick={() => setSheet("filter")} />
            <IconButton icon="down" label="Download" onClick={(e) => setDlMenu(anchor(e, 240))} />
            <IconButton icon="select" label="Select chapters" onClick={() => setSel(new Set())} />
          </div>
          {chapters.loading && !chapters.data ? <Spinner /> : !all.length ? (
            <div className="note"><Icon name="info" /><span>{refreshing ? "Getting the chapter list from the source…" : "No chapters yet. Refresh from the source to fetch them."}</span>{!refreshing && <Button small icon="refresh" onClick={refresh}>Refresh</Button>}</div>
          ) : !list.length ? <p className="sub">No chapters match this filter.</p> : (
            <div className="chapter-list">
              {list.map((c) => <Chapter key={c.id} c={c} q={dl.byChapter[c.id]} selected={!!sel?.has(c.id)} source={m.source?.displayName}
                onOpen={openChapter} onSelect={pressChapter} onMenu={menuChapter} onDownload={downloadChapter} />)}
            </div>
          )}
        </section>
      </div>

      {sel && (
        <nav className="action-bar" aria-label="Selected chapters">
          <IconButton icon="down" label="Download" disabled={!sel.size} onClick={act(() => enqueue(selected.filter((c) => !c.isDownloaded).map((c) => c.id)))} />
          <IconButton icon="check" label="Mark read" disabled={!sel.size} onClick={act(() => run(M.updateChapters, { ids: selIds, patch: { isRead: true } }, "Marked read."))} />
          <IconButton icon="incognito" label="Mark unread" disabled={!sel.size} onClick={act(() => run(M.updateChapters, { ids: selIds, patch: { isRead: false, lastPageRead: 0 } }, "Marked unread."))} />
          <IconButton icon="bookmark" label={allBookmarked ? "Remove bookmark" : "Bookmark"} active={allBookmarked} disabled={!sel.size} onClick={act(() => run(M.updateChapters, { ids: selIds, patch: { isBookmarked: !allBookmarked } }))} />
          <IconButton icon="trash" label="Delete downloads" disabled={!selected.some((c) => c.isDownloaded)} onClick={act(() => run(M.deleteDownloads, { ids: selected.filter((c) => c.isDownloaded).map((c) => c.id) }, "Deleted the downloads."))} />
          <IconButton icon="history" label="Mark everything before it read" disabled={sel.size !== 1} onClick={act(() => markPrevious(selected[0]))} />
        </nav>
      )}
      {!sel && resume && <button type="button" className="fab only-phone" onClick={() => nav(`/comics/read/${resume.id}`)}><Icon name="play" size={16} />{readCount ? "Continue" : "Start"} · Ch {num(resume.chapterNumber)}</button>}
      {toast && <div className="toast" role="status">{toast}</div>}

      <Menu at={menu?.at} onClose={() => setMenu(null)} items={menu ? [
        { icon: "play", label: "Read", onClick: () => nav(`/comics/read/${menu.c.id}`) },
        { icon: "select", label: "Select", onClick: () => setSel(new Set([menu.c.id])) },
        !menu.c.isDownloaded && { icon: "down", label: "Download", onClick: () => enqueue([menu.c.id]) },
        { icon: "bookmark", label: menu.c.isBookmarked ? "Remove bookmark" : "Bookmark", onClick: () => run(M.updateChapters, { ids: [menu.c.id], patch: { isBookmarked: !menu.c.isBookmarked } }) },
        { icon: "check", label: menu.c.isRead ? "Mark as unread" : "Mark as read", onClick: () => run(M.updateChapters, { ids: [menu.c.id], patch: menu.c.isRead ? { isRead: false, lastPageRead: 0 } : { isRead: true } }) },
        { icon: "history", label: "Mark everything before it read", onClick: () => markPrevious(menu.c) },
        menu.c.isDownloaded && { icon: "trash", label: "Delete download", onClick: () => run(M.deleteDownloads, { ids: [menu.c.id] }) },
      ] : []} />
      <Menu at={dlMenu} onClose={() => setDlMenu(null)} items={[
        ...[1, 5, 10, 25].map((n) => ({ icon: "down", label: n === 1 ? "Next chapter" : `Next ${n} unread`, onClick: () => enqueue(toDownload.slice(0, n).map((c) => c.id)) })),
        { icon: "down", label: `All unread (${toDownload.length})`, onClick: () => enqueue(toDownload.map((c) => c.id)) },
        { icon: "down", label: "Every chapter", onClick: () => enqueue(asc.filter((c) => !c.isDownloaded).map((c) => c.id)) },
      ]} />
      <Menu at={more} onClose={() => setMore(null)} items={[
        { icon: "tag", label: "Edit categories", onClick: () => setSheet("categories") },
        tracking && { icon: "link", label: "Tracking", onClick: () => setSheet("tracking") },
        { icon: "migrate", label: "Migrate to another source", onClick: () => nav(`/comics/migrate/${mid}`) },
        { icon: "check", label: "Mark all as read", onClick: () => run(M.updateChapters, { ids: all.filter((c) => !c.isRead).map((c) => c.id), patch: { isRead: true } }, "Marked all as read.") },
        m.realUrl && { icon: "external", label: "Open in browser", onClick: () => window.open(m.realUrl, "_blank", "noopener") },
        m.inLibrary && { icon: "trash", label: "Remove from library", tone: "bad", onClick: () => run(M.setInLibrary, { id: mid, on: false }, "Removed from your library.") },
      ]} />
      <Sheet open={sheet === "filter"} onClose={() => setSheet(null)} title="Chapters">
        <label className="caps">Show</label>
        <div className="chips wrap">{FILTERS.map(([v, l]) => <Chip key={v} label={l} active={filter === v} onClick={() => setFilter(v)}
          count={v === "all" ? all.length : v === "new" ? m.unreadCount : v === "server" ? m.downloadCount : all.filter((c) => c.isBookmarked).length} />)}</div>
        <label className="caps">Order</label>
        <Segmented options={[{ value: "new", label: "Newest first" }, { value: "old", label: "Oldest first" }]} value={order} onChange={setOrder} label="Order" />
      </Sheet>
      <CategorySheet open={sheet === "categories"} onClose={() => setSheet(null)} ids={[mid]} categories={(cats.data?.categories.nodes || []).filter((c) => !c.default)}
        membership={Object.fromEntries(m.categories.nodes.map((c) => [c.id, 1]))} onDone={() => { setSheet(null); manga.reload(); }} />
      <TrackingSheet open={sheet === "tracking"} onClose={() => setSheet(null)} trackers={trackers.data?.trackers.nodes || []} records={m.trackRecords?.nodes || []} />
    </div>
  );
}

// Touch: a long press starts selecting. Mouse: right-click opens the chapter menu.
// Memoised: only rows whose chapter, download state or selection changed redraw.
const Chapter = memo(function Chapter({ c, q, selected, source, onOpen, onSelect, onMenu, onDownload }) {
  const st = chapterStatus(c, q);
  const timer = useRef(null), held = useRef(false);
  const progress = !c.isRead && c.lastPageRead > 0 && c.pageCount > 0 ? `page ${c.lastPageRead + 1} of ${c.pageCount}` : "";
  return (
    <div className={`chapter${selected ? " sel" : ""}${c.isRead ? " read" : ""}`} aria-selected={selected || undefined}
      onTouchStart={() => { held.current = false; timer.current = setTimeout(() => { held.current = true; onSelect(c.id); }, 450); }}
      onTouchMove={() => clearTimeout(timer.current)} onTouchEnd={() => clearTimeout(timer.current)}
      onContextMenu={(e) => { e.preventDefault(); if (!held.current) onMenu({ x: e.clientX, y: e.clientY }, c); }}>
      <button type="button" className="chapter-hit" onClick={() => { if (held.current) { held.current = false; return; } onOpen(c.id); }}>
        <span className="row-title">{c.isBookmarked && <Icon name="bookmark" size={14} className="accent" />} {chapterLabel(c)}</span>
        <span className="row-sub">{[c.scanlator || source, timeAgo(c.uploadDate)].filter(Boolean).join(" · ")}{progress && <> · <span className="accent">{progress}</span></>}</span>
      </button>
      <button type="button" className={`status ${st.tone}`} onClick={!c.isDownloaded && !q ? () => onDownload(c.id) : undefined} aria-label={st.label} title={st.label}>
        <span className="hide-phone">{st.label === "Not downloaded" ? "" : st.label}</span><span className="only-phone">{st.short}</span><Icon name={st.icon} size={18} />
      </button>
    </div>
  );
});

function TrackingSheet({ open, onClose, trackers, records }) {
  const nav = useNavigate();
  return (
    <Sheet open={open} onClose={onClose} title="Tracking">
      {trackers.map((t) => {
        const rec = records.find((r) => r.trackerId === t.id);
        return <Row key={t.id} mono={t.name.slice(0, 2).toUpperCase()} title={t.name} sub={rec ? `${rec.title} · read ${rec.lastChapterRead}` : t.isLoggedIn ? "Signed in · not linked to this series" : "Not signed in"}
          button={t.isLoggedIn ? undefined : "Sign in"} onButton={() => (t.authUrl ? connectTracker(t) : nav("/settings/tracking"))} />;
      })}
      <p className="sub">Optional. Tracking sends your chapter count to these sites; Tachivel works fine without it.</p>
    </Sheet>
  );
}
