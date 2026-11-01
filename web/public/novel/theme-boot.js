// Paint in the right theme from the first frame (shared with the main app).
try { const t = JSON.parse(localStorage.getItem("tachivel:settings") || "{}").theme; if (t) document.documentElement.dataset.theme = t; } catch {}
