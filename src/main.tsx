import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { installRefWarningWatcher } from "./lib/refWarningWatcher";

installRefWarningWatcher();

// ── PWA: Register Service Worker ──────────────────────────────────
// Enables "Add to Home Screen" on Android and offline caching.
if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        navigator.serviceWorker
            .register("/service-worker.js")
            .then((reg) => {
                console.log("✅ Service Worker registered:", reg.scope);
            })
            .catch((err) => {
                console.warn("⚠️ Service Worker registration failed:", err);
            });
    });
}

createRoot(document.getElementById("root")!).render(<App />);
