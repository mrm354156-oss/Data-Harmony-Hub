// V35 — Kitchen Shield (Final Authority)
// The Judge (smartJudge) is now ADVISORY only — it reports historical Win-Rate.
// The Shield is the supreme gate: it cross-references the Judge report with the
// persistent Learning Memory (both cloud and local) BEFORE admitting any trade.
//
// Decision flow:
//   1. R:R floor (1.2 — relaxed during learning phase to grow the memory faster)
//   2. Memory Insights — reject if pattern/regime has a documented failure history
//   3. Judge advisory — strong (WR>50%) → Approved, ok → Approved with warning,
//      weak → Approved (Shield overrides) but flagged as Trend Warning,
//      insufficient → Approved with "No History" tag (still gathering data)
//
// The Shield NEVER blocks a trade purely because the Judge said "weak" — that
// authority belongs to the Memory layer. The Judge only informs sentiment.
//
// Output `wisdomSource` lets the UI show the *why* next to each recommendation.

import type { JudgeVerdict } from "./smartJudge";
import type { SniperTimeframe, SniperDirection } from "./sniperEngine";
import { getJudgeVerdict, subscribeJudgeChanges } from "./judgeAuthority";
import { getCloudBucket } from "./persistentLearning";
import { getAllLearningBuckets } from "./learningFilter";

// V35 — relaxed floors for memory-building phase
export const SHIELD_MIN_RR = 1.2;
export const SHIELD_STRONG_WR = 0.50; // ≥50% = "Strong Signal"
export const MEMORY_VETO_LOSSES = 4;  // 4+ losses with WR<35% in this exact bucket → VETO
export const MEMORY_VETO_WR = 0.35;

export type WisdomSource =
  | "Approved by Memory ✅"
  | "Strong Signal — Memory Confirmed ✅"
  | "Approved with Trend Warning ⚠️"
  | "Approved — No History (Learning Phase) 🌱"
  | "Rejected by Memory Insights ❌"
  | "Rejected — Low R:R 📉"
  | "Rejected — Historical Failures 🛑";

export interface ShieldDecision {
  allowed: boolean;
  wisdomSource: WisdomSource;
  reason: string;            // one-line UI explanation
  judgeVerdict: JudgeVerdict | null;
  memoryWinRate: number | null;
  memorySamples: number;
}

export { subscribeJudgeChanges as subscribeShieldChanges };

/**
 * Final-authority admission gate. Called by useSniperLog before logging a signal.
 */
export function decideShieldAdmission(
  symbol: string,
  tf: SniperTimeframe,
  direction: SniperDirection,
  liveRiskReward: number,
  patternLabel: string,
  regimeLabel: string,
): ShieldDecision {
  const judge = getJudgeVerdict(symbol, tf, direction);

  // 1) R:R floor — relaxed to 1.2
  if (liveRiskReward < SHIELD_MIN_RR) {
    return {
      allowed: false,
      wisdomSource: "Rejected — Low R:R 📉",
      reason: `R:R ${liveRiskReward.toFixed(2)} أقل من الحد المرن ${SHIELD_MIN_RR}`,
      judgeVerdict: judge,
      memoryWinRate: null,
      memorySamples: 0,
    };
  }

  // 2) Memory Insights — check both cloud and local buckets for documented failures
  const cloud = getCloudBucket(patternLabel || "—", regimeLabel || "—", direction, tf);
  const localBuckets = getAllLearningBuckets();
  const localExact = localBuckets.find(
    b =>
      b.timeframe === tf &&
      b.direction === direction &&
      b.regimeLabel === (regimeLabel || "—") &&
      b.pattern === (patternLabel || "—"),
  );

  // Aggregate the strongest available signal (prefer cloud — bigger sample pool)
  // localExact.total includes wins+losses (resolved only); losses = total - wins
  const localLosses = localExact ? Math.max(0, localExact.total - localExact.wins) : 0;
  const memTotal = (cloud?.total ?? 0) + (localExact?.total ?? 0);
  const memWins  = (cloud?.wins  ?? 0) + (localExact?.wins  ?? 0);
  const memLosses = (cloud?.losses ?? 0) + localLosses;
  const decisive = memWins + memLosses;
  const memWR = decisive > 0 ? memWins / decisive : null;

  // Hard veto: documented history of failure for this exact setup
  if (memLosses >= MEMORY_VETO_LOSSES && memWR !== null && memWR < MEMORY_VETO_WR) {
    return {
      allowed: false,
      wisdomSource: "Rejected — Historical Failures 🛑",
      reason: `الذاكرة: ${memLosses} خسارة سابقة بنسبة فوز ${(memWR * 100).toFixed(0)}% — لا نكرر الأخطاء`,
      judgeVerdict: judge,
      memoryWinRate: memWR,
      memorySamples: memTotal,
    };
  }

  // Loss-streak veto from local fast-cache
  if (localExact && localExact.lossStreak >= 3) {
    return {
      allowed: false,
      wisdomSource: "Rejected by Memory Insights ❌",
      reason: `سلسلة ${localExact.lossStreak} خسائر متتالية لنفس النمط — توقف مؤقت`,
      judgeVerdict: judge,
      memoryWinRate: memWR,
      memorySamples: memTotal,
    };
  }

  // 3) Judge advisory — Shield is final, but uses the report
  if (!judge || judge.verdict === "insufficient") {
    return {
      allowed: true,
      wisdomSource: "Approved — No History (Learning Phase) 🌱",
      reason: "لا تاريخ كافٍ — السماح للتعلم وبناء الذاكرة",
      judgeVerdict: judge,
      memoryWinRate: memWR,
      memorySamples: memTotal,
    };
  }

  if (judge.winRate >= SHIELD_STRONG_WR && judge.matches >= 3) {
    const memNote = memWR !== null ? ` • ذاكرة ${(memWR * 100).toFixed(0)}%` : "";
    return {
      allowed: true,
      wisdomSource: "Strong Signal — Memory Confirmed ✅",
      reason: `WR ${(judge.winRate * 100).toFixed(0)}% • ${judge.matches} مطابقة${memNote}`,
      judgeVerdict: judge,
      memoryWinRate: memWR,
      memorySamples: memTotal,
    };
  }

  if (judge.verdict === "weak") {
    return {
      allowed: true,
      wisdomSource: "Approved with Trend Warning ⚠️",
      reason: `الدرع يسمح رغم تحفّظ القاضي (WR ${(judge.winRate * 100).toFixed(0)}%) — راقب السعر`,
      judgeVerdict: judge,
      memoryWinRate: memWR,
      memorySamples: memTotal,
    };
  }

  return {
    allowed: true,
    wisdomSource: "Approved by Memory ✅",
    reason: `WR ${(judge.winRate * 100).toFixed(0)}% • R:R ${liveRiskReward.toFixed(2)}`,
    judgeVerdict: judge,
    memoryWinRate: memWR,
    memorySamples: memTotal,
  };
}
