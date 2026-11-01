// Download queue (Figma V5, phone M14): downloading, waiting on the source, queued; plus the 30 GB meter.
import { useNavigate } from "react-router-dom";
import { gql, M } from "../lib/gql.js";
import { api, useLoad } from "../lib/api.js";
import { Button, Caps, Empty, IconButton, Progress, Thumb } from "../ui/kit.jsx";
import { Icon } from "../ui/icons.jsx";
import { useDownloads, num } from "./data.js";

const gb = (b) => `${(b / 1073741824).toFixed(1)} GB`;

export function StorageMeter() {
  const s = useLoad(api.storage);
  if (!s.data) return null;
  const { total, used } = s.data;
  return (
    <div className="group" style={{ gap: 8, padding: "12px 16px", minWidth: 240 }}>
      <span style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}><Icon name="storage" size={16} className="muted" /><b style={{ fontWeight: 500 }}>{gb(used)} of {gb(total)} used</b></span>
      <Progress value={used / total} />
    </div>
  );
}

export default function Downloads() {
  const nav = useNavigate();
  const dl = useDownloads();
  const q = dl.queue;
  const downloading = q.filter((d) => d.state === "DOWNLOADING");
  const blocked = q.filter((d) => d.state === "ERROR" || (d.state === "QUEUED" && d.tries > 0));
  const queued = q.filter((d) => d.state === "QUEUED" && !d.tries);
  const act = (mut, vars) => gql(mut, vars).catch(() => {}).finally(() => setTimeout(dl.refresh, 600));
  const item = (d, right, tone, prog) => (
    <div key={d.chapter.id} className="srow">
      <button type="button" style={{ display: "contents" }} onClick={() => nav(`/comics/series/${d.manga.id}`)}><Thumb src={d.manga.thumbnailUrl} title={d.manga.title} /></button>
      <span className="row-text"><span className="row-title">{d.manga.title}</span><span className="row-sub">Chapter {num(d.chapter.chapterNumber)}{d.chapter.pageCount ? ` · ${d.chapter.pageCount} pages` : ""}</span>{prog != null && <Progress value={prog} />}</span>
      <span className={`status ${tone}`}>{right}</span>
      <IconButton icon="close" label="Cancel" size={18} onClick={() => act(M.dequeue, { ids: [d.chapter.id] })} />
    </div>
  );

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow"><h1>Downloads</h1><p className="sub">Saved on your server, so every device opens them instantly. No chapter limit.</p></div>
        <StorageMeter />
        {dl.state === "STARTED"
          ? <Button icon="pause" onClick={() => act(M.stopDownloader)}>Pause all</Button>
          : <Button kind="accent" icon="play" onClick={() => act(M.startDownloader)} disabled={!q.length}>Resume</Button>}
        {q.length > 0 && <Button kind="ghost" icon="trash" onClick={() => confirm("Clear the whole queue?") && act(M.clearDownloader)}>Clear</Button>}
      </div>
      {!q.length ? <Empty icon="down" title="Nothing downloading">Pick chapters on a series page, or turn on automatic downloads in Settings.</Empty> : (
        <div className="list">
          {downloading.length > 0 && <><Caps>Downloading</Caps>{downloading.map((d) => item(d, `${Math.round(d.progress * 100)}%`, "accent", d.progress))}</>}
          {blocked.length > 0 && <><Caps>Waiting on the source</Caps>
            <p className="sub" style={{ padding: "0 16px 8px" }}>The source is blocking requests right now (usually a Cloudflare check). The server retries on its own and keeps their place in line. You can still read these chapters live.</p>
            {blocked.map((d) => item(d, <><Icon name="alert" size={16} /> Try {d.tries + 1}</>, "warn"))}</>}
          {queued.length > 0 && <><Caps>Queued · {queued.length}</Caps>{queued.map((d) => item(d, <><Icon name="clock" size={16} /> Queued</>, ""))}</>}
        </div>
      )}
      {dl.state !== "STARTED" && q.length > 0 && <div className="note"><Icon name="pause" /><span>Downloads are paused.</span></div>}
    </div>
  );
}
