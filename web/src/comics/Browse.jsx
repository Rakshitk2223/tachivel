// Browse (Figma L1 / L4 / L6, phone M1 / M5): sources, extensions and repositories, and migrate.
import { useEffect, useMemo, useState } from "react";
import { NavLink, useNavigate, useParams } from "react-router-dom";
import { gql, media, Q, M } from "../lib/gql.js";
import { Button, Caps, Empty, ErrorNote, Menu, Row, Sheet, Spinner } from "../ui/kit.jsx";
import { Icon } from "../ui/icons.jsx";
import { useGql, useComicPrefs } from "./data.js";

const LANG = new Intl.DisplayNames(undefined, { type: "language" });
export const langName = (l) => (l === "all" ? "Multi-language" : l === "localsourcelang" ? "On your server" : (() => { try { return LANG.of(l); } catch { return l; } })());
export const SourceIcon = ({ src, name }) => (src ? <img src={media(src)} alt="" loading="lazy" /> : name.slice(0, 2).toUpperCase());
export const shownLang = (prefs, lang) => prefs.langs.includes(lang) || lang === "localsourcelang";
// Adult-only sources stay hidden unless you turn them on in Settings → Browse (mixed ones, like MangaDex, always show).
export const shown = (prefs, x) => shownLang(prefs, x.lang) && (prefs.adult || x.contentWarning !== "NSFW");

export default function Browse() {
  const { tab = "sources" } = useParams();
  const nav = useNavigate();
  const [q, setQ] = useState("");
  return (
    <div className="page">
      <div className="page-head">
        <h1 className="grow">Browse</h1>
        <form className="search" style={{ width: 360, maxWidth: "100%" }} onSubmit={(e) => { e.preventDefault(); if (q.trim()) nav(`/comics/search?q=${encodeURIComponent(q.trim())}`); }}>
          <Icon name="search" size={16} className="muted" /><input placeholder={tab === "extensions" ? "Search extensions" : "Search every source"} value={q} onChange={(e) => setQ(e.target.value)} enterKeyHint="search" />
        </form>
      </div>
      <nav className="tabs">
        {[["sources", "Sources"], ["extensions", "Extensions"], ["migrate", "Migrate"]].map(([t, l]) => <NavLink key={t} to={`/comics/browse/${t}`} className={() => (tab === t ? "on" : "")}>{l}</NavLink>)}
      </nav>
      {tab === "sources" && <Sources />}
      {tab === "extensions" && <Extensions filter={q} />}
      {tab === "migrate" && <MigrateList />}
    </div>
  );
}

function Sources() {
  const nav = useNavigate();
  const [prefs, setPrefs] = useComicPrefs();
  const src = useGql(Q.sources);
  const [menu, setMenu] = useState(null);
  const [langs, setLangs] = useState(false);
  const all = src.data?.sources.nodes || [];
  const visible = all.filter((s) => shown(prefs, s));
  const pinned = visible.filter((s) => prefs.pinned.includes(s.id));
  const byLang = useMemo(() => { const g = {}; visible.filter((s) => !prefs.pinned.includes(s.id)).forEach((s) => (g[s.lang] ||= []).push(s)); return g; }, [visible, prefs.pinned]);
  const row = (s) => <Row key={s.id} mono={<SourceIcon src={s.iconUrl} name={s.displayName} />} title={s.displayName} sub={langName(s.lang)} value={s.supportsLatest ? "Latest" : ""} chevron
    onClick={() => nav(`/comics/source/${s.id}`)} />;
  const pinMenu = (s) => (e) => { e.preventDefault(); setMenu({ at: { x: e.clientX, y: e.clientY }, s }); };
  if (src.loading && !src.data) return <Spinner />;
  return (
    <div className="two-col" style={{ gridTemplateColumns: "minmax(0, 720px) minmax(0, 380px)" }}>
      <div className="list">
        <ErrorNote error={src.error} onRetry={src.reload} />
        {!all.length && <Empty icon="extensions" title="No sources yet" action={<Button kind="accent" icon="extensions" onClick={() => nav("/comics/browse/extensions")}>Install extensions</Button>}>Sources come from extensions. Add a repository and install the ones you use.</Empty>}
        {pinned.length > 0 && <><Caps>Pinned</Caps>{pinned.map((s) => <div key={s.id} onContextMenu={pinMenu(s)}>{row(s)}</div>)}</>}
        {Object.entries(byLang).map(([l, list]) => <div key={l}><Caps>{langName(l)}</Caps>{list.map((s) => <div key={s.id} onContextMenu={pinMenu(s)}>{row(s)}</div>)}</div>)}
      </div>
      <aside className="group hide-phone" style={{ padding: 20, gap: 12 }}>
        <h2>Sources come from extensions</h2>
        <p className="sub">{all.length} sources from your installed extensions. Right-click (or long-press) a source to pin it to the top.</p>
        <div className="hero-actions"><Button kind="soft" icon="extensions" onClick={() => nav("/comics/browse/extensions")}>Manage extensions</Button><Button kind="soft" icon="globe" onClick={() => setLangs(true)}>Languages</Button></div>
      </aside>
      <Button className="only-phone" kind="soft" icon="globe" onClick={() => setLangs(true)}>Languages</Button>
      <Menu at={menu?.at} onClose={() => setMenu(null)} items={menu ? [
        prefs.pinned.includes(menu.s.id) ? { icon: "close", label: "Unpin", onClick: () => setPrefs({ pinned: prefs.pinned.filter((x) => x !== menu.s.id) }) } : { icon: "plus", label: "Pin to the top", onClick: () => setPrefs({ pinned: [...prefs.pinned, menu.s.id] }) },
        { icon: "browse", label: "Open", onClick: () => nav(`/comics/source/${menu.s.id}`) },
      ] : []} />
      <LangSheet open={langs} onClose={() => setLangs(false)} available={[...new Set(all.map((s) => s.lang))]} />
    </div>
  );
}

export function LangSheet({ open, onClose, available }) {
  const [prefs, setPrefs] = useComicPrefs();
  const list = [...new Set(["en", "all", ...available])].filter((l) => l !== "localsourcelang");
  return (
    <Sheet open={open} onClose={onClose} title="Languages">
      {list.map((l) => <Row key={l} title={langName(l)} toggle={prefs.langs.includes(l)} onToggle={(on) => setPrefs({ langs: on ? [...prefs.langs, l] : prefs.langs.filter((x) => x !== l) })} />)}
    </Sheet>
  );
}

function Extensions({ filter }) {
  const [prefs] = useComicPrefs();
  const ext = useGql(Q.extensions);
  const stores = useGql(Q.extensionStores);
  const [busy, setBusy] = useState({});
  const [langs, setLangs] = useState(false);
  // Ask the repositories for their latest lists once per visit.
  useEffect(() => { gql(M.fetchExtensions).then(() => ext.reload()).catch(() => {}); }, []); // eslint-disable-line
  const all = (ext.data?.extensions.nodes || []).filter((e) => !filter || e.name.toLowerCase().includes(filter.toLowerCase()));
  const updates = all.filter((e) => e.hasUpdate), installed = all.filter((e) => e.isInstalled && !e.hasUpdate), available = all.filter((e) => !e.isInstalled && shown(prefs, e));
  const act = async (e, patch) => { setBusy((b) => ({ ...b, [e.pkgName]: true })); try { await gql(M.updateExtension, { id: e.pkgName, patch }); } catch (err) { alert(err.message); } finally { setBusy((b) => ({ ...b, [e.pkgName]: false })); ext.reload(); } };
  const row = (e, button, patch, accent) => <Row key={e.pkgName} mono={<SourceIcon src={e.iconUrl} name={e.name} />} title={e.name} sub={`${langName(e.lang)} · v${e.versionName}${e.isObsolete ? " · obsolete" : ""}`}
    button={busy[e.pkgName] ? "Working…" : button} buttonKind={accent ? "accent" : "outline"} onButton={() => !busy[e.pkgName] && act(e, patch)} />;
  const addRepo = async () => { const url = prompt("Repository index URL (ends in index.min.json)"); if (url) { await gql(M.addStore, { url }).catch((e) => alert(e.message)); stores.reload(); gql(M.fetchExtensions).then(() => ext.reload()); } };
  return (
    <div className="two-col" style={{ gridTemplateColumns: "minmax(0, 760px) minmax(0, 360px)" }}>
      <div className="list">
        <ErrorNote error={ext.error} onRetry={ext.reload} />
        {ext.loading && !ext.data && <Spinner />}
        {updates.length > 0 && <><Caps right={<button type="button" onClick={async () => { await gql(M.updateExtensions, { ids: updates.map((e) => e.pkgName) }).catch(() => {}); ext.reload(); }}>Update all</button>}>Updates · {updates.length}</Caps>{updates.map((e) => row(e, "Update", { update: true }, true))}</>}
        {installed.length > 0 && <><Caps>Installed · {installed.length}</Caps>{installed.map((e) => row(e, "Uninstall", { uninstall: true }))}</>}
        {available.length > 0 && <><Caps>Available · {available.length}</Caps>{available.slice(0, 300).map((e) => row(e, "Install", { install: true }))}</>}
        {ext.data && !all.length && <Empty icon="extensions" title="No extensions found">Add a repository to see what you can install.</Empty>}
      </div>
      <aside className="group" style={{ padding: 20, gap: 12 }}>
        <h2>Repositories</h2>
        {(stores.data?.extensionStores.nodes || []).map((s) => <Row key={s.indexUrl} icon="globe" title={s.name || new URL(s.indexUrl).hostname} sub={s.indexUrl} button="Remove" onButton={async () => { if (confirm("Remove this repository?")) { await gql(M.removeStore, { url: s.indexUrl }); stores.reload(); } }} />)}
        <p className="sub">Extensions run on your server, not on your phone, so they behave the same on every device.</p>
        <div className="hero-actions"><Button kind="soft" icon="plus" onClick={addRepo}>Add repository</Button><Button kind="soft" icon="globe" onClick={() => setLangs(true)}>Languages</Button></div>
      </aside>
      <LangSheet open={langs} onClose={() => setLangs(false)} available={[...new Set((ext.data?.extensions.nodes || []).map((e) => e.lang))]} />
    </div>
  );
}

function MigrateList() {
  const nav = useNavigate();
  const lib = useGql(Q.libraryAll);
  const [source, setSource] = useState(null);
  const mangas = lib.data?.mangas.nodes || [];
  const bySource = useMemo(() => { const g = {}; mangas.forEach((m) => { const k = m.source?.id || "?"; (g[k] ||= { name: m.source?.displayName || "Unknown", list: [] }).list.push(m); }); return Object.entries(g).sort((a, b) => b[1].list.length - a[1].list.length); }, [mangas]);
  if (lib.loading && !lib.data) return <Spinner />;
  if (!mangas.length) return <Empty icon="migrate" title="Nothing to migrate">Series in your library show up here, grouped by source.</Empty>;
  const current = bySource.find(([k]) => k === source)?.[1];
  return (
    <div className="two-col" style={{ gridTemplateColumns: "minmax(0, 380px) minmax(0, 1fr)" }}>
      <div className="list">
        <Caps>Sources in your library</Caps>
        {bySource.map(([k, g]) => <Row key={k} mono={g.name.slice(0, 2).toUpperCase()} title={g.name} sub={`${g.list.length} series`} chevron selected={k === source} onClick={() => setSource(k)} />)}
      </div>
      <div className="group" style={{ padding: 16 }}>
        {!current ? <p className="sub" style={{ padding: 16 }}>Pick a source to see its series. Move a series when its source keeps blocking downloads or stops updating.</p> : <>
          <Caps>{current.name} · {current.list.length} series</Caps>
          {current.list.map((m) => <Row key={m.id} title={m.title} sub={`${m.unreadCount} new · ${m.downloadCount} on the server`} chevron onClick={() => nav(`/comics/migrate/${m.id}`)} />)}
        </>}
      </div>
    </div>
  );
}
