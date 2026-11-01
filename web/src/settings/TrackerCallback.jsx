// Where a tracker sign-in lands (via suwayomi.org/tracker-oauth): hand the whole URL to Suwayomi, which reads the token or code from it.
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { gql, M } from "../lib/gql.js";
import { forget } from "../lib/api.js";
import { TRACKER_NONCE } from "../comics/data.js";
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
    // Only finish a sign-in this device started in the last 15 minutes, for this tracker.
    let saved = null, returned = null;
    try { saved = JSON.parse(localStorage.getItem(TRACKER_NONCE) || "null"); localStorage.removeItem(TRACKER_NONCE); } catch {}
    try { returned = JSON.parse(new URLSearchParams(location.search).get("state") || "null"); } catch {}
    if (!saved || !returned?.nonce || saved.nonce !== returned.nonce || saved.id !== Number(id) || Date.now() - saved.at > 15 * 60e3) {
      setError(new Error("This sign-in wasn't started from Tachivel on this device, so it was ignored. Tap Connect to sign in."));
      return;
    }
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
