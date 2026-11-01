// Browse (Figma L1 / L4 / L6, phone M1 / M5): sources, extensions and repositories, and migrate.
import { useEffect, useMemo, useState } from "react";
import { NavLink, useNavigate, useParams } from "react-router-dom";
import { gql, media, Q, M } from "../lib/gql.js";
import { Button, Caps, Chip, Empty, ErrorNote, IconButton, Menu, Row, Sheet, Spinner, friendlyError } from "../ui/kit.jsx";
import { Icon } from "../ui/icons.jsx";
import { useGql, useComicPrefs, ADULT_OPTION } from "./data.js";

const LANG = new Intl.DisplayNames(undefined, { type: "language" });
export const langName = (l) => (l === "all" ? "Multi-language" : l === "localsourcelang" ? "On your server" : (() => { try { return LANG.of(l); } catch { return l; } })());
export function SourceIcon({ src, name }) {
  const [ok, setOk] = useState(true);
  return src && ok ? <img src={media(src)} alt="" loading="lazy" onError={() => setOk(false)} /> : name.slice(0, 2).toUpperCase();
}
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
    <div className="split split-side">
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

const PAGE = 100;
function Extensions({ filter }) {
  const [prefs] = useComicPrefs();
  const ext = useGql(Q.extensions);
  const stores = useGql(Q.extensionStores);
  const [busy, setBusy] = useState({});
  const [sheet, setSheet] = useState(null); // "langs" | "repos" | { ext } for source settings
  const [limit, setLimit] = useState(PAGE);
  // Ask the repositories for their latest lists once per visit.
  useEffect(() => { gql(M.fetchExtensions).then(() => ext.reload()).catch(() => {}); }, []); // eslint-disable-line
  useEffect(() => setLimit(PAGE), [filter]);
  const all = (ext.data?.extensions.nodes || []).filter((e) => !filter || e.name.toLowerCase().includes(filter.toLowerCase()));
  const updates = all.filter((e) => e.hasUpdate), installed = all.filter((e) => e.isInstalled && !e.hasUpdate), available = all.filter((e) => !e.isInstalled && shown(prefs, e));
  const act = async (e, patch) => { setBusy((b) => ({ ...b, [e.pkgName]: true })); try { await gql(M.updateExtension, { id: e.pkgName, patch }); } catch (err) { alert(friendlyError(err)); } finally { setBusy((b) => ({ ...b, [e.pkgName]: false })); ext.reload(); } };
  // Only the sources in your languages are worth configuring (MangaDex alone has 60).
  const configurable = (e) => (e.source?.nodes || []).filter((s) => s.isConfigurable && shownLang(prefs, s.lang));
  const row = (e, button, patch, accent) => <Row key={e.pkgName} mono={<SourceIcon src={e.iconUrl} name={e.name} />} title={e.name} sub={`${langName(e.lang)} · v${e.versionName}${e.isObsolete ? " · obsolete" : ""}`}
    value={e.isInstalled && configurable(e).length > 0 ? <IconButton icon="settings" label={`${e.name} settings`} onClick={() => setSheet({ ext: e })} /> : undefined}
    button={busy[e.pkgName] ? "Working…" : button} buttonKind={accent ? "accent" : "outline"} onButton={() => act(e, patch)} />;
  const repos = stores.data?.extensionStores.nodes || [];
  return (
    <div className="list">
      <div className="actions">
        <Button kind="soft" small icon="globe" onClick={() => setSheet("repos")}>Repositories · {repos.length}</Button>
        <Button kind="soft" small icon="globe" onClick={() => setSheet("langs")}>Languages</Button>
      </div>
      <ErrorNote error={ext.error} onRetry={ext.reload} />
      {ext.loading && !ext.data && <Spinner />}
      {updates.length > 0 && <><Caps right={<Button small kind="accent" icon="down" onClick={async () => { await gql(M.updateExtensions, { ids: updates.map((e) => e.pkgName) }).catch((e) => alert(friendlyError(e))); await ext.reload(); }}>Update all</Button>}>Updates · {updates.length}</Caps>{updates.map((e) => row(e, "Update", { update: true }, true))}</>}
      {installed.length > 0 && <><Caps>Installed · {installed.length}</Caps>{installed.map((e) => row(e, "Uninstall", { uninstall: true }))}</>}
      {available.length > 0 && <><Caps>Available · {available.length}</Caps>{available.slice(0, limit).map((e) => row(e, "Install", { install: true }))}
        {available.length > limit && <Button kind="ghost" onClick={() => setLimit(limit + PAGE)}>Show {Math.min(PAGE, available.length - limit)} more · {available.length - limit} left</Button>}</>}
      {ext.data && !all.length && <Empty icon="extensions" title="No extensions found">{filter ? "Nothing matches that search." : "Add a repository to see what you can install."}</Empty>}
      <ReposSheet open={sheet === "repos"} onClose={() => setSheet(null)} repos={repos} onChange={() => { stores.reload(); gql(M.fetchExtensions).then(() => ext.reload()).catch(() => {}); }} />
      <LangSheet open={sheet === "langs"} onClose={() => setSheet(null)} available={[...new Set((ext.data?.extensions.nodes || []).map((e) => e.lang))]} />
      <SourcePrefsSheet open={!!sheet?.ext} onClose={() => setSheet(null)} name={sheet?.ext?.name} sources={sheet?.ext ? configurable(sheet.ext) : []} />
    </div>
  );
}

function ReposSheet({ open, onClose, repos, onChange }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState(null);
  const add = async () => {
    setError(null);
    try { await gql(M.addStore, { url: url.trim() }); setUrl(""); onChange(); } catch (e) { setError(e); }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Repositories">
      {repos.map((s) => <Row key={s.indexUrl} icon="globe" title={s.name || new URL(s.indexUrl).hostname} sub={s.indexUrl} button="Remove" buttonKind="ghost"
        onButton={async () => { if (confirm("Remove this repository? Its installed extensions stay.")) { await gql(M.removeStore, { url: s.indexUrl }); onChange(); } }} />)}
      {!repos.length && <p className="sub">No repositories yet. Add one to see extensions you can install.</p>}
      <label className="caps">Add a repository</label>
      <input className="field" placeholder="https://…/index.min.json" inputMode="url" autoCapitalize="none" value={url} onChange={(e) => setUrl(e.target.value)} />
      <ErrorNote error={error} />
      <div className="actions"><Button kind="accent" icon="plus" disabled={!/^https?:\/\/.+\.json$/i.test(url.trim())} onClick={add}>Add</Button></div>
      <p className="sub">Extensions run on your server, not on your phone, so they behave the same on every device.</p>
    </Sheet>
  );
}

// A source's own settings (Suwayomi's source preferences): switches, lists, multi-pick lists and text.
function SourcePrefsSheet({ open, onClose, name, sources }) {
  const [picked, setPicked] = useState(null);
  useEffect(() => { if (open) setPicked(sources.length === 1 ? sources[0] : null); }, [open]); // eslint-disable-line
  return (
    <Sheet open={open} onClose={onClose} title={picked ? picked.displayName : `${name || ""} settings`}>
      {!picked ? <>
        <p className="sub">This extension has a source for each language. Pick one to change its settings.</p>
        {sources.map((s) => <Row key={s.id} title={s.displayName} sub={langName(s.lang)} chevron onClick={() => setPicked(s)} />)}
      </> : <SourcePrefs id={picked.id} onBack={sources.length > 1 ? () => setPicked(null) : null} />}
    </Sheet>
  );
}

function SourcePrefs({ id, onBack }) {
  const [prefs] = useComicPrefs();
  const q = useGql(Q.sourcePrefs, { id }, [id]);
  const [text, setText] = useState({});
  const [error, setError] = useState(null);
  const change = async (position, patch) => {
    setError(null);
    try { await gql(M.setSourcePref, { source: id, change: { position, ...patch } }); await q.reload(); } catch (e) { setError(e); }
  };
  const list = q.data?.source.preferences || [];
  if (q.loading && !q.data) return <Spinner />;
  return (
    <div className="prefs">
      {onBack && <Button kind="ghost" small icon="back" onClick={onBack}>Other languages</Button>}
      <ErrorNote error={q.error || error} onRetry={q.reload} />
      {list.map((p, i) => {
        if (p.visible === false) return null;
        const off = p.enabled === false;
        switch (p.__typename) {
          case "SwitchPreference": return <Row key={p.key || i} title={p.title} sub={p.summary || undefined} toggle={!!p.switchValue} onToggle={(v) => !off && change(i, { switchState: v })} />;
          case "CheckBoxPreference": return <Row key={p.key || i} title={p.title} sub={p.summary || undefined} toggle={!!p.checkValue} onToggle={(v) => !off && change(i, { checkBoxState: v })} />;
          case "ListPreference": return (
            <label key={p.key || i} className="pref"><span className="row-title">{p.title}</span>
              <select className="field" disabled={off} value={p.listValue ?? ""} onChange={(e) => change(i, { listState: e.target.value })}>
                {!p.entryValues.includes(p.listValue) && <option value={p.listValue ?? ""}>Default</option>}
                {p.entries.map((label, j) => (!prefs.adult && p.listValue !== p.entryValues[j] && ADULT_OPTION.test(`${label} ${p.entryValues[j]}`) ? null : <option key={p.entryValues[j]} value={p.entryValues[j]}>{label}</option>))}
              </select></label>);
          case "MultiSelectListPreference": {
            const on = new Set(p.multiValue || []);
            return (
              <div key={p.key || i} className="pref"><span className="row-title">{p.title}</span>{p.summary && <span className="row-sub">{p.summary}</span>}
                <div className="chips wrap">{p.entries.map((label, j) => { const v = p.entryValues[j]; if (!prefs.adult && !on.has(v) && ADULT_OPTION.test(`${label} ${v}`)) return null; return <Chip key={v} label={label} active={on.has(v)}
                  onClick={() => { const n = new Set(on); n.has(v) ? n.delete(v) : n.add(v); change(i, { multiSelectState: [...n] }); }} />; })}</div></div>);
          }
          case "EditTextPreference": {
            const v = text[i] ?? p.textValue ?? "";
            return (
              <div key={p.key || i} className="pref"><span className="row-title">{p.title}</span>{(p.dialogMessage || p.summary) && <span className="row-sub">{p.dialogMessage || p.summary}</span>}
                <div className="actions"><input className="field grow" disabled={off} value={v} onChange={(e) => setText({ ...text, [i]: e.target.value })} />
                  <Button small disabled={off || v === (p.textValue ?? "")} onClick={() => change(i, { editTextState: v }).then(() => setText((t) => { const n = { ...t }; delete n[i]; return n; }))}>Save</Button></div></div>);
          }
          default: return null;
        }
      })}
      {!list.length && <p className="sub">This source has no settings.</p>}
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
    <div className="split split-list">
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
