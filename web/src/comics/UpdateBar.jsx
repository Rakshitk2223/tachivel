// "Checking for new chapters" strip, like Mihon's update notification: progress, the series being checked, and Cancel.
// Server-driven, so it also shows the automatic daily check, on whichever comics screen is open.
import { useEffect, useRef, useState } from "react";
import { gql, Q, M } from "../lib/gql.js";
import { IconButton, Progress } from "../ui/kit.jsx";

export const UPDATE_STARTED = "tachivel:update-started";

export default function UpdateBar() {
  const [st, setSt] = useState(null); // { total, done, current, failed } while running; { finished, failed } briefly after
  const [stopping, setStopping] = useState(false);
  const timer = useRef(), wasRunning = useRef(false), cancelled = useRef(false), last = useRef({ done: 0, total: 0 });

  useEffect(() => {
    let live = true;
    const poll = async () => {
      clearTimeout(timer.current);
      let running = false;
      try {
        const s = (await gql(Q.updateProgress)).libraryUpdateStatus;
        if (!live) return;
        running = s.jobsInfo.isRunning;
        const failed = s.mangaUpdates.filter((u) => u.status === "FAILED").length;
        if (running) {
          last.current = { done: s.jobsInfo.finishedJobs, total: s.jobsInfo.totalJobs };
          setSt({ total: s.jobsInfo.totalJobs, done: s.jobsInfo.finishedJobs, current: s.mangaUpdates.find((u) => u.status === "RUNNING")?.manga.title, failed });
        } else if (wasRunning.current) {
          // A stopped check resets the server's counters, so report the last counts seen while it ran.
          const c = cancelled.current ? last.current : { done: s.jobsInfo.finishedJobs, total: s.jobsInfo.totalJobs };
          setSt({ finished: c.done, total: c.total, failed, cancelled: cancelled.current }); setStopping(false); cancelled.current = false;
          dispatchEvent(new Event("tachivel:pull")); // every open screen picks up the new chapters
          setTimeout(() => live && setSt((x) => (x?.finished != null ? null : x)), 5000);
        }
        wasRunning.current = running;
      } catch { /* offline or signed out: try again later */ }
      // Quick while a check runs; otherwise just often enough to notice the server's automatic one.
      if (live && !document.hidden) timer.current = setTimeout(poll, running ? 1500 : 30000);
    };
    const kick = () => poll();
    poll();
    addEventListener(UPDATE_STARTED, kick);
    document.addEventListener("visibilitychange", kick);
    return () => { live = false; clearTimeout(timer.current); removeEventListener(UPDATE_STARTED, kick); document.removeEventListener("visibilitychange", kick); };
  }, []);

  if (!st) return null;
  if (st.finished != null) return (
    <div className="update-bar done" role="status">
      <span className="grow">{st.cancelled ? `Check cancelled${st.total ? ` · ${st.finished} of ${st.total} done` : ""}` : `Checked ${st.finished} series`}{st.failed ? ` · ${st.failed} couldn't be reached` : ""}</span>
      <IconButton icon="close" label="Dismiss" size={18} onClick={() => setSt(null)} />
    </div>
  );
  return (
    <div className="update-bar" role="status" aria-live="polite">
      <div className="grow">
        <div className="update-text"><b>{stopping ? "Stopping…" : "Checking for new chapters"}</b><span>{st.done} of {st.total}</span></div>
        <Progress value={st.total ? st.done / st.total : 0} />
        {st.current && <small>{st.current}</small>}
      </div>
      <IconButton icon="close" label="Cancel the check" disabled={stopping} onClick={async () => { setStopping(true); cancelled.current = true; await gql(M.updateStop).catch(() => setStopping(false)); dispatchEvent(new Event(UPDATE_STARTED)); }} />
    </div>
  );
}
