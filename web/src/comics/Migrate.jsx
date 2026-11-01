// Move a series to another source (Figma L6, phone M11): find the same title elsewhere, bring your read chapters and categories along.
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { gql, Q, M } from "../lib/gql.js";
import { AppBar, Button, Caps, Cover, ErrorNote, IconButton, Row, Spinner } from "../ui/kit.jsx";
import { useGql, useComicPrefs, num } from "./data.js";
import { SourceIcon, shown } from "./Browse.jsx";

const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
async function pool(items, n, fn) { const q = [...items]; await Promise.all(Array.from({ length: n }, async () => { while (q.length) await fn(q.shift()); })); }

export default function Migrate() {
  const { id } = useParams();
  const mid = Number(id);
  const nav = useNavigate();
  const [prefs] = useComicPrefs();
  const manga = useGql(Q.manga, { id: mid }, [mid]);
  const [cands, setCands] = useState([]); // { source, manga, exact, latest }
  const [searching, setSearching] = useState(0);
  const [pick, setPick] = useState(null);
  const [opts, setOpts] = useState({ chapters: true, categories: true, deleteOld: false });
  const [busy, setBusy] = useState("");
  const [error, setError] = useState(null);
  const m = manga.data?.manga;

  useEffect(() => {
    if (!m) return;
    let live = true;
    (async () => {
      const sources = (await gql(Q.sources)).sources.nodes.filter((s) => s.id !== m.source?.id && s.id !== "0" && shown(prefs, s));
      setSearching(sources.length);
      await pool(sources, 5, async (s) => {
        try {
          const r = (await gql(M.fetchSource, { source: s.id, type: "SEARCH", page: 1, query: m.title })).fetchSourceManga.mangas.slice(0, 3);
          const best = r.find((x) => norm(x.title) === norm(m.title)) || r[0];
          if (live && best) setCands((c) => [...c, { source: s, manga: best, exact: norm(best.title) === norm(m.title) }].sort((a, b) => b.exact - a.exact));
        } catch { /* a blocked source just doesn't offer a match */ }
        if (live) setSearching((n) => n - 1);
      });
    })();
    return () => { live = false; };
  }, [m?.id]); // eslint-disable-line

  async function go(keepOld) {
    if (!pick) return;
    setBusy(keepOld ? "copy" : "migrate"); setError(null);
    try {
      const to = pick.manga.id;
      setBusy("Fetching chapters from the new source…");
      await gql(M.refreshManga, { id: to });
      await gql(M.setInLibrary, { id: to, on: true });
      if (opts.categories && m.categories.nodes.length) await gql(M.mangaCategories, { id: to, patch: { addToCategories: m.categories.nodes.map((c) => c.id) } });
      if (opts.chapters) {
        const oldCh = (await gql(Q.chapters, { id: mid })).chapters.nodes;
        const lastRead = Math.max(-1, ...oldCh.filter((c) => c.isRead).map((c) => c.chapterNumber));
        const newCh = (await gql(Q.chapters, { id: to })).chapters.nodes;
        const ids = newCh.filter((c) => c.chapterNumber >= 0 && c.chapterNumber <= lastRead && !c.isRead).map((c) => c.id);
        if (ids.length) await gql(M.updateChapters, { ids, patch: { isRead: true } });
      }
      if (!keepOld) {
        if (opts.deleteOld) { const dl = (await gql(Q.chapters, { id: mid })).chapters.nodes.filter((c) => c.isDownloaded).map((c) => c.id); if (dl.length) await gql(M.deleteDownloads, { ids: dl }); }
        await gql(M.setInLibrary, { id: mid, on: false });
      }
      nav(`/comics/series/${to}`, { replace: true });
    } catch (e) { setError(e); } finally { setBusy(""); }
  }

  if (!m) return <Spinner />;
  return (
    <div className="page">
      <AppBar title="Migrate" sub={m.title} />
      <div className="group" style={{ flexDirection: "row", gap: 16, padding: 16, alignItems: "center" }}>
        <Cover src={m.thumbnailUrl} title={m.title} className="thumb" />
        <div className="row-text"><span className="row-title">{m.title}</span><span className="row-sub">Now on {m.source?.displayName} · {m.chapters.totalCount} chapters · {m.unreadCount} unread</span></div>
      </div>
      <ErrorNote error={error} />
      <Caps>Pick the new source{searching > 0 ? ` · searching ${searching} more…` : ""}</Caps>
      <div className="list">
        {cands.map((c) => <Row key={c.source.id} mono={<SourceIcon src={c.source.iconUrl} name={c.source.displayName} />} title={c.source.displayName}
          sub={`${c.exact ? "Same title" : `Similar: ${c.manga.title}`}${c.manga.latestUploadedChapter ? ` · latest Ch ${num(c.manga.latestUploadedChapter.chapterNumber)}` : ""}`}
          value={c === cands[0] && c.exact ? "Best match" : ""} valueTone="ok" selected={pick === c} onClick={() => setPick(c)} />)}
        {!cands.length && searching === 0 && <p className="sub" style={{ padding: 16 }}>No other source has this title. Install more extensions, or try again later.</p>}
        {!cands.length && searching > 0 && <Spinner />}
      </div>
      <Caps>Bring along</Caps>
      <div className="list">
        <Row title="Chapters you've read" sub="Matched by chapter number" toggle={opts.chapters} onToggle={(v) => setOpts({ ...opts, chapters: v })} />
        <Row title="Categories" sub={m.categories.nodes.map((c) => c.name).join(", ") || "None"} toggle={opts.categories} onToggle={(v) => setOpts({ ...opts, categories: v })} />
        <Row title="Delete the old source's downloads" sub="Only when migrating, not copying" toggle={opts.deleteOld} onToggle={(v) => setOpts({ ...opts, deleteOld: v })} />
      </div>
      <div className="hero-actions">
        <Button disabled={!pick || !!busy} onClick={() => go(true)}>Copy (keep both)</Button>
        <Button kind="accent" icon="migrate" disabled={!pick || !!busy} onClick={() => go(false)}>{busy && busy.length > 8 ? busy : "Migrate"}</Button>
      </div>
    </div>
  );
}
