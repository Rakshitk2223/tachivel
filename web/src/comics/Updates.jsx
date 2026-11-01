// Updates (Figma V4, phone P5): new chapters across the library, grouped by day.
import { useNavigate } from "react-router-dom";
import { gql, Q, M } from "../lib/gql.js";
import { Button, Caps, Empty, ErrorNote, IconButton, Spinner, Thumb, dayLabel, timeAgo, chapterLabel } from "../ui/kit.jsx";
import { Icon } from "../ui/icons.jsx";
import { useGql, useDownloads, chapterStatus } from "./data.js";

export default function Updates() {
  const nav = useNavigate();
  const feed = useGql(Q.updates, { first: 150 });
  const upd = useGql(Q.libraryUpdate);
  const dl = useDownloads();
  const items = feed.data?.chapters.nodes || [];
  const groups = [];
  for (const c of items) { const d = dayLabel(c.fetchedAt); (groups.at(-1)?.day === d ? groups.at(-1).items : (groups.push({ day: d, items: [] }), groups.at(-1).items)).push(c); }
  const running = upd.data?.libraryUpdateStatus.jobsInfo.isRunning;
  const check = async () => { await gql(M.updateLibrary, { cats: null }).catch(() => {}); upd.reload(); setTimeout(() => { feed.reload(); upd.reload(); }, 4000); };
  const enqueue = (ids) => { if (ids.length) gql(M.enqueue, { ids }).catch(() => {}); setTimeout(dl.refresh, 800); };
  const newOnes = items.filter((c) => !c.isRead && !c.isDownloaded && !dl.byChapter[c.id]).map((c) => c.id);

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow"><h1>Updates</h1><p className="sub">{running ? "Checking your library now…" : `Checked ${timeAgo(upd.data?.lastUpdateTimestamp?.timestamp) || "never"} · the server checks on a schedule, even when your devices are off`}</p></div>
        <Button className="hide-phone" icon="down" disabled={!newOnes.length} onClick={() => enqueue(newOnes)}>Download all new</Button>
        <Button kind="accent" icon="refresh" disabled={running} onClick={check} className="hide-phone">{running ? "Checking…" : "Check now"}</Button>
        <IconButton icon="refresh" label="Check now" className="only-phone" onClick={check} />
      </div>
      <ErrorNote error={feed.error} onRetry={feed.reload} />
      {feed.loading && !feed.data ? <Spinner /> : !items.length ? <Empty icon="bell" title="No new chapters yet">When the server finds new chapters for your library, they land here.</Empty> : (
        <div className="list">
          {groups.map((g) => (
            <div key={g.day}>
              <Caps>{g.day}</Caps>
              {g.items.map((c) => {
                const st = chapterStatus(c, dl.byChapter[c.id]);
                return (
                  <div key={c.id} className="srow">
                    <button type="button" style={{ display: "contents" }} onClick={() => nav(`/comics/series/${c.manga.id}`)}><Thumb src={c.manga.thumbnailUrl} title={c.manga.title} /></button>
                    <button type="button" className="row-text" style={{ textAlign: "left" }} onClick={() => nav(`/comics/read/${c.id}`)}>
                      <span className={`row-title${c.isRead ? " muted" : ""}`}>{c.manga.title}</span>
                      <span className="row-sub">{chapterLabel(c)} · {c.manga.source?.displayName}</span>
                    </button>
                    <button type="button" className={`status ${st.tone}`} title={st.label} onClick={() => !c.isDownloaded && !dl.byChapter[c.id] && enqueue([c.id])}>
                      <span className="hide-phone">{st.label === "Not downloaded" ? "" : st.label}</span><Icon name={st.icon} size={18} />
                    </button>
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
