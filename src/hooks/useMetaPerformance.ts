// Meta Performance Filter
// Reads the recent sniper log and produces a "metaPenalty" 0..15
// that the engine adds onto its dynamic thresholds. When recent
// signals are losing, the system becomes stricter; when they win,
// it relaxes back to baseline.
import { useMemo } from "react";
import type { LoggedSniperSignal } from "@/hooks/useSniperLog";

export interface MetaInsight {
  recentResolved: number;
  recentWins: number;
  recentLosses: number;
  recentWinRate: number;   // 0..100
  metaPenalty: number;     // 0..15 (higher = stricter)
  mood: "boosting" | "neutral" | "defensive" | "lockdown";
  moodLabel: string;
}

const LOOKBACK = 15;          // last 15 resolved
const LOSS_TRIGGER = 50;      // win rate below this → tighten
const STRONG_WIN = 70;        // above this → relax

export function useMetaPerformance(log: LoggedSniperSignal[]): MetaInsight {
  return useMemo(() => {
    const resolved = log
      .filter(l => l.outcome !== "pending" && l.outcome !== "expired")
      .slice(0, LOOKBACK);
    const wins = resolved.filter(l => l.outcome === "target1" || l.outcome === "target2").length;
    const losses = resolved.length - wins;
    const winRate = resolved.length > 0 ? (wins / resolved.length) * 100 : 100;

    let metaPenalty = 0;
    let mood: MetaInsight["mood"] = "neutral";
    let moodLabel = "✓ أداء طبيعي — لا تعديلات";

    if (resolved.length < 3) {
      // not enough data
      metaPenalty = 0;
      mood = "neutral";
      moodLabel = "🆕 جاري بناء قاعدة بيانات الأداء";
    } else if (winRate >= STRONG_WIN) {
      metaPenalty = 0;
      mood = "boosting";
      moodLabel = `🚀 أداء قوي (${Math.round(winRate)}%) — النمط فعّال`;
    } else if (winRate >= LOSS_TRIGGER) {
      metaPenalty = 3;
      mood = "neutral";
      moodLabel = `✓ أداء معتدل (${Math.round(winRate)}%)`;
    } else if (winRate >= 30) {
      metaPenalty = 8;
      mood = "defensive";
      moodLabel = `🛡️ نمط دفاعي — رفع الصرامة (Win ${Math.round(winRate)}%)`;
    } else {
      metaPenalty = 15;
      mood = "lockdown";
      moodLabel = `🔒 وضع قفل — صرامة قصوى (Win ${Math.round(winRate)}%)`;
    }

    return {
      recentResolved: resolved.length,
      recentWins: wins,
      recentLosses: losses,
      recentWinRate: Math.round(winRate),
      metaPenalty,
      mood,
      moodLabel,
    };
  }, [log]);
}

// Singleton mirror — engine reads this synchronously during scan analysis.
let _currentPenalty = 0;
export function setEngineMetaPenalty(p: number) { _currentPenalty = p; }
export function getEngineMetaPenalty(): number { return _currentPenalty; }
