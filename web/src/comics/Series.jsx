// Series page (Figma V2 / L9 / L10, phone P2 / M10 / M15): about, continue, chapter list with selection and download states.
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { gql, Q, M } from "../lib/gql.js";
import { Button, Chip, Cover, ErrorNote, IconButton, Menu, Progress, Row, Sheet, Spinner, useLongPress, timeAgo, chapterLabel } from "../ui/kit.jsx";
import { Icon } from "../ui/icons.jsx";
import { useGql, useDownloads, chapterStatus, STATUS, num } from "./data.js";
import { CategorySheet } from "./Library.jsx";

export default function Series() {
  const { id } = useParams();
  const mid = Number(id);
  const nav = useNavigate();
  const manga = useGql(Q.manga, { id: mid }, [mid]);
  const chapters = useGql(Q.chapters, { id: mid }, [mid]);
  const cats = useGql(Q.categories);
  const dl = useDownloads();
  const [filter, setFilter] = useState("all");
  const [oldestFirst, setOldestFirst] = useState(false);
  const [sel, setSel] = useState(null);
  const [menu, setMenu] = useState(null);
  const [more, setMore] = useState(null);
  const [sheet, setSheet] = useState(null); // "categories" | "tracking"
  const [refreshing, setRefreshing] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const m = manga.data?.manga;
  const all = chapters.data?.chapters.nodes || [];
  const list = useMemo(() => {
    let l = all;
    if (filter === "new") l = l.filter((c) => !c.isRead);
    if (filter === "server") l = l.filter((c) => c.isDownloaded);
    if (filter === "bookmarked") l = l.filter((c) => c.isBookmarked);
    return oldestFirst ? [...l].reverse() : l;
  }, [all, filter, oldestFirst]);
  const readCount = all.filter((c) => c.isRead).length;
  // Continue: the oldest unread chapter after the last one you read (chapters come newest first).
  const next = useMemo(() => { const asc = [...all].reverse(); const lastRead = asc.map((c) => c.isRead).lastIndexOf(true); return asc[lastRead + 1] || asc.find((c) => !c.isRead) || asc[asc.length - 1]; }, [all]);
  const inProgress = all.find((c) => !c.isRead && c.lastPageRead > 0);
  const resume = inProgress || next;

  async function refresh() {
    setRefreshing(true);
    try { await gql(M.refreshManga, { id: mid }); manga.reload(); chapters.reload(); } catch (e) { alert(e.message); } finally { setRefreshing(false); }
  }
  const run = async (query, vars) => { await gql(query, vars).catch((e) => alert(e.message)); chapters.reload(); manga.reload(); dl.refresh(); };
  const enqueue = (ids) => { gql(M.enqueue, { ids }).catch(() => {}); setTimeout(() => dl.refresh(), 800); };
  const toggle = (cid) => setSel((s) => { const n = new Set(s); n.has(cid) ? n.delete(cid) : n.add(cid); return n.size ? n : null; });
  const markBelow = (c) => { const idx = all.findIndex((x) => x.id === c.id); run(M.updateChapters, { ids: all.slice(idx).filter((x) => !x.isRead).map((x) => x.id), patch: { isRead: true } }); };

  if (manga.error) return <div className="page"><ErrorNote error={manga.error} onRetry={manga.reload} /></div>;
  if (!m) return <Spinner />;

  return (
    <div className="page">
      <div className="series">
        <aside className="series-about">
          <button type="button" className="row-sub actions" onClick={() => nav(-1)}><Icon name="back" size={18} />Back</button>
          <div className="series-head">
            <Cover src={m.thumbnailUrl} title={m.title} />
            <div style={{ display: "grid", gap: 8, minWidth: 0 }}>
              <h1>{m.title}</h1>
              <p className="sub">{[m.source?.displayName, STATUS[m.status], m.author].filter(Boolean).join(" · ")}</p>
            </div>
          </div>
          {all.length > 0 && <div style={{ display: "grid", gap: 8 }}><Progress value={readCount / all.length} /><p className="sub">Read {readCount} of {all.length} · {m.unreadCount} new · {m.downloadCount} on the server</p></div>}
          <div className="hero-actions">
            {resume && <Button kind="accent" icon="play" onClick={() => nav(`/comics/read/${resume.id}`)}>{readCount ? "Continue" : "Start"} · Ch {num(resume.chapterNumber)}</Button>}
            {!m.inLibrary && <Button kind="accent" icon="plus" onClick={() => run(M.setInLibrary, { id: mid, on: true })}>Add to library</Button>}
            <Button icon="down" onClick={() => enqueue([...all].reverse().filter((c) => !c.isRead && !c.isDownloaded).slice(0, 10).map((c) => c.id))}>Next 10</Button>
            <IconButton icon="more" label="More" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMore({ x: r.left, y: r.bottom + 4 }); }} />
          </div>
          {m.genre?.length > 0 && <div className="chips wrap">{m.genre.slice(0, 8).map((g) => <span key={g} className="chip" style={{ cursor: "default" }}>{g}</span>)}</div>}
          {m.description && <p className="sub" style={showAll ? {} : { display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }} onClick={() => setShowAll(!showAll)}>{m.description}</p>}
        </aside>

        <section style={{ display: "grid", gap: 12, minWidth: 0 }}>
          {sel ? (
            <div className="selbar">
              <IconButton icon="close" label="Stop selecting" onClick={() => setSel(null)} />
              <b>{sel.size} selected</b>
              <button type="button" className="muted" onClick={() => setSel(new Set(list.filter((c) => !c.isRead).map((c) => c.id)))}>Select all new</button>
              <span className="grow" />
              <Button small icon="check" onClick={() => { run(M.updateChapters, { ids: [...sel], patch: { isRead: true } }); setSel(null); }}>Mark read</Button>
              <Button small icon="bookmark" className="hide-phone" onClick={() => { run(M.updateChapters, { ids: [...sel], patch: { isBookmarked: true } }); setSel(null); }}>Bookmark</Button>
              <Button small icon="trash" className="hide-phone" onClick={() => { run(M.deleteDownloads, { ids: [...sel] }); setSel(null); }}>Delete downloads</Button>
              <Button small kind="accent" icon="down" onClick={() => { enqueue([...sel]); setSel(null); }}>Download {sel.size}</Button>
            </div>
          ) : (
            <div className="chips">
              <Chip label="All" count={all.length} active={filter === "all"} onClick={() => setFilter("all")} />
              <Chip label="New" count={m.unreadCount} active={filter === "new"} onClick={() => setFilter("new")} />
              <Chip label="On the server" count={m.downloadCount} active={filter === "server"} onClick={() => setFilter("server")} />
              <Chip label="Bookmarked" active={filter === "bookmarked"} onClick={() => setFilter("bookmarked")} />
              <span style={{ flex: 1 }} />
              <button type="button" className="sub" onClick={() => setOldestFirst(!oldestFirst)}>{oldestFirst ? "Oldest first" : "Newest first"}</button>
              <IconButton icon="select" label="Select chapters" onClick={() => setSel(new Set())} />
            </div>
          )}
          {chapters.loading && !chapters.data ? <Spinner /> : !all.length ? (
            <div className="note"><Icon name="info" /><span>No chapters yet. Refresh from the source to fetch them.</span><Button small icon="refresh" disabled={refreshing} onClick={refresh}>{refreshing ? "Fetching…" : "Refresh"}</Button></div>
          ) : (
            <div style={{ display: "grid", gap: 2 }}>
              {list.map((c) => <Chapter key={c.id} c={c} q={dl.byChapter[c.id]} sel={sel} source={m.source?.displayName}
                onOpen={() => (sel ? toggle(c.id) : nav(`/comics/read/${c.id}`))} onMenu={(at) => setMenu({ at, c })} onCheck={() => toggle(c.id)} onDownload={() => enqueue([c.id])} />)}
            </div>
          )}
        </section>
      </div>

      <Menu at={menu?.at} onClose={() => setMenu(null)} items={menu ? [
        { icon: "play", label: "Read", onClick: () => nav(`/comics/read/${menu.c.id}`) },
        !menu.c.isDownloaded && { icon: "down", label: "Download", onClick: () => enqueue([menu.c.id]) },
        { icon: "bookmark", label: menu.c.isBookmarked ? "Remove bookmark" : "Bookmark", onClick: () => run(M.updateChapters, { ids: [menu.c.id], patch: { isBookmarked: !menu.c.isBookmarked } }) },
        { icon: "check", label: menu.c.isRead ? "Mark as unread" : "Mark as read", onClick: () => run(M.updateChapters, { ids: [menu.c.id], patch: { isRead: !menu.c.isRead } }) },
        { icon: "check", label: "Mark everything below as read", onClick: () => markBelow(menu.c) },
        { icon: "select", label: "Select", onClick: () => setSel(new Set([menu.c.id])) },
        menu.c.isDownloaded && { icon: "trash", label: "Delete download", onClick: () => run(M.deleteDownloads, { ids: [menu.c.id] }) },
        m.realUrl && { icon: "external", label: "Open in browser", onClick: () => window.open(m.realUrl, "_blank", "noopener") },
      ] : []} />
      <Menu at={more} onClose={() => setMore(null)} items={[
        { icon: "refresh", label: refreshing ? "Refreshing…" : "Refresh from source", onClick: refresh },
        { icon: "tag", label: "Edit categories", onClick: () => setSheet("categories") },
        { icon: "link", label: "Tracking", onClick: () => setSheet("tracking") },
        { icon: "migrate", label: "Migrate", onClick: () => nav(`/comics/migrate/${mid}`) },
        m.realUrl && { icon: "external", label: "Open in browser", onClick: () => window.open(m.realUrl, "_blank", "noopener") },
        m.inLibrary && { icon: "trash", label: "Remove from library", tone: "bad", onClick: () => run(M.setInLibrary, { id: mid, on: false }) },
      ]} />
      <CategorySheet open={sheet === "categories"} onClose={() => setSheet(null)} ids={[mid]} categories={(cats.data?.categories.nodes || []).filter((c) => !c.default)}
        current={m.categories.nodes.map((c) => c.id)} onDone={() => { setSheet(null); manga.reload(); }} />
      <TrackingSheet open={sheet === "tracking"} onClose={() => setSheet(null)} records={m.trackRecords?.nodes || []} />
    </div>
  );
}

function Chapter({ c, q, sel, source, onOpen, onMenu, onCheck, onDownload }) {
  const lp = useLongPress(onMenu);
  const st = chapterStatus(c, q);
  const progress = !c.isRead && c.lastPageRead > 0 && c.pageCount > 0 ? ` · page ${c.lastPageRead + 1} of ${c.pageCount}` : "";
  return (
    <div className={`chapter${sel?.has(c.id) ? " sel" : ""}${c.isRead ? " read" : ""}`} {...lp}>
      {sel && <button type="button" className={`check${sel.has(c.id) ? " on" : ""}`} aria-label="Select" onClick={onCheck}>{sel.has(c.id) && <Icon name="check" size={14} />}</button>}
      <button type="button" className="row-text" style={{ textAlign: "left" }} onClick={onOpen}>
        <span className="row-title">{c.isBookmarked && <Icon name="bookmark" size={14} className="accent" />} {chapterLabel(c)}</span>
        <span className="row-sub">{[c.scanlator || source, timeAgo(c.uploadDate)].filter(Boolean).join(" · ")}{progress}</span>
      </button>
      <button type="button" className={`status ${st.tone}`} onClick={!c.isDownloaded && !q ? onDownload : undefined} aria-label={st.label} title={st.label}>
        <span className="hide-phone">{st.label === "Not downloaded" ? "" : st.label}</span><span className="only-phone">{st.short}</span><Icon name={st.icon} size={18} />
      </button>
    </div>
  );
}

function TrackingSheet({ open, onClose, records }) {
  const trackers = useGql(Q.trackers, {}, [open]);
  return (
    <Sheet open={open} onClose={onClose} title="Tracking">
      {(trackers.data?.trackers.nodes || []).map((t) => {
        const rec = records.find((r) => r.trackerId === t.id);
        return <Row key={t.id} mono={t.name.slice(0, 2).toUpperCase()} title={t.name} sub={rec ? `${rec.title} · read ${rec.lastChapterRead}` : t.isLoggedIn ? "Signed in · not linked to this series" : "Not signed in"}
          button={t.isLoggedIn ? undefined : "Sign in"} onButton={() => t.authUrl && window.open(t.authUrl, "_blank", "noopener")} />;
      })}
      <p className="sub">Optional. Tracking sends your chapter count to these sites; Tachivel works fine without it.</p>
    </Sheet>
  );
}
