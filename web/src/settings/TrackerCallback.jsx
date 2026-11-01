// Where a tracker sign-in lands (via suwayomi.org/tracker-oauth): hand the whole URL to Suwayomi, which reads the token or code from it.
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { gql, M } from "../lib/gql.js";
import { forget } from "../lib/api.js";
import { Button, Spinner, friendlyError } from "../ui/kit.jsx";
import { Icon } from "../ui/icons.jsx";

export default function TrackerCallback() {
  const { id } = useParams();
  const nav = useNavigate();
  const [error, setError] = useState(null);
  const once = useRef(false);
  const back = () => { let to = "/settings/tracking"; try { to = sessionStorage.getItem("tachivel:trackerReturn") || to; sessionStorage.removeItem("tachivel:trackerReturn"); } catch {} nav(to, { replace: true }); };
  useEffect(() => {
    if (once.current) return;
    once.current = true;
    gql(M.loginTrackerOAuth, { trackerId: Number(id), callbackUrl: location.href })
      .then((r) => { if (!r.loginTrackerOAuth?.isLoggedIn) throw new Error("The tracker didn't accept that sign-in. Try connecting again."); forget("gql:"); back(); })
      .catch((e) => setError(/token|code/i.test(e.message) ? new Error("The sign-in came back without a token (it was cancelled or expired). Tap Connect to try again.") : e));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="page reader-wait">
      {error ? <>
        <Icon name="alert" size={28} className="bad" />
        <p>{friendlyError(error)}</p>
        <Button onClick={back}>Back to Tracking</Button>
      </> : <><Spinner label="Signing in" /><p className="sub">Finishing the tracker sign-in…</p></>}
    </div>
  );
}
