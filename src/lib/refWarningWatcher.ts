// V33 Supreme — Dev-only Ref Warning Watcher
// Intercepts React's console.error stream in development and forwards any
// "Function components cannot be given refs" warnings (or related ref
// mismatches) into the Debug Timeline. Specifically tags warnings that
// mention Smart Judge components so the user sees them next to a rejection.

import { logDebug } from "./debugBus";

const REF_PATTERNS: RegExp[] = [
  /Function components cannot be given refs/i,
  /Cannot read propert(y|ies) of .* \(reading 'ref'\)/i,
  /forwardRef render functions accept exactly two parameters/i,
  /Attempts to access this ref will fail/i,
  /Did you mean to use React\.forwardRef/i,
];

// Components considered part of the "Judge" surface — warnings touching any
// of these get an extra explicit tag in the timeline.
const JUDGE_COMPONENTS = [
  "SmartJudgePanel",
  "JudgeRow",
  "RiskPanel",
  "LearningStatsPanel",
  "DebugTimelinePanel",
  "SniperLogPanel",
];

let installed = false;

export function installRefWarningWatcher() {
  if (installed) return;
  if (typeof window === "undefined") return;
  // Vite exposes import.meta.env.DEV; fall back to NODE_ENV for safety.
  const meta = typeof import.meta !== "undefined" ? import.meta as { env?: { DEV?: boolean } } : undefined;
  const nodeEnv = typeof process !== "undefined" ? (process as { env?: { NODE_ENV?: string } }).env?.NODE_ENV : undefined;
  const isDev = (meta?.env?.DEV) || (nodeEnv !== "production");
  if (!isDev) return;

  const origError = console.error;
  const seen = new Set<string>();

  console.error = (...args: unknown[]) => {
    try {
      const msg = args
        .map(a => (typeof a === "string" ? a : a instanceof Error ? a.message : ""))
        .join(" ");

      if (msg && REF_PATTERNS.some(re => re.test(msg))) {
        // Try to detect which component the warning is about.
        const compMatch =
          msg.match(/Check the render method of `([^`]+)`/) ||
          msg.match(/in (\w+)\b/);
        const comp = compMatch?.[1] ?? "unknown";
        const isJudge = JUDGE_COMPONENTS.some(c => msg.includes(c) || comp.includes(c));

        // Dedupe identical warnings (React fires them on every render).
        const key = `${comp}|${msg.slice(0, 120)}`;
        if (!seen.has(key)) {
          seen.add(key);
          logDebug(
            "judge",
            `⚠️ تحذير ref ${isJudge ? "في مكوّن القاضي" : ""} • ${comp} — ${msg.slice(0, 160)}`,
            { symbol: comp },
          );
        }
      }
    } catch {
      /* never break console.error */
    }
    origError.apply(console, args as []);
  };

  installed = true;
  logDebug("info", "🛡️ مراقب تحذيرات ref مفعّل (وضع التطوير)");
}
