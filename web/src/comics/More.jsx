// More (phone M7): the things that don't fit in the tab bar.
import { useNavigate } from "react-router-dom";
import { Button, Row } from "../ui/kit.jsx";
import { useComicPrefs, useDownloads } from "./data.js";

export default function More() {
  const nav = useNavigate();
  const [prefs, setPrefs] = useComicPrefs();
  const dl = useDownloads();
  const waiting = dl.queue.filter((d) => d.state === "ERROR" || d.tries > 0).length;
  return (
    <div className="page">
      <h1>More</h1>
      <div className="group" style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 16 }}>
        <span className="row-text"><span className="row-title">You're in Comics</span><span className="row-sub">Switch to Novels to keep listening</span></span>
        <Button kind="soft" small onClick={() => nav("/")}>Novels</Button>
      </div>
      <div className="list">
        <Row icon="incognito" title="Incognito mode" sub="Pauses history and progress on this device" toggle={prefs.incognito} onToggle={(incognito) => setPrefs({ incognito })} />
        <Row icon="down" title="Download queue" sub={dl.queue.length ? `${dl.queue.length} in the queue${waiting ? ` · ${waiting} waiting on the source` : ""}` : "Nothing downloading"} value={dl.queue.length || ""} chevron onClick={() => nav("/comics/downloads")} />
        <Row icon="tag" title="Categories" chevron onClick={() => nav("/settings/library")} />
        <Row icon="backup" title="Backup and restore" sub="Bring your library over from another app" chevron onClick={() => nav("/settings/backup")} />
        <Row icon="settings" title="Settings" chevron onClick={() => nav("/settings")} />
        <Row icon="info" title="About" chevron onClick={() => nav("/settings/about")} />
      </div>
    </div>
  );
}
