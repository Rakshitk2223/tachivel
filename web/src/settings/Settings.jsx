// Settings (Figma L11 / L12 / L13, I6, phone M12 / M13). Tachivel's own settings sync through /api;
// comics-engine settings are Suwayomi's and live on the server.
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { THEMES, useSettings } from "../lib/settings.js";
import { api, useLoad } from "../lib/api.js";
import { gql, gqlUpload, Q, M } from "../lib/gql.js";
import { Button, Caps, Chip, ErrorNote, Group, IconButton, Row, Segmented, Spinner } from "../ui/kit.jsx";
import { Icon } from "../ui/icons.jsx";
import { useGql, useComicPrefs, READER_DEFAULTS } from "../comics/data.js";
import { StorageMeter } from "../comics/Downloads.jsx";
import { LangSheet } from "../comics/Browse.jsx";

const SECTIONS = [["appearance", "Appearance", "palette"], ["library", "Library", "library"], ["reader", "Reader", "paged"], ["downloads", "Downloads", "down"],
  ["browse", "Browse & extensions", "extensions"], ["tracking", "Tracking", "link"], ["backup", "Backup & restore", "backup"], ["server", "Server", "server"], ["about", "About", "info"]];

export default function Settings() {
  const { section } = useParams();
  const nav = useNavigate();
  const wide = typeof matchMedia !== "undefined" && matchMedia("(min-width: 701px)").matches;
  const current = section || (wide ? "appearance" : null);
  const Body = { appearance: Appearance, library: Library, reader: Reader, downloads: Downloads, browse: Browse, tracking: Tracking, backup: Backup, server: Server, about: About }[current];
  return (
    <div className={`settings${section ? " has-section" : ""}`}>
      <nav className="settings-nav" aria-label="Settings sections">
        <h1>Settings</h1>
        {SECTIONS.map(([id, label, icon]) => <Row key={id} icon={icon} iconTone={current === id ? "accent" : ""} title={label} selected={current === id} chevron={!wide} onClick={() => nav(`/settings/${id}`)} />)}
      </nav>
      <div className="settings-body">
        <div className="page-head only-phone"><IconButton icon="back" label="All settings" onClick={() => nav("/settings")} /></div>
        {Body && <Body />}
      </div>
    </div>
  );
}

// Suwayomi settings: load once, save each change straight away.
function useServerSettings() {
  const s = useGql(Q.settings);
  const set = async (patch) => { s.setData((d) => ({ settings: { ...d.settings, ...patch } })); await gql(M.setSettings, { s: patch }).catch((e) => { alert(e.message); s.reload(); }); };
  return [s.data?.settings, set, s];
}

function Swatch({ id, name, on, onClick }) {
  return (
    <button type="button" className={`swatch${on ? " on" : ""}`} onClick={onClick} aria-pressed={on}>
      <span className="sw" data-theme={id}><i /><span><b /><em /><em /><u /></span></span>
      {name}{on ? " · current" : ""}
    </button>
  );
}

function Appearance() {
  const s = useSettings();
  const pick = (key) => (id) => s.update({ [key]: id });
  return (
    <>
      <h3>Appearance</h3>
      <section style={{ display: "grid", gap: 12 }}>
        <span className="row-title">Theme</span>
        <div className="swatches">{THEMES.map((t) => <Swatch key={t.id} {...t} on={!s.followSystem && s.theme === t.id} onClick={() => s.update({ theme: t.id, followSystem: false })} />)}</div>
      </section>
      <Group title="Light and dark">
        <Row title="Follow the device's light / dark setting" sub={`Day uses ${THEMES.find((t) => t.id === s.dayTheme)?.name}, night uses ${THEMES.find((t) => t.id === s.nightTheme)?.name}`} toggle={s.followSystem} onToggle={(followSystem) => s.update({ followSystem })} />
        {s.followSystem && <>
          <div className="seg-row"><span className="row-text"><span className="row-title">Day theme</span></span><div className="chips wrap">{THEMES.map((t) => <Chip key={t.id} label={t.name} active={s.dayTheme === t.id} onClick={() => pick("dayTheme")(t.id)} />)}</div></div>
          <div className="seg-row"><span className="row-text"><span className="row-title">Night theme</span></span><div className="chips wrap">{THEMES.map((t) => <Chip key={t.id} label={t.name} active={s.nightTheme === t.id} onClick={() => pick("nightTheme")(t.id)} />)}</div></div>
        </>}
      </Group>
      <ReaderBg />
    </>
  );
}
function readDefaults() { try { return { ...READER_DEFAULTS, ...JSON.parse(localStorage.getItem("tachivel:reader:default") || "{}") }; } catch { return { ...READER_DEFAULTS }; } }
function useReaderDefaults() {
  const [d, setD] = useState(readDefaults);
  return [d, (patch) => { const n = { ...d, ...patch }; setD(n); try { localStorage.setItem("tachivel:reader:default", JSON.stringify(n)); } catch {} }];
}
function ReaderBg() {
  const [d, set] = useReaderDefaults();
  return (
    <Group title="Comics">
      <div className="seg-row"><span className="row-text"><span className="row-title">Behind comic pages</span><span className="row-sub">What fills the space around a page</span></span>
        <Segmented options={[{ value: "theme", label: "Theme" }, { value: "black", label: "Black" }, { value: "white", label: "White" }, { value: "grey", label: "Grey" }]} value={d.bg} onChange={(bg) => set({ bg })} /></div>
    </Group>
  );
}

function Library() {
  const cats = useGql(Q.categories);
  const [st, set] = useServerSettings();
  const list = (cats.data?.categories.nodes || []).filter((c) => !c.default);
  const act = async (q, v) => { await gql(q, v).catch((e) => alert(e.message)); cats.reload(); };
  const hours = st ? Math.round(st.globalUpdateInterval) : 0;
  return (
    <>
      <h3>Library</h3>
      <div className="two-col">
        <Group title="Categories">
          {list.map((c, i) => (
            <Row key={c.id} title={c.name} sub={`${c.mangas.totalCount} series`}>
              <span style={{ display: "flex", gap: 4, marginTop: 4 }}>
                <IconButton icon="chevl" label="Move up" size={16} disabled={i === 0} onClick={() => act(M.categoryOrder, { id: c.id, position: c.order - 1 })} />
                <IconButton icon="chevr" label="Move down" size={16} disabled={i === list.length - 1} onClick={() => act(M.categoryOrder, { id: c.id, position: c.order + 1 })} />
                <IconButton icon="edit" label="Rename" size={16} onClick={() => { const name = prompt("Rename category", c.name); if (name) act(M.renameCategory, { id: c.id, name }); }} />
                <IconButton icon="trash" label="Delete" size={16} onClick={() => confirm(`Delete ${c.name}? Its series stay in your library.`) && act(M.deleteCategory, { id: c.id })} />
              </span>
            </Row>
          ))}
          <div style={{ padding: 8 }}><Button kind="soft" small icon="plus" onClick={() => { const name = prompt("New category name"); if (name) act(M.createCategory, { name }); }}>Add category</Button></div>
        </Group>
        <Group title="Checking for new chapters">
          {!st ? <Spinner /> : <>
            <div className="seg-row"><span className="row-text"><span className="row-title">How often</span><span className="row-sub">The server checks even when your devices are off</span></span>
              <Segmented options={[{ value: 0, label: "Off" }, { value: 6, label: "6 h" }, { value: 12, label: "12 h" }, { value: 24, label: "Daily" }]} value={hours} onChange={(h) => set({ globalUpdateInterval: h })} /></div>
            <Row title="Skip completed series" toggle={st.excludeCompleted} onToggle={(v) => set({ excludeCompleted: v })} />
            <Row title="Skip series you haven't started" toggle={st.excludeNotStarted} onToggle={(v) => set({ excludeNotStarted: v })} />
            <Row title="Skip series with unread chapters" toggle={st.excludeUnreadChapters} onToggle={(v) => set({ excludeUnreadChapters: v })} />
            <Row title="Refresh covers and descriptions too" toggle={st.updateMangas} onToggle={(v) => set({ updateMangas: v })} />
          </>}
        </Group>
      </div>
    </>
  );
}

function Reader() {
  const [d, set] = useReaderDefaults();
  const [prefs, setPrefs] = useComicPrefs();
  const seg = (title, sub, key, options) => (<div className="seg-row"><span className="row-text"><span className="row-title">{title}</span>{sub && <span className="row-sub">{sub}</span>}</span><Segmented options={options} value={d[key]} onChange={(v) => set({ [key]: v })} /></div>);
  return (
    <>
      <h3>Reader</h3>
      <p className="sub">Defaults for every series. Each series can override them from the reader's own settings.</p>
      <Group title="Comics">
        {seg("Reading mode", null, "mode", [{ value: "webtoon", label: "Webtoon" }, { value: "ltr", label: "Left → right" }, { value: "rtl", label: "Right → left" }])}
        {seg("Two pages side by side", "On wide screens like the iPad in landscape", "spread", [{ value: "off", label: "Off" }, { value: "auto", label: "Wide screens" }, { value: "on", label: "On" }])}
        {seg("Page fit", null, "fit", [{ value: "screen", label: "Screen" }, { value: "width", label: "Width" }])}
        <div className="seg-row"><span className="row-text"><span className="row-title">Save ahead on this device</span><span className="row-sub">The next chapters download to this device while you read, so pages open instantly and work offline</span></span>
          <Segmented options={[{ value: 0, label: "Off" }, { value: 1, label: "1" }, { value: 3, label: "3" }, { value: 5, label: "5" }]} value={prefs.saveAhead} onChange={(saveAhead) => setPrefs({ saveAhead })} /></div>
        <Row title="Incognito on this device" sub="Reading here doesn't change history or progress" toggle={prefs.incognito} onToggle={(incognito) => setPrefs({ incognito })} />
      </Group>
      <Group title="Novels">
        <Row icon="headphones" title="Voice, speed, text size and page width" sub="Set them from the Aa panel inside a book. Voice, speed and size follow you to every device." />
      </Group>
    </>
  );
}

function Downloads() {
  const [st, set] = useServerSettings();
  return (
    <>
      <h3>Downloads</h3>
      <StorageMeter />
      <Group title="Comics">
        {!st ? <Spinner /> : <>
          <Row title="Download new chapters automatically" sub="When the server finds them, for series you're reading" toggle={st.autoDownloadNewChapters} onToggle={(v) => set({ autoDownloadNewChapters: v })} />
          <div className="seg-row"><span className="row-text"><span className="row-title">At most per series, per check</span><span className="row-sub">Keeps one big update from filling the disk</span></span>
            <Segmented options={[{ value: 0, label: "No limit" }, { value: 5, label: "5" }, { value: 10, label: "10" }, { value: 25, label: "25" }]} value={st.autoDownloadNewChaptersLimit} onChange={(v) => set({ autoDownloadNewChaptersLimit: v })} /></div>
          <Row title="Ignore re-uploads of chapters you've read" toggle={st.autoDownloadIgnoreReUploads} onToggle={(v) => set({ autoDownloadIgnoreReUploads: v })} />
          <Row title="Store chapters as CBZ files" sub="One file per chapter on the server, easier to back up" toggle={st.downloadAsCbz} onToggle={(v) => set({ downloadAsCbz: v })} />
        </>}
      </Group>
    </>
  );
}

function Browse() {
  const nav = useNavigate();
  const [prefs, setPrefs] = useComicPrefs();
  const [st, set] = useServerSettings();
  const [langs, setLangs] = useState(false);
  return (
    <>
      <h3>Browse & extensions</h3>
      <Group>
        <Row icon="extensions" title="Extensions and repositories" chevron onClick={() => nav("/comics/browse/extensions")} />
        <Row icon="globe" title="Languages" sub={prefs.langs.filter((l) => l !== "localsourcelang").join(", ")} chevron onClick={() => setLangs(true)} />
        <Row title="Show adult (18+) sources" sub="Off hides adult-only sources and extensions on this device" toggle={prefs.adult} onToggle={(adult) => setPrefs({ adult })} />
        {st && <div className="seg-row"><span className="row-text"><span className="row-title">Sources searched at once</span><span className="row-sub">Lower is gentler on slow sources</span></span>
          <Segmented options={[{ value: 2, label: "2" }, { value: 4, label: "4" }, { value: 6, label: "6" }]} value={st.maxSourcesInParallel} onChange={(v) => set({ maxSourcesInParallel: v })} /></div>}
      </Group>
      <LangSheet open={langs} onClose={() => setLangs(false)} available={[]} />
    </>
  );
}

function Tracking() {
  const t = useGql(Q.trackers);
  return (
    <>
      <h3>Tracking</h3>
      <p className="sub">Optional. Tracking sends your chapter count to these sites; Tachivel works fine without it. Signing in opens the site, then returns to the comics server.</p>
      <ErrorNote error={t.error} onRetry={t.reload} />
      <Group>
        {(t.data?.trackers.nodes || []).map((x) => <Row key={x.id} mono={x.name.slice(0, 2).toUpperCase()} title={x.name} sub={x.isLoggedIn ? "Signed in" : "Not signed in"} valueTone="ok"
          button={x.isLoggedIn ? undefined : "Connect"} onButton={() => x.authUrl && window.open(x.authUrl, "_blank", "noopener")} value={x.isLoggedIn ? "Connected" : undefined} />)}
      </Group>
    </>
  );
}

function Backup() {
  const [st, set] = useServerSettings();
  const file = useRef(null);
  const [step, setStep] = useState(null); // { phase: "reading"|"check"|"restoring"|"done"|"error", ... }
  const [making, setMaking] = useState(false);
  // 1. Read the file: a Tachimanga .tmb is converted on our server first. 2. Ask Suwayomi what's missing. 3. Restore.
  async function choose(f) {
    if (!f) return;
    setStep({ phase: "reading", name: f.name });
    try {
      let backup = f, stats = null;
      if (/\.tmb$/i.test(f.name)) {
        const res = await fetch("/api/tachimanga/convert", { method: "POST", body: f, credentials: "same-origin" });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Conversion failed (${res.status})`);
        stats = JSON.parse(res.headers.get("x-stats") || "null");
        backup = new File([await res.blob()], "tachimanga.tachibk");
      }
      const v = (await gqlUpload(`query($backup: Upload!) { validateBackup(input: { backup: $backup }) { missingSources { id name } missingTrackers { name } } }`, {}, "backup", backup)).validateBackup;
      setStep({ phase: "check", name: f.name, backup, stats, missing: v.missingSources });
    } catch (e) { setStep({ phase: "error", error: e.message }); }
  }
  async function restore() {
    const { backup, stats } = step;
    setStep({ phase: "restoring", stats });
    try {
      const id = (await gqlUpload(M.restoreBackup, {}, "backup", backup)).restoreBackup.id;
      const poll = async () => {
        const s = (await gql(`query($id: String!) { restoreStatus(id: $id) { state mangaProgress totalManga } }`, { id })).restoreStatus;
        if (s?.state === "SUCCESS") setStep({ phase: "done", stats });
        else if (s?.state === "FAILURE") setStep({ phase: "error", error: "Suwayomi couldn't finish the restore. Check the file and try again." });
        else { setStep({ phase: "restoring", stats, status: s }); setTimeout(poll, 1500); }
      };
      poll();
    } catch (e) { setStep({ phase: "error", error: e.message }); }
  }
  async function make() {
    setMaking(true);
    try { const { url } = (await gql(M.createBackup)).createBackup; location.href = `/suwayomi${url}`; } catch (e) { alert(e.message); } finally { setMaking(false); }
  }
  const s = step?.stats;
  return (
    <>
      <h3>Backup & restore</h3>
      <div className="two-col">
        <Group title="Comics library">
          <Row icon="upload" iconTone="accent" title="Import or restore" sub="A Tachimanga backup (.tmb), or a Mihon / Tachiyomi / Suwayomi backup (.tachibk, .proto.gz): series, categories, read chapters and history" button="Choose file" buttonKind="accent" onButton={() => file.current.click()} />
          <input ref={file} type="file" hidden onChange={(e) => { choose(e.target.files[0]); e.target.value = ""; }} />
          {step && <div className="note" style={{ margin: 8, alignItems: "flex-start", flexDirection: "column" }}>
            {step.phase === "reading" && <span style={{ display: "flex", gap: 8, alignItems: "center" }}><Spinner />Reading {step.name}…</span>}
            {step.phase === "error" && <span className="warn"><Icon name="alert" size={16} /> {step.error}</span>}
            {step.phase === "check" && <>
              <span className="row-title">{s ? `${s.series} series · ${s.chapters.toLocaleString()} chapters (${s.read.toLocaleString()} read) · ${s.categories} categories` : step.name}</span>
              {step.missing.length ? <span className="warn">Install these extensions first, or those series won't update until you do: {step.missing.map((m) => m.name || m.id).join(", ")}</span>
                : <span className="ok">Every source is installed.</span>}
              <span style={{ display: "flex", gap: 8 }}><Button kind="accent" icon="upload" onClick={restore}>Restore now</Button>{step.missing.length > 0 && <Button onClick={() => (location.href = "/comics/browse/extensions")}>Install extensions</Button>}<Button kind="ghost" onClick={() => setStep(null)}>Cancel</Button></span>
            </>}
            {step.phase === "restoring" && <span style={{ display: "flex", gap: 8, alignItems: "center" }}><Spinner />Restoring{step.status?.totalManga ? ` · ${step.status.mangaProgress} of ${step.status.totalManga} series` : "…"}</span>}
            {step.phase === "done" && <span className="ok"><Icon name="ok" size={16} /> Restored{s ? ` ${s.series} series` : ""}. Your library is ready.</span>}
          </div>}
          <Row icon="backup" title="Back up now" sub="Library, categories, history, settings" button={making ? "Working…" : "Back up"} onButton={make} />
        </Group>
        <Group title="Automatic backups">
          {!st ? <Spinner /> : <>
            <div className="seg-row"><span className="row-text"><span className="row-title">How often</span><span className="row-sub">Stored on the server. Keep a copy somewhere else too.</span></span>
              <Segmented options={[{ value: 0, label: "Off" }, { value: 1, label: "Daily" }, { value: 7, label: "Weekly" }]} value={st.backupInterval} onChange={(v) => set({ backupInterval: v })} /></div>
            <div className="seg-row"><span className="row-text"><span className="row-title">Keep backups for</span></span>
              <Segmented options={[{ value: 7, label: "1 week" }, { value: 14, label: "2 weeks" }, { value: 30, label: "30 days" }]} value={st.backupTTL} onChange={(v) => set({ backupTTL: v })} /></div>
          </>}
        </Group>
      </div>
    </>
  );
}

function Server() {
  const [st, set] = useServerSettings();
  const about = useGql(Q.about);
  return (
    <>
      <h3>Server</h3>
      <Group title="Comics server">
        <Row icon="server" iconTone={about.data ? "ok" : "warn"} title="Suwayomi" sub={about.data ? `${about.data.aboutServer.version} · ${about.data.aboutServer.buildType}` : about.error ? "Not answering" : "Checking…"} value={about.data ? "Healthy" : ""} valueTone="ok" />
      </Group>
      <Group title="Cloudflare helper (FlareSolverr)">
        {!st ? <Spinner /> : <>
          <Row title="Use the Cloudflare helper" sub="Solves bot checks for sources that use them" toggle={st.flareSolverrEnabled} onToggle={(v) => set({ flareSolverrEnabled: v })} />
          <Row title="Use it as a fallback for every request" sub="Fewer 403 errors, slightly slower" toggle={st.flareSolverrAsResponseFallback} onToggle={(v) => set({ flareSolverrAsResponseFallback: v })} />
          <div className="seg-row"><span className="row-text"><span className="row-title">Helper session lasts</span></span>
            <Segmented options={[{ value: 5, label: "5 min" }, { value: 15, label: "15 min" }, { value: 60, label: "1 hour" }]} value={st.flareSolverrSessionTtl} onChange={(v) => set({ flareSolverrSessionTtl: v })} /></div>
          <Row title="Helper address" sub={st.flareSolverrUrl} />
        </>}
      </Group>
    </>
  );
}

function About() {
  const me = useLoad(api.me);
  return (
    <>
      <h3>About</h3>
      <Group>
        <Row title="Tachivel" value="v2.0" />
        <Row title="Signed in as" value={me.data?.user || "…"} />
        <Row icon="external" title="Sign out" tone="bad" onClick={() => { location.href = "https://auth.rakshiit.me/logout"; }} />
      </Group>
    </>
  );
}
