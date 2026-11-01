// Comics library (Figma V1 / L7 / L8, phone P1 / M8 / M9): categories, unread and downloaded badges, display options, select mode.
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { gql, Q, M } from "../lib/gql.js";
import { AppBar, Button, Chip, ComicCard, Empty, ErrorNote, IconButton, Menu, Row, Segmented, Sheet, Spinner, Thumb, timeAgo, useLongPress, friendlyError } from "../ui/kit.jsx";
import { Icon } from "../ui/icons.jsx";
import { ModeSwitch } from "../shell/Shell.jsx";
import { useGql, useComicPrefs, num } from "./data.js";
import { UPDATE_STARTED } from "./UpdateBar.jsx";

const SORTS = [{ value: "latest", label: "Latest chapter" }, { value: "read", label: "Last read" }, { value: "title", label: "A–Z" },
  { value: "unread", label: "Unread" }, { value: "total", label: "Total chapters" }, { value: "added", label: "Date added" }];
const LAYOUTS = [{ value: "compact", label: "Compact" }, { value: "comfortable", label: "Comfortable" }, { value: "cover", label: "Cover only" }, { value: "list", label: "List" }];
// Three-way filters, like Mihon: tap cycles any → only → hide.
const FILTERS = [["unread", "Unread", (m) => m.unreadCount > 0], ["downloaded", "Downloaded", (m) => m.downloadCount > 0], ["started", "Started", (m) => !!m.lastReadChapter],
  ["bookmarked", "Bookmarked", (m) => m.bookmarkCount > 0], ["completed", "Completed", (m) => m.status === "COMPLETED"]];
const NEXT = { undefined: "only", only: "hide", hide: undefined };
const isPhone = () => typeof matchMedia !== "undefined" && matchMedia("(max-width: 700px)").matches;

export default function ComicsLibrary() {
  const nav = useNavigate();
  const [prefs, setPrefs] = useComicPrefs();
  const cats = useGql(Q.categories);
  const all = useGql(Q.libraryAll);
  const upd = useGql(Q.libraryUpdate);
  const [cat, setCat] = useState(() => Number(sessionStorage.getItem("tachivel:cat") ?? -1));
  const [q, setQ] = useState("");
  const [display, setDisplay] = useState(false);
  const [sel, setSel] = useState(null); // Set of manga ids while selecting
  const [menu, setMenu] = useState(null);
  const [catSheet, setCatSheet] = useState(false);
  const [busy, setBusy] = useState("");
  const [searching, setSearching] = useState(false);
  const [toast, setToast] = useState("");

  const categories = (cats.data?.categories.nodes || []).filter((c) => !(c.default && c.mangas.totalCount === 0));
  useEffect(() => { if (cat === -1 && categories.length) setCat(categories[0].id); }, [categories, cat]);
  useEffect(() => { sessionStorage.setItem("tachivel:cat", cat); }, [cat]);
  // Keep the current category tab in view, sideways only, when it changes.
  const tabsRef = useRef(null);
  useEffect(() => {
    const strip = tabsRef.current, tab = strip?.querySelector(`[data-cat="${cat}"]`);
    if (tab) strip.scrollTo({ left: tab.offsetLeft - strip.clientWidth / 2 + tab.clientWidth / 2, behavior: "smooth" });
  }, [cat, categories.length]);

  // While a library check runs on the server, poll its progress.
  const running = upd.data?.libraryUpdateStatus.jobsInfo.isRunning;
  // The library itself reloads once when the check ends (UpdateBar fires tachivel:pull), not every few seconds.
  useEffect(() => { if (!running) return; const t = setInterval(() => upd.reload(), 3000); return () => clearInterval(t); }, [running]); // eslint-disable-line

  const mangas = all.data?.mangas.nodes || [];
  const shown = useMemo(() => {
    let list = mangas.filter((m) => (cat === 0 ? !m.categories.nodes.length : m.categories.nodes.some((c) => c.id === cat)) || categories.length <= 1);
    if (q) list = list.filter((m) => m.title.toLowerCase().includes(q.toLowerCase()));
    for (const [key, , test] of FILTERS) {
      const f = prefs.filter[key];
      // Old saved prefs used true for "only".
      if (f === "only" || f === true) list = list.filter(test);
      if (f === "hide") list = list.filter((m) => !test(m));
    }
    const value = { latest: (m) => Number(m.latestUploadedChapter?.uploadDate || 0), read: (m) => Number(m.lastReadChapter?.lastReadAt || 0), unread: (m) => m.unreadCount,
      total: (m) => m.chapters?.totalCount || 0, added: (m) => Number(m.inLibraryAt || 0) }[prefs.sort];
    const dir = prefs.desc ? -1 : 1;
    return [...list].sort(prefs.sort === "title" ? (a, b) => a.title.localeCompare(b.title) * (prefs.desc ? -1 : 1) : (a, b) => (value(a) - value(b)) * dir || a.title.localeCompare(b.title));
  }, [mangas, cat, q, prefs.filter, prefs.sort, prefs.desc, categories.length]);
  const cols = isPhone() ? prefs.cols?.phone || 3 : prefs.cols?.wide || 0;
  const gridStyle = cols ? { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` } : prefs.layout === "comfortable" ? undefined : undefined;
  const filterCount = FILTERS.filter(([k]) => prefs.filter[k]).length;
  const count = (id) => mangas.filter((m) => (id === 0 ? !m.categories.nodes.length : m.categories.nodes.some((c) => c.id === id))).length;
  const withNew = mangas.filter((m) => m.unreadCount > 0).length;
  const lastCheck = Number(upd.data?.lastUpdateTimestamp?.timestamp || 0);

  // Refresh = ask the server to check this category's series for new chapters. The update strip (UpdateBar) shows progress and Cancel.
  const [check, setCheck] = useState(null); // only for a failure to start
  async function refresh() {
    if (running) return;
    try { await gql(M.updateLibrary, { cats: cat > 0 ? [cat] : null }); dispatchEvent(new Event(UPDATE_STARTED)); upd.reload(); }
    catch (e) { setCheck({ phase: "error", text: `Couldn't start the check: ${friendlyError(e)}` }); setTimeout(() => setCheck(null), 8000); }
  }
  const toggleSel = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n.size ? n : null; });
  const say = (t) => { setToast(t); setTimeout(() => setToast(""), 3500); };
  // Bulk actions on the selected series. Chapter lists load in parallel; one request per change.
  async function bulk(kind) {
    const ids = [...sel];
    if (kind === "remove" && !confirm(`Remove ${ids.length} series from your library? Their downloads stay on the server.`)) return;
    setBusy(kind);
    try {
      if (kind === "remove") await gql(M.setInLibraryMany, { ids, on: false });
      else {
        const chapters = (await Promise.all(ids.map((id) => gql(Q.chapters, { id })))).flatMap((r) => r.chapters.nodes);
        const pick = { read: (c) => !c.isRead, unread: (c) => c.isRead || c.lastPageRead > 0, download: (c) => !c.isRead && !c.isDownloaded, deleteDownloads: (c) => c.isDownloaded }[kind];
        const todo = chapters.filter(pick).map((c) => c.id);
        if (todo.length) {
          if (kind === "read") await gql(M.updateChapters, { ids: todo, patch: { isRead: true } });
          if (kind === "unread") await gql(M.updateChapters, { ids: todo, patch: { isRead: false, lastPageRead: 0 } });
          if (kind === "download") gql(M.enqueue, { ids: todo }).catch(() => {});
          if (kind === "deleteDownloads") await gql(M.deleteDownloads, { ids: todo });
        }
        say(!todo.length ? "Nothing to change." : { read: `Marked ${todo.length} chapters read.`, unread: `Marked ${todo.length} chapters unread.`, download: `Queued ${todo.length} chapters for download.`, deleteDownloads: `Deleted ${todo.length} downloaded chapters.` }[kind]);
      }
      setSel(null); all.reload();
    } catch (e) { say(friendlyError(e)); } finally { setBusy(""); }
  }

  const longPress = useLongPress((at) => pressed.current && (sel ? toggleSel(pressed.current.id) : setMenu({ at, m: pressed.current })));
  const pressed = useRef(null);
  const longPressFor = (m) => ({ onPointerDown: () => { pressed.current = m; }, ...longPress });
  const badge = (m) => ({ unread: prefs.badges.unread ? m.unreadCount : 0, downloaded: prefs.badges.downloaded ? m.downloadCount : 0,
    meta: [m.latestUploadedChapter && `Ch ${num(m.latestUploadedChapter.chapterNumber)}`, prefs.badges.source !== false && m.source?.displayName?.replace(/\s*\(.*\)$/, "")].filter(Boolean).join(" · ") });

  return (
    <div className="page">
      {sel ? (
        <AppBar back={false} title={`${sel.size} selected`} actions={<>
          <IconButton icon="select" label="Select all" onClick={() => setSel(new Set(shown.map((m) => m.id)))} />
          <IconButton icon="invert" label="Invert selection" onClick={() => setSel((s) => { const n = new Set(shown.filter((m) => !s.has(m.id)).map((m) => m.id)); return n.size ? n : null; })} />
          <IconButton icon="close" label="Stop selecting" onClick={() => setSel(null)} />
        </>} />
      ) : (
        <>
          <div className="page-head only-phone">
            {searching ? <>
              <label className="search grow"><Icon name="search" size={16} className="muted" /><input autoFocus placeholder="Search your library" value={q} onChange={(e) => setQ(e.target.value)} enterKeyHint="search" /></label>
              <IconButton icon="close" label="Close search" onClick={() => { setSearching(false); setQ(""); }} />
            </> : <>
              <ModeSwitch compact /><span style={{ flex: 1 }} />
              <IconButton icon="search" label="Search your library" onClick={() => setSearching(true)} />
              <IconButton icon="refresh" label="Check for new chapters" className={running ? "spinning" : ""} onClick={refresh} />
              <IconButton icon="filter" label="Display" onClick={() => setDisplay(true)} />
            </>}
          </div>
          <div className="page-head hide-phone">
            <div className="grow"><h1>Comics</h1><p className="sub">{mangas.length} series · {withNew} with new chapters · {SORTS.find((x) => x.value === prefs.sort)?.label} {prefs.desc ? "↓" : "↑"}{filterCount ? ` · ${filterCount} filter${filterCount > 1 ? "s" : ""}` : ""} · {running ? `checking ${upd.data.libraryUpdateStatus.jobsInfo.finishedJobs} of ${upd.data.libraryUpdateStatus.jobsInfo.totalJobs}…` : lastCheck ? `checked ${timeAgo(lastCheck)}` : "not checked yet"}</p></div>
            <label className="search" style={{ width: 280 }}><Icon name="search" size={16} className="muted" /><input placeholder="Search your library" value={q} onChange={(e) => setQ(e.target.value)} /></label>
            <Button icon="refresh" onClick={refresh} disabled={running}>{running ? "Checking…" : "Refresh"}</Button>
            <Button kind="soft" icon="filter" onClick={() => setDisplay(true)}>Display</Button>
          </div>
        </>
      )}
      {categories.length > 1 && prefs.tabs?.show !== false && (
        <div className="cat-tabs" role="tablist" aria-label="Categories" ref={tabsRef}>
          {categories.map((c) => <button key={c.id} type="button" role="tab" aria-selected={cat === c.id} className={cat === c.id ? "on" : ""} onClick={() => setCat(c.id)} data-cat={c.id}>
            {c.default ? "Uncategorised" : c.name}{prefs.tabs?.counts !== false && <span className="chip-n">{count(c.id)}</span>}</button>)}
        </div>
      )}
      <ErrorNote error={all.error} onRetry={all.reload} />
      {q.trim() && <Row icon="globe" title={`Search sources for “${q.trim()}”`} sub={shown.length ? `${shown.length} in your library` : "Nothing in your library matches"} chevron onClick={() => nav(`/comics/search?q=${encodeURIComponent(q.trim())}`)} />}
      {all.loading && !all.data ? <Spinner /> : !mangas.length ? (
        <Empty icon="comic" title="Your comics library is empty" action={<div className="hero-actions"><Button kind="accent" icon="browse" onClick={() => nav("/comics/browse")}>Browse sources</Button><Button icon="backup" onClick={() => nav("/settings/backup")}>Restore a backup</Button></div>}>
          Add series from your sources, or bring your whole library over from a backup.
        </Empty>
      ) : prefs.layout === "list" ? (
        <div className="list">
          {shown.map((m) => {
            const b = badge(m);
            return (
              <div key={m.id} className={`srow lib-row${sel?.has(m.id) ? " selected" : ""}`} {...longPressFor(m)}>
                <button type="button" className="lib-row-hit" onClick={() => (sel ? toggleSel(m.id) : nav(`/comics/series/${m.id}`))}>
                  <Thumb src={m.thumbnailUrl} title={m.title} />
                  <span className="row-text"><span className="row-title">{m.title}</span>{b.meta && <span className="row-sub">{b.meta}</span>}</span>
                </button>
                {b.unread > 0 && <span className="badge-inline">{b.unread}</span>}
                {b.downloaded > 0 && <span className="srow-right"><Icon name="down" size={14} />{b.downloaded}</span>}
                {prefs.continueBtn && m.firstUnreadChapter && !sel && <IconButton icon="play" label={`Continue ${m.title}`} className="lib-play" size={16} onClick={() => nav(`/comics/read/${m.firstUnreadChapter.id}`)} />}
              </div>
            );
          })}
        </div>
      ) : (
        <div className={`grid layout-${prefs.layout}`} style={gridStyle}>
          {shown.map((m) => <ComicCard key={m.id} manga={m} badge={badge(m)} selected={sel?.has(m.id)} dim={sel && !sel.has(m.id)} layout={prefs.layout}
            onPlay={prefs.continueBtn && m.firstUnreadChapter && !sel ? () => nav(`/comics/read/${m.firstUnreadChapter.id}`) : null}
            onClick={() => (sel ? toggleSel(m.id) : nav(`/comics/series/${m.id}`))} menu={(at) => (sel ? toggleSel(m.id) : setMenu({ at, m }))} />)}
        </div>
      )}
      {sel && (
        <nav className="action-bar" aria-label="Selected series">
          <IconButton icon="tag" label="Categories" onClick={() => setCatSheet(true)} />
          <IconButton icon="check" label="Mark read" disabled={!!busy} className={busy === "read" ? "spinning" : ""} onClick={() => bulk("read")} />
          <IconButton icon="incognito" label="Mark unread" disabled={!!busy} onClick={() => bulk("unread")} />
          <IconButton icon="down" label="Download unread" disabled={!!busy} onClick={() => bulk("download")} />
          <IconButton icon="storage" label="Delete downloads" disabled={!!busy} onClick={() => bulk("deleteDownloads")} />
          <IconButton icon="migrate" label="Migrate" disabled={sel.size !== 1} onClick={() => nav(`/comics/migrate/${[...sel][0]}`)} />
          <IconButton icon="trash" label="Remove from library" className="bad" disabled={!!busy} onClick={() => bulk("remove")} />
        </nav>
      )}
      {toast && !check && <div className="toast" role="status">{toast}</div>}
      <Menu at={menu?.at} onClose={() => setMenu(null)} items={menu ? [
        { icon: "select", label: "Select", onClick: () => setSel(new Set([menu.m.id])) },
        { icon: "play", label: "Open", onClick: () => nav(`/comics/series/${menu.m.id}`) },
        { icon: "migrate", label: "Migrate", onClick: () => nav(`/comics/migrate/${menu.m.id}`) },
        { icon: "trash", label: "Remove from library", tone: "bad", onClick: async () => { await gql(M.setInLibrary, { id: menu.m.id, on: false }); all.reload(); } },
      ] : []} />
      <Sheet open={display} onClose={() => setDisplay(false)} title="Display">
        <label className="caps">Layout</label>
        <Segmented options={LAYOUTS} value={prefs.layout} onChange={(layout) => setPrefs({ layout })} label="Layout" />
        {prefs.layout !== "list" && <>
          <label className="caps">Covers per row{isPhone() ? " (this phone)" : " (wide screens)"}</label>
          {isPhone()
            ? <Segmented options={[2, 3, 4, 5].map((n) => ({ value: n, label: String(n) }))} value={prefs.cols?.phone || 3} onChange={(n) => setPrefs({ cols: { ...prefs.cols, phone: n } })} label="Covers per row" />
            : <Segmented options={[{ value: 0, label: "Auto" }, ...[4, 5, 6, 7, 8, 9, 10].map((n) => ({ value: n, label: String(n) }))]} value={prefs.cols?.wide || 0} onChange={(n) => setPrefs({ cols: { ...prefs.cols, wide: n } })} label="Covers per row" />}
        </>}
        <label className="caps">Sort</label>
        <div className="chips wrap">{SORTS.map((o) => <Chip key={o.value} label={`${o.label}${prefs.sort === o.value ? (prefs.desc ? " ↓" : " ↑") : ""}`} active={prefs.sort === o.value}
          onClick={() => (prefs.sort === o.value ? setPrefs({ desc: !prefs.desc }) : setPrefs({ sort: o.value, desc: o.value !== "title" }))} />)}</div>
        <label className="caps" title="Tap to cycle: any → only → hide">Filter <span className="sub" style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>tap: any → only → hide</span></label>
        <div className="chips wrap">{FILTERS.map(([k, label]) => { const v = prefs.filter[k] === true ? "only" : prefs.filter[k]; return <Chip key={k} label={`${v === "hide" ? "Hide " : v === "only" ? "Only " : ""}${label.toLowerCase()}`} active={!!v}
          onClick={() => setPrefs({ filter: { ...prefs.filter, [k]: NEXT[v] } })} />; })}</div>
        <label className="caps">Badges and extras</label>
        <Row title="Unread count" toggle={prefs.badges.unread} onToggle={(v) => setPrefs({ badges: { ...prefs.badges, unread: v } })} />
        <Row title="Downloaded count" toggle={prefs.badges.downloaded} onToggle={(v) => setPrefs({ badges: { ...prefs.badges, downloaded: v } })} />
        <Row title="Source name" toggle={prefs.badges.source !== false} onToggle={(v) => setPrefs({ badges: { ...prefs.badges, source: v } })} />
        <Row title="Continue reading button" sub="A play button on each cover opens the next unread chapter" toggle={!!prefs.continueBtn} onToggle={(v) => setPrefs({ continueBtn: v })} />
        <Row title="Category tabs" toggle={prefs.tabs?.show !== false} onToggle={(v) => setPrefs({ tabs: { ...prefs.tabs, show: v } })} />
        <Row title="Number of series on each tab" toggle={prefs.tabs?.counts !== false} onToggle={(v) => setPrefs({ tabs: { ...prefs.tabs, counts: v } })} />
      </Sheet>
      {check && <div className="toast error" role="status">{check.text}</div>}
      <CategorySheet open={catSheet} onClose={() => setCatSheet(false)} ids={sel ? [...sel] : []} categories={(cats.data?.categories.nodes || []).filter((c) => !c.default)}
        membership={sel ? mangas.filter((m) => sel.has(m.id)).reduce((acc, m) => { m.categories.nodes.forEach((c) => { acc[c.id] = (acc[c.id] || 0) + 1; }); return acc; }, {}) : {}} onDone={() => { setCatSheet(false); setSel(null); all.reload(); cats.reload(); }} />
    </div>
  );
}

// membership: category id → how many of the chosen series are already in it. Only categories you
// actually change are sent, so series never lose categories you didn't touch.
export function CategorySheet({ open, onClose, ids, categories, membership = {}, onDone }) {
  const initial = () => Object.fromEntries(categories.map((c) => [c.id, !membership[c.id] ? "off" : membership[c.id] >= ids.length ? "on" : "mixed"]));
  const [state, setState] = useState(initial);
  useEffect(() => { if (open) setState(initial()); }, [open]); // eslint-disable-line
  async function save() {
    const add = [], remove = [];
    for (const c of categories) {
      const now = state[c.id], was = initial()[c.id];
      if (now === was || now === "mixed") continue;
      (now === "on" ? add : remove).push(c.id);
    }
    if (add.length || remove.length) await gql(M.mangasCategories, { ids, patch: { addToCategories: add, removeFromCategories: remove } });
    onDone();
  }
  async function create() {
    const name = prompt("New category name");
    if (name) { const r = await gql(M.createCategory, { name }); categories.push(r.createCategory.category); setState((s) => ({ ...s, [r.createCategory.category.id]: "on" })); }
  }
  return (
    <Sheet open={open} onClose={onClose} title={ids.length > 1 ? `Categories for ${ids.length} series` : "Categories"} actions={<><Button kind="ghost" onClick={onClose}>Cancel</Button><Button kind="accent" onClick={save}>Save</Button></>}>
      {categories.map((c) => <Row key={c.id} title={c.name} sub={state[c.id] === "mixed" ? `Some of them (${membership[c.id]} of ${ids.length}) · tap to set for all` : undefined}
        toggle={state[c.id] === "on"} onToggle={(on) => setState((s) => ({ ...s, [c.id]: on ? "on" : "off" }))} />)}
      <Button kind="soft" small icon="plus" onClick={create}>New category</Button>
    </Sheet>
  );
}
