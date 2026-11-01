import { StrictMode, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider, useRouteError } from "react-router-dom";
import "../../styles/tokens.css";
import "./styles/app.css";
import { SettingsProvider } from "./lib/settings.js";
import Shell from "./shell/Shell.jsx";
import NovelsLibrary from "./novels/Library.jsx";
import { Spinner, Button } from "./ui/kit.jsx";

// After a redeploy, the open app may ask for code files that no longer exist. Reload once instead of crashing.
addEventListener("vite:preloadError", (e) => {
  e.preventDefault();
  if (!sessionStorage.getItem("tachivel:reloaded")) { sessionStorage.setItem("tachivel:reloaded", "1"); location.reload(); }
});
addEventListener("load", () => setTimeout(() => sessionStorage.removeItem("tachivel:reloaded"), 5000));
function Crashed() {
  // Only a code file missing after a redeploy means "updated"; anything else is a real fault, so say what it was.
  const error = useRouteError();
  const stale = /dynamically imported module|Importing a module script failed|error loading dynamically|preload/i.test(String(error?.message || error));
  return (
    <div className="empty" style={{ minHeight: "100vh", alignContent: "center" }}>
      <h2>{stale ? "Tachivel was updated" : "Something went wrong on this screen"}</h2>
      <p>{stale ? "Reload to get the new version. Your place and library are safe." : `${error?.message || error}. Your place and library are safe.`}</p>
      <div className="actions" style={{ justifyContent: "center" }}>
        <Button kind="accent" icon="refresh" onClick={() => location.reload()}>Reload</Button>
        {!stale && <Button onClick={() => { location.href = "/"; }}>Go home</Button>}
      </div>
    </div>
  );
}

// Screens load on demand so the first one opens fast, then the rest are fetched in the background,
// so switching tabs never waits on the network for code.
const loaders = [];
const page = (load) => { loaders.push(load); const C = lazy(load); return <Suspense fallback={<Spinner />}><C /></Suspense>; };
const preload = () => loaders.forEach((l) => l().catch(() => {}));

const router = createBrowserRouter([
  {
    element: <Shell />,
    errorElement: <Crashed />,
    children: [
      { path: "/", element: <NovelsLibrary /> },
      { path: "/comics", element: page(() => import("./comics/Library.jsx")) },
      { path: "/comics/series/:id", element: page(() => import("./comics/Series.jsx")) },
      { path: "/comics/updates", element: page(() => import("./comics/Updates.jsx")) },
      { path: "/comics/history", element: page(() => import("./comics/History.jsx")) },
      { path: "/comics/downloads", element: page(() => import("./comics/Downloads.jsx")) },
      { path: "/comics/browse", element: page(() => import("./comics/Browse.jsx")) },
      { path: "/comics/browse/:tab", element: page(() => import("./comics/Browse.jsx")) },
      { path: "/comics/source/:id", element: page(() => import("./comics/Catalogue.jsx")) },
      { path: "/comics/search", element: page(() => import("./comics/GlobalSearch.jsx")) },
      { path: "/comics/migrate/:id", element: page(() => import("./comics/Migrate.jsx")) },
      { path: "/comics/more", element: page(() => import("./comics/More.jsx")) },
      { path: "/tracker-oauth/:id", element: page(() => import("./settings/TrackerCallback.jsx")) },
      { path: "/settings", element: page(() => import("./settings/Settings.jsx")) },
      { path: "/settings/:section", element: page(() => import("./settings/Settings.jsx")) },
    ],
  },
  // The comic reader takes the whole screen.
  { path: "/comics/read/:chapterId", element: page(() => import("./comics/Reader.jsx")), errorElement: <Crashed /> },
]);

// Offline pages and installability. Ask the browser to keep our storage (iOS then won't evict saved chapters).
if ("serviceWorker" in navigator && import.meta.env.PROD) navigator.serviceWorker.register("/sw.js").catch(() => {});
navigator.storage?.persist?.().catch(() => {});
// iOS Safari only shows :active (the pressed look) when the page listens for touches.
document.addEventListener("touchstart", () => {}, { passive: true });
(window.requestIdleCallback || ((f) => setTimeout(f, 1500)))(preload);

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <SettingsProvider>
      <RouterProvider router={router} />
    </SettingsProvider>
  </StrictMode>,
);
