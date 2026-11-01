// Comics library (Figma V1 / L7 / L8, phone P1 / M8 / M9): categories, unread and downloaded badges, display options, select mode.
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { gql, Q, M } from "../lib/gql.js";
import { Button, Chip, ComicCard, Empty, ErrorNote, IconButton, Menu, Row, Segmented, Sheet, Spinner, Toggle, timeAgo } from "../ui/kit.jsx";
import { Icon } from "../ui/icons.jsx";
import { ModeSwitch } from "../shell/Shell.jsx";
import { useGql, useComicPrefs, num } from "./data.js";

const SORTS = [{ value: "latest", label: "Latest chapter" }, { value: "read", label: "Last read" }, { value: "title", label: "A–Z" }, { value: "unread", label: "Unread" }];

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

  // While a library check runs on the server, poll its progress.
  const running = upd.data?.libraryUpdateStatus.jobsInfo.isRunning;
  useEffect(() => { if (!running) return; const t = setInterval(() => { upd.reload(); all.reload(); }, 3000); return () => clearInterval(t); }, [running]); // eslint-disable-line

  const mangas = all.data?.mangas.nodes || [];
  const shown = useMemo(() => {
    let list = mangas.filter((m) => (cat === 0 ? !m.categories.nodes.length : m.categories.nodes.some((c) => c.id === cat)) || categories.length <= 1);
    if (q) list = list.filter((m) => m.title.toLowerCase().includes(q.toLowerCase()));
    if (prefs.filter.unread) list = list.filter((m) => m.unreadCount > 0);
    if (prefs.filter.downloaded) list = list.filter((m) => m.downloadCount > 0);
    const latest = (m) => Number(m.latestUploadedChapter?.uploadDate || 0), read = (m) => Number(m.lastReadChapter?.lastReadAt || 0);
    const by = { latest: (a, b) => latest(b) - latest(a), read: (a, b) => read(b) - read(a), title: (a, b) => a.title.localeCompare(b.title), unread: (a, b) => b.unreadCount - a.unreadCount }[prefs.sort];
    return [...list].sort(by);
  }, [mangas, cat, q, prefs.filter, prefs.sort, categories.length]);
  const count = (id) => mangas.filter((m) => (id === 0 ? !m.categories.nodes.length : m.categories.nodes.some((c) => c.id === id))).length;
  const withNew = mangas.filter((m) => m.unreadCount > 0).length;
  const lastCheck = Number(upd.data?.lastUpdateTimestamp?.timestamp || 0);

  async function refresh() {
    await gql(M.updateLibrary, { cats: cat > 0 ? [cat] : null }).catch(() => {});
    upd.reload();
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

  const badge = (m) => ({ unread: prefs.badges.unread ? m.unreadCount : 0, downloaded: prefs.badges.downloaded ? m.downloadCount : 0, meta: [m.latestUploadedChapter && `Ch ${num(m.latestUploadedChapter.chapterNumber)}`, m.source?.displayName?.replace(/\s*\(.*\)$/, "")].filter(Boolean).join(" · ") });

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
          <div className="page-head only-phone"><ModeSwitch compact /><span style={{ flex: 1 }} /><IconButton icon="search" label="Search sources" onClick={() => nav("/comics/search")} /><IconButton icon="refresh" label="Check for new chapters" onClick={refresh} /></div>
          <div className="page-head">
            <div className="grow"><h1>Comics</h1><p className="sub">{mangas.length} series · {withNew} with new chapters · {running ? `checking ${upd.data.libraryUpdateStatus.jobsInfo.finishedJobs} of ${upd.data.libraryUpdateStatus.jobsInfo.totalJobs}…` : lastCheck ? `checked ${timeAgo(lastCheck)}` : "not checked yet"}</p></div>
            <label className="search hide-phone" style={{ width: 280 }}><Icon name="search" size={16} className="muted" /><input placeholder="Search your library" value={q} onChange={(e) => setQ(e.target.value)} /></label>
            <Button className="hide-phone" icon="refresh" onClick={refresh} disabled={running}>{running ? "Checking…" : "Refresh"}</Button>
            <Button kind="soft" icon="filter" onClick={() => setDisplay(true)}>Display</Button>
          </div>
        </>
      )}
      {categories.length > 1 && (
        <div className="chips">
          {categories.map((c) => <Chip key={c.id} label={c.default ? "Uncategorised" : c.name} count={count(c.id)} active={cat === c.id} onClick={() => setCat(c.id)} />)}
          <span style={{ flex: 1 }} />
          <span className="sub hide-phone">Sort: {SORTS.find((s) => s.value === prefs.sort)?.label}</span>
        </div>
      )}
      <ErrorNote error={all.error} onRetry={all.reload} />
      {all.loading && !all.data ? <Spinner /> : !mangas.length ? (
        <Empty icon="comic" title="Your comics library is empty" action={<div className="hero-actions"><Button kind="accent" icon="browse" onClick={() => nav("/comics/browse")}>Browse sources</Button><Button icon="backup" onClick={() => nav("/settings/backup")}>Restore a backup</Button></div>}>
          Add series from your sources, or bring your whole library over from a backup.
        </Empty>
      ) : prefs.layout === "list" ? (
        <div className="list">
          {shown.map((m) => <Row key={m.id} title={m.title} sub={badge(m).meta} value={m.unreadCount ? `${m.unreadCount} new` : ""} valueTone="accent" chevron selected={sel?.has(m.id)}
            onClick={() => (sel ? toggleSel(m.id) : nav(`/comics/series/${m.id}`))} />)}
        </div>
      ) : (
        <div className="grid" style={prefs.layout === "comfortable" ? { "--card-w": "190px" } : undefined}>
          {shown.map((m) => <ComicCard key={m.id} manga={m} badge={badge(m)} selected={sel?.has(m.id)} dim={sel && !sel.has(m.id)}
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
        <label className="caps">Layout</label>
        <Segmented options={[{ value: "covers", label: "Covers" }, { value: "comfortable", label: "Comfortable" }, { value: "list", label: "List" }]} value={prefs.layout} onChange={(layout) => setPrefs({ layout })} />
        <label className="caps">Sort</label>
        <Segmented options={SORTS} value={prefs.sort} onChange={(sort) => setPrefs({ sort })} />
        <label className="caps">Filter</label>
        <div className="chips wrap">
          <Chip label="Unread only" active={prefs.filter.unread} onClick={() => setPrefs({ filter: { ...prefs.filter, unread: !prefs.filter.unread } })} />
          <Chip label="Downloaded only" active={prefs.filter.downloaded} onClick={() => setPrefs({ filter: { ...prefs.filter, downloaded: !prefs.filter.downloaded } })} />
        </div>
        <label className="caps">Badges</label>
        <Row title="Unread count" toggle={prefs.badges.unread} onToggle={(v) => setPrefs({ badges: { ...prefs.badges, unread: v } })} />
        <Row title="Downloaded count" toggle={prefs.badges.downloaded} onToggle={(v) => setPrefs({ badges: { ...prefs.badges, downloaded: v } })} />
        <label className="search only-phone"><Icon name="search" size={16} className="muted" /><input placeholder="Search your library" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      </Sheet>
      <CategorySheet open={catSheet} onClose={() => setCatSheet(false)} ids={sel ? [...sel] : []} categories={(cats.data?.categories.nodes || []).filter((c) => !c.default)} onDone={() => { setCatSheet(false); setSel(null); all.reload(); cats.reload(); }} />
    </div>
  );
}

export function CategorySheet({ open, onClose, ids, categories, current = [], onDone }) {
  const [chosen, setChosen] = useState(new Set(current));
  useEffect(() => { if (open) setChosen(new Set(current)); }, [open]); // eslint-disable-line
  async function save() {
    const add = [...chosen], remove = categories.map((c) => c.id).filter((id) => !chosen.has(id));
    await gql(M.mangasCategories, { ids, patch: { addToCategories: add, removeFromCategories: remove } });
    onDone();
  }
  async function create() {
    const name = prompt("New category name");
    if (name) { const r = await gql(M.createCategory, { name }); setChosen((s) => new Set([...s, r.createCategory.category.id])); categories.push(r.createCategory.category); }
  }
  return (
    <Sheet open={open} onClose={onClose} title="Categories" actions={<><Button kind="ghost" onClick={onClose}>Cancel</Button><Button kind="accent" onClick={save}>Save</Button></>}>
      {categories.map((c) => <Row key={c.id} title={c.name} toggle={chosen.has(c.id)} onToggle={(on) => setChosen((s) => { const n = new Set(s); on ? n.add(c.id) : n.delete(c.id); return n; })} />)}
      <Button kind="soft" small icon="plus" onClick={create}>New category</Button>
    </Sheet>
  );
}
