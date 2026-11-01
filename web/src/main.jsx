import { StrictMode, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import "../../styles/tokens.css";
import "./styles/app.css";
import { SettingsProvider } from "./lib/settings.js";
import Shell from "./shell/Shell.jsx";
import NovelsLibrary from "./novels/Library.jsx";
import { Spinner } from "./ui/kit.jsx";

// Comics and settings load on demand so the novels shelf opens fast.
const page = (load) => { const C = lazy(load); return <Suspense fallback={<Spinner />}><C /></Suspense>; };

const router = createBrowserRouter([
  {
    element: <Shell />,
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
      { path: "/settings", element: page(() => import("./settings/Settings.jsx")) },
      { path: "/settings/:section", element: page(() => import("./settings/Settings.jsx")) },
    ],
  },
  // The comic reader takes the whole screen.
  { path: "/comics/read/:chapterId", element: page(() => import("./comics/Reader.jsx")) },
]);

// Offline pages and installability. Ask the browser to keep our storage (iOS then won't evict saved chapters).
if ("serviceWorker" in navigator && import.meta.env.PROD) navigator.serviceWorker.register("/sw.js").catch(() => {});
navigator.storage?.persist?.().catch(() => {});

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <SettingsProvider>
      <RouterProvider router={router} />
    </SettingsProvider>
  </StrictMode>,
);
