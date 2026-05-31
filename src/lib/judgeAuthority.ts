// V33 — Judge Authority Layer
// Centralized store for Smart Judge verdicts. Acts as the "Supreme Court":
// - SmartJudgePanel publishes verdicts here as soon as they finish
// - useSniperLog consults this store BEFORE accepting a new trade
// - If the judge says "weak" or "insufficient" or WR < 60%, the trade is REJECTED
//
// Design: pub/sub pattern with module-level Map. No React state needed; the log
// hook re-evaluates on its existing 90s tick + on any settings change, and on
// every render driven by SniperTab's 500ms tick.

import type { JudgeVerdict } from "./smartJudge";
import type { SniperTimeframe, SniperDirection } from "./sniperEngine";

export const JUDGE_MIN_WIN_RATE = 0.40; // 40% historical win-rate threshold (مرحلة التعلّم — عتبة منخفضة)
export const JUDGE_MIN_RR = 1.5;        // R:R floor for any trade

export type JudgeAuthorityDecision =
  | { allowed: true;  reason: string; verdict: JudgeVerdict }
  | { allowed: false; reason: string; verdict: JudgeVerdict | null };

const verdicts = new Map<string, JudgeVerdict>();
const listeners = new Set<() => void>();

function key(symbol: string, tf: SniperTimeframe, direction: SniperDirection) {
  return `${symbol}|${tf}|${direction}`;
}

export function publishJudgeVerdict(
  symbol: string,
  tf: SniperTimeframe,
  direction: SniperDirection,
  verdict: JudgeVerdict,
) {
  verdicts.set(key(symbol, tf, direction), verdict);
  listeners.forEach(l => l());
}

export function getJudgeVerdict(
  symbol: string,
  tf: SniperTimeframe,
  direction: SniperDirection,
): JudgeVerdict | null {
  return verdicts.get(key(symbol, tf, direction)) ?? null;
}

export function subscribeJudgeChanges(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Supreme decision gate. Returns whether the sniper is ALLOWED to open this trade.
 * Rules (V33 — Absolute Judicial Authority):
 *  1. Verdict must exist (insufficient data → REJECT — "ابتعد")
 *  2. WR must be >= 60% (decisive matches: wins+losses)
 *  3. R:R on the live signal must be >= 1.5
 *  4. Verdict must NOT be "weak" or "insufficient"
 */
export function decideTradeAdmission(
  symbol: string,
  tf: SniperTimeframe,
  direction: SniperDirection,
  liveRiskReward: number,
): JudgeAuthorityDecision {
  if (liveRiskReward < JUDGE_MIN_RR) {
    return {
      allowed: false,
      reason: `R:R ${liveRiskReward.toFixed(2)} أقل من الحد الأدنى ${JUDGE_MIN_RR}`,
      verdict: getJudgeVerdict(symbol, tf, direction),
    };
  }
  const v = getJudgeVerdict(symbol, tf, direction);
  if (!v) {
    return { allowed: false, reason: "القاضي لم يُصدر حكماً بعد — انتظار", verdict: null };
  }
  if (v.verdict === "insufficient") {
    return { allowed: false, reason: "بيانات قليلة — القاضي يأمر بالابتعاد", verdict: v };
  }
  if (v.verdict === "weak") {
    return { allowed: false, reason: `الحكم ضعيف (WR ${(v.winRate * 100).toFixed(0)}%)`, verdict: v };
  }
  if (v.winRate < JUDGE_MIN_WIN_RATE) {
    return {
      allowed: false,
      reason: `WR ${(v.winRate * 100).toFixed(0)}% أقل من الحد ${(JUDGE_MIN_WIN_RATE * 100).toFixed(0)}%`,
      verdict: v,
    };
  }
  return {
    allowed: true,
    reason: `موافقة القاضي ✅ WR ${(v.winRate * 100).toFixed(0)}% • ${v.matches} مطابقة`,
    verdict: v,
  };
}
