// History (Figma L5, phone M6): what you opened, newest first, with resume.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Q } from "../lib/gql.js";
import { Button, Caps, Empty, ErrorNote, Spinner, Thumb, Toggle, dayLabel, chapterLabel } from "../ui/kit.jsx";
import { Icon } from "../ui/icons.jsx";
import { useGql, useComicPrefs } from "./data.js";

export default function History() {
  const nav = useNavigate();
  const [prefs, setPrefs] = useComicPrefs();
  const hist = useGql(Q.history, { first: 200 });
  const [q, setQ] = useState("");
  // One row per series: the chapter you opened most recently.
  const seen = new Set();
  const items = (hist.data?.chapters.nodes || []).filter((c) => !seen.has(c.manga.id) && seen.add(c.manga.id)).filter((c) => !q || c.manga.title.toLowerCase().includes(q.toLowerCase()));
  const groups = [];
  for (const c of items) { const d = dayLabel(c.lastReadAt); (groups.at(-1)?.day === d ? groups.at(-1).items : (groups.push({ day: d, items: [] }), groups.at(-1).items)).push(c); }
  const time = (ms) => new Date(Number(ms) < 1e12 ? Number(ms) * 1000 : Number(ms)).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow"><h1>History</h1><p className="sub">Everything you opened, newest first. Synced across your devices.</p></div>
        <label className="search" style={{ width: 260 }}><Icon name="search" size={16} className="muted" /><input placeholder="Search history" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <label className="row-value" style={{ display: "flex", gap: 8, alignItems: "center" }}><Icon name="incognito" size={18} /> Incognito <Toggle on={prefs.incognito} onChange={(incognito) => setPrefs({ incognito })} label="Incognito" /></label>
      </div>
      {prefs.incognito && <div className="note"><Icon name="incognito" /><span>Incognito is on: what you read on this device isn't saved to history or progress.</span></div>}
      <ErrorNote error={hist.error} onRetry={hist.reload} />
      {hist.loading && !hist.data ? <Spinner /> : !items.length ? <Empty icon="history" title="Nothing read yet">Chapters you open show up here.</Empty> : (
        <div className="list">
          {groups.map((g) => (
            <div key={g.day}>
              <Caps>{g.day}</Caps>
              {g.items.map((c) => {
                const finished = c.isRead;
                return (
                  <div key={c.id} className="srow">
                    <button type="button" style={{ display: "contents" }} onClick={() => nav(`/comics/series/${c.manga.id}`)}><Thumb src={c.manga.thumbnailUrl} title={c.manga.title} /></button>
                    <span className="row-text"><span className="row-title">{c.manga.title}</span>
                      <span className="row-sub">{chapterLabel(c)} · {finished ? "finished" : `page ${c.lastPageRead + 1}${c.pageCount ? ` of ${c.pageCount}` : ""}`} · {time(c.lastReadAt)}</span></span>
                    <Button small kind="soft" icon="play" onClick={() => nav(finished ? `/comics/series/${c.manga.id}` : `/comics/read/${c.id}`)}>{finished ? "Next" : "Resume"}</Button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
