// Comics library (Figma V1 / L7 / L8, phone P1 / M8 / M9): categories, unread and downloaded badges, display options, select mode.
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { gql, Q, M } from "../lib/gql.js";
import { Button, Chip, ComicCard, Empty, ErrorNote, IconButton, Menu, Row, Segmented, Sheet, Spinner, Thumb, Toggle, timeAgo, useLongPress } from "../ui/kit.jsx";
import { Icon } from "../ui/icons.jsx";
import { ModeSwitch } from "../shell/Shell.jsx";
import { useGql, useComicPrefs, num } from "./data.js";

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
  useEffect(() => { if (!running) return; const t = setInterval(() => { upd.reload(); all.reload(); }, 3000); return () => clearInterval(t); }, [running]); // eslint-disable-line

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

  // Refresh = ask the server to check this category's series for new chapters, and say what happened.
  const [check, setCheck] = useState(null); // { phase: "running" | "done" | "error", text }
  async function refresh() {
    if (check?.phase === "running") return;
    const unread = (list) => list.reduce((n, m) => n + m.unreadCount, 0);
    const before = unread(mangas);
    const scope = cat > 0 ? categories.find((c) => c.id === cat)?.name : null;
    setCheck({ phase: "running", text: `Checking ${scope ? `“${scope}”` : "your library"} for new chapters…` });
    try {
      await gql(M.updateLibrary, { cats: cat > 0 ? [cat] : null });
      for (let i = 0; i < 600; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        const s = (await gql(Q.libraryUpdate)).libraryUpdateStatus.jobsInfo;
        if (s.totalJobs) setCheck({ phase: "running", text: `Checking ${s.finishedJobs} of ${s.totalJobs} series…` });
        if (!s.isRunning) break;
      }
      const fresh = (await gql(Q.libraryAll)).mangas.nodes;
      all.setData({ mangas: { nodes: fresh } });
      const gained = unread(fresh) - before;
      setCheck({ phase: "done", text: gained > 0 ? `${gained} new chapter${gained === 1 ? "" : "s"}.` : "Up to date: nothing new." });
      upd.reload();
      setTimeout(() => setCheck((c) => (c?.phase === "done" ? null : c)), 5000);
    } catch (e) { setCheck({ phase: "error", text: `Couldn't check: ${e.message.split("\n")[0].slice(0, 120)}` }); setTimeout(() => setCheck(null), 8000); }
  }
  const toggleSel = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n.size ? n : null; });
  async function bulk(kind) {
    const ids = [...sel];
    setBusy(kind);
    try {
      if (kind === "remove") { if (!confirm(`Remove ${ids.length} series from your library?`)) return; await gql(M.setInLibraryMany, { ids, on: false }); }
      if (kind === "read" || kind === "download") {
        for (const id of ids) {
          const ch = (await gql(Q.chapters, { id })).chapters.nodes;
          if (kind === "read") { const unread = ch.filter((c) => !c.isRead).map((c) => c.id); if (unread.length) await gql(M.updateChapters, { ids: unread, patch: { isRead: true } }); }
          else { const todo = ch.filter((c) => !c.isRead && !c.isDownloaded).map((c) => c.id); if (todo.length) gql(M.enqueue, { ids: todo }).catch(() => {}); }
        }
      }
      setSel(null); all.reload();
    } finally { setBusy(""); }
  }

  const longPress = useLongPress((at) => pressed.current && (sel ? toggleSel(pressed.current.id) : setMenu({ at, m: pressed.current })));
  const pressed = useRef(null);
  const longPressFor = (m) => ({ onPointerDown: () => { pressed.current = m; }, ...longPress });
  const badge = (m) => ({ unread: prefs.badges.unread ? m.unreadCount : 0, downloaded: prefs.badges.downloaded ? m.downloadCount : 0,
    meta: [m.latestUploadedChapter && `Ch ${num(m.latestUploadedChapter.chapterNumber)}`, prefs.badges.source !== false && m.source?.displayName?.replace(/\s*\(.*\)$/, "")].filter(Boolean).join(" · ") });

  return (
    <div className="page">
      {sel ? (
        <div className="selbar">
          <IconButton icon="close" label="Stop selecting" onClick={() => setSel(null)} />
          <b>{sel.size} selected</b>
          <button type="button" className="muted" onClick={() => setSel(new Set(shown.map((m) => m.id)))}>Select all</button>
          <span className="grow" />
          <Button small icon="tag" onClick={() => setCatSheet(true)}>Category</Button>
          <Button small icon="check" disabled={!!busy} onClick={() => bulk("read")}>Mark read</Button>
          <Button small icon="down" disabled={!!busy} onClick={() => bulk("download")}>Download new</Button>
          {sel.size === 1 && <Button small icon="migrate" onClick={() => nav(`/comics/migrate/${[...sel][0]}`)}>Migrate</Button>}
          <Button small kind="danger" icon="trash" disabled={!!busy} onClick={() => bulk("remove")}>Remove</Button>
        </div>
      ) : (
        <>
          <div className="page-head only-phone"><ModeSwitch compact /><span style={{ flex: 1 }} /><IconButton icon="search" label="Search sources" onClick={() => nav("/comics/search")} /><IconButton icon="refresh" label="Check for new chapters" className={check?.phase === "running" ? "spinning" : ""} onClick={refresh} /></div>
          <div className="page-head">
            <div className="grow"><h1>Comics</h1><p className="sub">{mangas.length} series · {withNew} with new chapters · {SORTS.find((x) => x.value === prefs.sort)?.label} {prefs.desc ? "↓" : "↑"}{filterCount ? ` · ${filterCount} filter${filterCount > 1 ? "s" : ""}` : ""} · {running ? `checking ${upd.data.libraryUpdateStatus.jobsInfo.finishedJobs} of ${upd.data.libraryUpdateStatus.jobsInfo.totalJobs}…` : lastCheck ? `checked ${timeAgo(lastCheck)}` : "not checked yet"}</p></div>
            <label className="search hide-phone" style={{ width: 280 }}><Icon name="search" size={16} className="muted" /><input placeholder="Search your library" value={q} onChange={(e) => setQ(e.target.value)} /></label>
            <Button className="hide-phone" icon="refresh" onClick={refresh} disabled={running || check?.phase === "running"}>{running || check?.phase === "running" ? "Checking…" : "Refresh"}</Button>
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
      <Menu at={menu?.at} onClose={() => setMenu(null)} items={menu ? [
        { icon: "select", label: "Select", onClick: () => setSel(new Set([menu.m.id])) },
        { icon: "play", label: "Open", onClick: () => nav(`/comics/series/${menu.m.id}`) },
        { icon: "migrate", label: "Migrate", onClick: () => nav(`/comics/migrate/${menu.m.id}`) },
        { icon: "trash", label: "Remove from library", tone: "bad", onClick: async () => { await gql(M.setInLibrary, { id: menu.m.id, on: false }); all.reload(); } },
      ] : []} />
      <Sheet open={display} onClose={() => setDisplay(false)} title="Display">
        <label className="search only-phone"><Icon name="search" size={16} className="muted" /><input placeholder="Search your library" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <label className="caps">Layout</label>
        <Segmented options={LAYOUTS} value={prefs.layout} onChange={(layout) => setPrefs({ layout })} label="Layout" />
        {prefs.layout !== "list" && <>
          <label className="caps">Covers per row{isPhone() ? " (this phone)" : " (wide screens)"}</label>
          {isPhone()
            ? <Segmented options={[2, 3, 4, 5].map((n) => ({ value: n, label: String(n) }))} value={prefs.cols?.phone || 3} onChange={(n) => setPrefs({ cols: { ...prefs.cols, phone: n } })} label="Covers per row" />
            : <Segmented options={[{ value: 0, label: "Auto" }, ...[4, 5, 6, 7, 8].map((n) => ({ value: n, label: String(n) }))]} value={prefs.cols?.wide || 0} onChange={(n) => setPrefs({ cols: { ...prefs.cols, wide: n } })} label="Covers per row" />}
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
      {check && <div className={`toast ${check.phase}`} role="status">{check.phase === "running" && <span className="dot-spin" aria-hidden />}{check.text}</div>}
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
