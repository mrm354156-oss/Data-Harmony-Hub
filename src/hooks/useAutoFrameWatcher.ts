// V33 — Auto-Frame Watcher (Supreme Master Edition + All-Frames mode)
// - Default: scans 5 curated frames (perf-conscious)
// - All-Frames mode (V33 update): scans all 14 frames using cached data layer
// - 5s cooldown between auto-jumps to prevent UI thrash
// - Kill switch: when disabled, ALL background scans short-circuit

import { useEffect, useMemo, useRef, useState } from "react";
import { useSniperScan } from "./useSniperScan";
import { analyzeSniperScan, type SniperSignal, type SniperTimeframe } from "@/lib/sniperEngine";
import { loadSniperSettings } from "@/lib/sniperSettings";

const CURATED_FRAMES: SniperTimeframe[] = ["1m", "5m", "15m", "1h", "4h"];
const ALL_14_FRAMES: SniperTimeframe[] = [
  "1m", "3m", "5m", "15m", "30m",
  "1h", "2h", "4h", "6h", "8h", "12h",
  "1d", "3d", "1w",
];

const FRAME_BIAS: Record<SniperTimeframe, number> = {
  "1m": 0, "3m": 0.5, "5m": 2, "15m": 3, "30m": 2.5,
  "1h": 2, "2h": 1.5, "4h": 1, "6h": 0.5, "8h": 0.3,
  "12h": 0.2, "1d": 0.1, "3d": 0, "1w": 0,
};

export const FRAME_JUMP_COOLDOWN_MS = 5_000;

export interface FrameCandidate {
  frame: SniperTimeframe;
  topSignal: SniperSignal | null;
  passedCount: number;
  topScore: number;
  loading: boolean;
  ready: boolean;
}

export interface AutoFrameWatcherResult {
  enabled: boolean;
  candidates: FrameCandidate[];
  bestFrame: SniperTimeframe | null;
  bestSignal: SniperSignal | null;
  scanningCount: number;
  scannedFrames: SniperTimeframe[];
}

export function useAutoFrameWatcher(enabled: boolean): AutoFrameWatcherResult {
  // Read setting once + listen for changes (re-render on toggle)
  const [allFrames, setAllFrames] = useState<boolean>(() => loadSniperSettings().autoFrameAllFrames);
  useEffect(() => {
    const onChange = () => setAllFrames(loadSniperSettings().autoFrameAllFrames);
    window.addEventListener("sniper-settings-changed", onChange);
    return () => window.removeEventListener("sniper-settings-changed", onChange);
  }, []);

  // Hooks must run unconditionally — mount one query per frame.
  // We mount ALL 14 always, but only `enabled` flag controls fetching.
  const q1m  = useSniperScan("1m",  enabled);
  const q3m  = useSniperScan("3m",  enabled && allFrames);
  const q5m  = useSniperScan("5m",  enabled);
  const q15m = useSniperScan("15m", enabled);
  const q30m = useSniperScan("30m", enabled && allFrames);
  const q1h  = useSniperScan("1h",  enabled);
  const q2h  = useSniperScan("2h",  enabled && allFrames);
  const q4h  = useSniperScan("4h",  enabled);
  const q6h  = useSniperScan("6h",  enabled && allFrames);
  const q8h  = useSniperScan("8h",  enabled && allFrames);
  const q12h = useSniperScan("12h", enabled && allFrames);
  const q1d  = useSniperScan("1d",  enabled && allFrames);
  const q3d  = useSniperScan("3d",  enabled && allFrames);
  const q1w  = useSniperScan("1w",  enabled && allFrames);

  const queryMap = {
    "1m": q1m, "3m": q3m, "5m": q5m, "15m": q15m, "30m": q30m,
    "1h": q1h, "2h": q2h, "4h": q4h, "6h": q6h, "8h": q8h, "12h": q12h,
    "1d": q1d, "3d": q3d, "1w": q1w,
  } as const;

  const scannedFrames = allFrames ? ALL_14_FRAMES : CURATED_FRAMES;

  return useMemo<AutoFrameWatcherResult>(() => {
    if (!enabled) {
      return { enabled: false, candidates: [], bestFrame: null, bestSignal: null, scanningCount: 0, scannedFrames };
    }

    const candidates: FrameCandidate[] = scannedFrames.map(frame => {
      const q = queryMap[frame];
      const data = q.data;
      const fng = data?.fearGreed ?? null;
      const signals = data ? analyzeSniperScan(data.symbols, frame, fng) : [];
      const passed = signals.filter(s => s.passed && !s.suppressed && !s.emergencyExit);
      passed.sort((a, b) => (b.multiIndicator.confidence - a.multiIndicator.confidence)
        || (b.quality.total - a.quality.total));
      const top = passed[0] ?? null;
      return {
        frame,
        topSignal: top,
        passedCount: passed.length,
        topScore: top ? top.multiIndicator.confidence + top.quality.total / 10 : 0,
        loading: q.isLoading,
        ready: !!data,
      };
    });

    let best: FrameCandidate | null = null;
    for (const c of candidates) {
      if (!c.topSignal) continue;
      const adjusted = c.topScore + (FRAME_BIAS[c.frame] ?? 0);
      const bestAdjusted = best ? best.topScore + (FRAME_BIAS[best.frame] ?? 0) : -Infinity;
      if (adjusted > bestAdjusted) best = c;
    }

    return {
      enabled: true,
      candidates,
      bestFrame: best?.frame ?? null,
      bestSignal: best?.topSignal ?? null,
      scanningCount: candidates.filter(c => c.loading).length,
      scannedFrames,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    enabled, allFrames,
    q1m.data, q3m.data, q5m.data, q15m.data, q30m.data,
    q1h.data, q2h.data, q4h.data, q6h.data, q8h.data, q12h.data,
    q1d.data, q3d.data, q1w.data,
    q1m.isLoading, q3m.isLoading, q5m.isLoading, q15m.isLoading, q30m.isLoading,
    q1h.isLoading, q2h.isLoading, q4h.isLoading, q6h.isLoading, q8h.isLoading, q12h.isLoading,
    q1d.isLoading, q3d.isLoading, q1w.isLoading,
  ]);
}

/** Anti-jitter cooldown gate. */
export function useJumpCooldown() {
  const lastJumpRef = useRef<number>(0);
  const [, force] = useState(0);
  const canJump = () => Date.now() - lastJumpRef.current >= FRAME_JUMP_COOLDOWN_MS;
  const markJump = () => { lastJumpRef.current = Date.now(); force(t => t + 1); };
  const remainingMs = () => Math.max(0, FRAME_JUMP_COOLDOWN_MS - (Date.now() - lastJumpRef.current));
  return { canJump, markJump, remainingMs, lastJumpAt: lastJumpRef.current };
}
