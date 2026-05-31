// V20 → V26 Self-Learning Filter
// Reads resolved sniper-log entries from localStorage and produces a per-bucket
// win-rate map with TIME-DECAY weighting. The engine multiplies a signal's
// confidence by the bucket factor to penalize historically losing setups
// (e.g. "shooting_star + range + short on 5m") and reward winning ones.
//
// V26 changes vs V20:
//   • Time-decay weighting (recent trades count more) — half-life ≈ 30 trades
//   • Two-tier lookup: exact bucket → regime-only fallback
//   • Loss-streak detection: 3+ consecutive losses adds extra penalty
//   • MIN_SAMPLES raised 4 → 5 to reduce noise
//   • MAX_PENALTY raised 12 → 15 (harder punishment for failing patterns)
//   • Returns `source` and `lossStreak` for transparency

import type { SniperTimeframe, SniperDirection } from "./sniperEngine";
import type { MarketRegime } from "./qualityEngine";
import { getCloudBucket } from "./persistentLearning";

const STORAGE_KEY = "sniper_signal_log_v2";
const MIN_SAMPLES_EXACT = 5;
const MIN_SAMPLES_FALLBACK = 6;
const MAX_PENALTY_PCT = 15;
const MAX_BOOST_PCT = 6;
const HALF_LIFE_TRADES = 30;
const STREAK_PENALTY_PCT = 5; // extra penalty when loss-streak ≥ 3

export type LearningSource = "exact" | "regime-fallback" | "cloud" | "none";

export interface BucketStats {
  key: string;
  total: number;
  weightedTotal: number;
  wins: number;
  weightedWins: number;
  winRate: number;        // 0..1 (time-weighted)
  factor: number;         // multiplier applied to confidence
  adjustment: number;     // signed % (-15..+6, before streak)
  lossStreak: number;     // most recent consecutive losses in this bucket
  pattern: string;
  regimeLabel: string;
  direction: SniperDirection;
  timeframe: SniperTimeframe;
}

interface RawLog {
  symbol: string;
  timeframe: SniperTimeframe;
  direction: SniperDirection;
  patternLabel: string;
  regimeLabel?: string;
  outcome: string;
  resolvedAt?: number;
  createdAt: number;
}

function loadLog(): RawLog[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as RawLog[];
  } catch { return []; }
}

function exactKey(pattern: string, regime: string, direction: SniperDirection, tf: SniperTimeframe): string {
  return `EX|${tf}|${direction}|${regime}|${pattern}`;
}
function fallbackKey(regime: string, direction: SniperDirection, tf: SniperTimeframe): string {
  return `FB|${tf}|${direction}|${regime}`;
}

let _exactCache: Map<string, BucketStats> = new Map();
let _fallbackCache: Map<string, BucketStats> = new Map();
let _lastBuildTs = 0;

/** Compute a 0..1 weight where the most recent resolved trade weighs 1.0 and
 *  decays exponentially with half-life HALF_LIFE_TRADES. */
function decayWeight(rankFromNewest: number): number {
  return Math.pow(0.5, rankFromNewest / HALF_LIFE_TRADES);
}

function isWin(outcome: string): boolean { return outcome === "target1" || outcome === "target2"; }
function isLoss(outcome: string): boolean { return outcome === "stopLoss" || outcome === "emergencyExit"; }
function isResolved(outcome: string): boolean { return outcome !== "pending" && outcome !== "expired"; }

function buildBucket(
  key: string,
  items: { log: RawLog; rank: number }[],
  pattern: string,
): BucketStats | null {
  let weightedWins = 0;
  let weightedTotal = 0;
  for (const { log: l, rank } of items) {
    const w = decayWeight(rank);
    weightedTotal += w;
    if (isWin(l.outcome)) weightedWins += w;
  }
  const winRate = weightedTotal > 0 ? weightedWins / weightedTotal : 0;
  // Map weighted win-rate to multiplicative adjustment:
  //   winRate 0.30 → -14 → capped at -15
  //   winRate 0.50 → -6
  //   winRate 0.65 → 0   (neutral)
  //   winRate 0.80 → +6  (capped)
  let adjustment = (winRate - 0.65) * 40;
  if (adjustment > MAX_BOOST_PCT) adjustment = MAX_BOOST_PCT;
  if (adjustment < -MAX_PENALTY_PCT) adjustment = -MAX_PENALTY_PCT;

  // Loss streak (most recent N items in bucket — items already sorted newest-first)
  let lossStreak = 0;
  for (const { log: l } of items) {
    if (isLoss(l.outcome)) lossStreak++;
    else if (isWin(l.outcome)) break;
  }
  if (lossStreak >= 3) adjustment -= STREAK_PENALTY_PCT;
  if (adjustment < -MAX_PENALTY_PCT - STREAK_PENALTY_PCT) {
    adjustment = -MAX_PENALTY_PCT - STREAK_PENALTY_PCT;
  }
  const factor = 1 + adjustment / 100;
  const first = items[0].log;
  return {
    key,
    total: items.length,
    weightedTotal,
    wins: items.filter(i => isWin(i.log.outcome)).length,
    weightedWins,
    winRate,
    factor,
    adjustment,
    lossStreak,
    pattern,
    regimeLabel: first.regimeLabel || "—",
    direction: first.direction,
    timeframe: first.timeframe,
  };
}

function rebuild(): void {
  const log = loadLog();
  // Newest-first ordering for decay (log is already stored newest-first by useSniperLog)
  const resolved = log.filter(l => isResolved(l.outcome));

  const exactGroups = new Map<string, { log: RawLog; rank: number }[]>();
  const fbGroups = new Map<string, { log: RawLog; rank: number }[]>();

  resolved.forEach((l, idx) => {
    const ex = exactKey(l.patternLabel || "—", l.regimeLabel || "—", l.direction, l.timeframe);
    const fb = fallbackKey(l.regimeLabel || "—", l.direction, l.timeframe);
    (exactGroups.get(ex) ?? exactGroups.set(ex, []).get(ex)!).push({ log: l, rank: idx });
    (fbGroups.get(fb) ?? fbGroups.set(fb, []).get(fb)!).push({ log: l, rank: idx });
  });

  const exactOut = new Map<string, BucketStats>();
  for (const [key, items] of exactGroups) {
    if (items.length < MIN_SAMPLES_EXACT) continue;
    const stats = buildBucket(key, items, items[0].log.patternLabel || "—");
    if (stats) exactOut.set(key, stats);
  }

  const fbOut = new Map<string, BucketStats>();
  for (const [key, items] of fbGroups) {
    if (items.length < MIN_SAMPLES_FALLBACK) continue;
    const stats = buildBucket(key, items, "*");
    if (stats) fbOut.set(key, stats);
  }

  _exactCache = exactOut;
  _fallbackCache = fbOut;
  _lastBuildTs = Date.now();
}

function ensureFresh() {
  const now = Date.now();
  if (now - _lastBuildTs > 30_000) rebuild();
}

export function getLearningAdjustment(
  pattern: string,
  regimeLabel: string,
  direction: SniperDirection,
  timeframe: SniperTimeframe,
  regimeConfidence: number = 70, // V26 — disable learning when regime is too uncertain
): {
  factor: number;
  adjustment: number;
  samples: number;
  winRate: number | null;
  lossStreak: number;
  source: LearningSource;
} {
  ensureFresh();

  // V26 — when the regime detector is very unsure (<40), training data is noisy.
  // Skip learning to avoid amplifying mislabeled buckets.
  if (regimeConfidence < 40) {
    return { factor: 1, adjustment: 0, samples: 0, winRate: null, lossStreak: 0, source: "none" };
  }

  // Tier 1: exact match
  const ek = exactKey(pattern || "—", regimeLabel || "—", direction, timeframe);
  const exact = _exactCache.get(ek);
  if (exact) {
    return {
      factor: exact.factor,
      adjustment: exact.adjustment,
      samples: exact.total,
      winRate: exact.winRate,
      lossStreak: exact.lossStreak,
      source: "exact",
    };
  }

  // Tier 2: regime-only fallback
  const fk = fallbackKey(regimeLabel || "—", direction, timeframe);
  const fb = _fallbackCache.get(fk);
  if (fb) {
    return {
      factor: fb.factor,
      adjustment: fb.adjustment,
      samples: fb.total,
      winRate: fb.winRate,
      lossStreak: fb.lossStreak,
      source: "regime-fallback",
    };
  }

  // Tier 3 (V30): persistent cloud memory — survives localStorage clears.
  // Built from aggregated outcomes across all sessions/users.
  const cloud = getCloudBucket(pattern || "—", regimeLabel || "—", direction, timeframe);
  if (cloud && cloud.total >= 5) {
    const decisive = cloud.wins + cloud.losses;
    const winRate = decisive > 0 ? cloud.wins / decisive : 0;
    let adjustment = (winRate - 0.65) * 40;
    if (adjustment > MAX_BOOST_PCT) adjustment = MAX_BOOST_PCT;
    if (adjustment < -MAX_PENALTY_PCT) adjustment = -MAX_PENALTY_PCT;
    return {
      factor: 1 + adjustment / 100,
      adjustment,
      samples: cloud.total,
      winRate,
      lossStreak: 0,
      source: "cloud",
    };
  }

  return { factor: 1, adjustment: 0, samples: 0, winRate: null, lossStreak: 0, source: "none" };
}

/** Public read of all exact buckets (e.g. for an analytics panel). */
export function getAllLearningBuckets(): BucketStats[] {
  ensureFresh();
  return [..._exactCache.values()].sort((a, b) => b.total - a.total);
}

/** Public read of regime-fallback buckets. */
export function getAllFallbackBuckets(): BucketStats[] {
  ensureFresh();
  return [..._fallbackCache.values()].sort((a, b) => b.total - a.total);
}

/** Force refresh — useful right after a trade resolves. */
export function refreshLearningCache() {
  rebuild();
}

// Silence unused-import warning; MarketRegime is exported indirectly via callers.
export type _MarketRegime = MarketRegime;
