// V42 — PWA Install Prompt
// Shows a banner asking the user to install the app as a PWA.
// Also registers the service worker for offline support.

import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";

// beforeinstallprompt is a non-standard Event that has prompt() and userChoice
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BeforeInstallPromptEvent = Event & { prompt: () => any; userChoice: any };

const InstallAppPrompt = () => {
    const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
    const [showPrompt, setShowPrompt] = useState(false);
    const [isInstalled, setIsInstalled] = useState(false);
    const [dismissed, setDismissed] = useState(false);

    useEffect(() => {
        // Check if already installed (standalone mode)
        if (window.matchMedia("(display-mode: standalone)").matches) {
            setIsInstalled(true);
            return;
        }

        // Register service worker
        if ("serviceWorker" in navigator) {
            navigator.serviceWorker.register("/service-worker.js").catch(() => {
                // Silently fail — service worker is optional
            });
        }

        // Listen for the `beforeinstallprompt` event
        const handler = (e: Event) => {
            e.preventDefault();
            setDeferredPrompt(e as BeforeInstallPromptEvent);
            // Show our install banner after a short delay
            setTimeout(() => setShowPrompt(true), 3000);
        };
        window.addEventListener("beforeinstallprompt", handler);

        // Check if app was installed (appinstalled event)
        const installedHandler = () => {
            setIsInstalled(true);
            setShowPrompt(false);
            setDeferredPrompt(null);
        };
        window.addEventListener("appinstalled", installedHandler);

        // Check localStorage for dismissal
        try {
            const val = localStorage.getItem("helwa_install_dismissed");
            if (val === "1") setDismissed(true);
        } catch { /* ignore */ }

        return () => {
            window.removeEventListener("beforeinstallprompt", handler);
            window.removeEventListener("appinstalled", installedHandler);
        };
    }, []);

    const handleInstall = async () => {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        const result = await deferredPrompt.userChoice;
        if (result.outcome === "accepted") {
            setIsInstalled(true);
            setShowPrompt(false);
            setDeferredPrompt(null);
        }
    };

    const handleDismiss = () => {
        setShowPrompt(false);
        setDismissed(true);
        try { localStorage.setItem("helwa_install_dismissed", "1"); } catch { /* ignore */ }
    };

    // Don't show if already installed, dismissed, or no prompt available
    if (isInstalled || dismissed || !showPrompt || !deferredPrompt) return null;

    return (
        <div className="fixed bottom-24 inset-x-4 z-50 max-w-lg mx-auto animate-slide-up">
            <div className="bg-card/95 backdrop-blur-xl border border-border rounded-2xl p-4 shadow-2xl flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-gold/20 flex items-center justify-center shrink-0">
                    <img src="/logo.jpeg" alt="" className="w-8 h-8 rounded-lg" />
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-foreground">نزّل حلاوة</p>
                    <p className="text-[11px] text-muted-foreground">حمل التطبيق على جهازك واستخدمه في أي وقت</p>
                </div>
                <button
                    onClick={handleInstall}
                    className="flex items-center gap-1 px-4 py-2 rounded-xl gradient-gold text-primary-foreground font-bold text-sm whitespace-nowrap hover:scale-105 active:scale-95 transition-all"
                >
                    <Download className="w-4 h-4" />
                    نزّل
                </button>
                <button
                    onClick={handleDismiss}
                    className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground shrink-0"
                    title="إغلاق"
                >
                    <X className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
};

export default InstallAppPrompt;