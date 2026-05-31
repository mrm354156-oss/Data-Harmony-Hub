// V34 — Shadow Learning Tracker
// Goal: accelerate learning_memory accumulation during the bootstrap phase by
// silently tracking signals the Judge REJECTED (insufficient data / weak / low WR).
// These shadow trades NEVER touch capital — they only resolve in-memory and push
// their outcome to the persistent cloud bucket so the bot learns faster.
//
// Lifecycle:
//   trackShadowSignal()  →  registers a hypothetical trade
//   tickShadowResolver() →  called by SniperTab tick; resolves T1/T2/SL/expiry
//   on resolve           →  recordPersistentOutcome() writes to learning_memory

import type { SniperDirection, SniperTimeframe } from "./sniperEngine";
import { getLivePriceSnapshot } from "@/hooks/useBinanceLivePrices";
import { recordPersistentOutcome } from "./persistentLearning";
import { logDebug } from "./debugBus";

interface ShadowTrade {
  id: string;
  symbol: string;
  baseAsset: string;
  timeframe: SniperTimeframe;
  direction: SniperDirection;
  entry: number;
  target1: number;
  target2: number;
  stopLoss: number;
  patternLabel: string;
  regimeLabel: string;
  createdAt: number;
  ttlMs: number;
  rejectionReason: string;
  confidence?: number;
  riskReward?: number;
  outcome?: "pending" | "target1" | "target2" | "stopLoss" | "expired";
  resolvedAt?: number;
  resolvedPrice?: number;
}

interface ShadowInput {
  symbol: string;
  baseAsset: string;
  timeframe: SniperTimeframe;
  direction: SniperDirection;
  entry: number;
  target1: number;
  target2: number;
  stopLoss: number;
  patternLabel: string;
  regimeLabel: string;
  rejectionReason: string;
  confidence?: number;
  riskReward?: number;
}

const SHADOW_KEY = "sniper_shadow_trades_v1";
const MAX_SHADOWS = 200;
const SHADOW_HISTORY_KEY = "sniper_shadow_history_v1";
const MAX_HISTORY = 30;

const TF_TTL_MS: Record<SniperTimeframe, number> = {
  "1m":  25 * 60 * 1000,
  "3m":  75 * 60 * 1000,
  "5m":  135 * 60 * 1000,
  "15m": 6  * 60 * 60 * 1000,
  "30m": 10 * 60 * 60 * 1000,
  "1h":  18 * 60 * 60 * 1000,
  "2h":  30 * 60 * 60 * 1000,
  "4h":  3  * 24 * 60 * 60 * 1000,
  "6h":  4  * 24 * 60 * 60 * 1000,
  "8h":  5  * 24 * 60 * 60 * 1000,
  "12h": 6  * 24 * 60 * 60 * 1000,
  "1d":  10 * 24 * 60 * 60 * 1000,
  "3d":  21 * 24 * 60 * 60 * 1000,
  "1w":  45 * 24 * 60 * 60 * 1000,
};

function load(): ShadowTrade[] {
  try {
    const raw = localStorage.getItem(SHADOW_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as ShadowTrade[];
  } catch { return []; }
}

function save(list: ShadowTrade[]): void {
  try { localStorage.setItem(SHADOW_KEY, JSON.stringify(list.slice(0, MAX_SHADOWS))); }
  catch { /* ignore */ }
}

function loadHistory(): ShadowTrade[] {
  try {
    const raw = localStorage.getItem(SHADOW_HISTORY_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as ShadowTrade[];
  } catch { return []; }
}

function saveHistory(list: ShadowTrade[]): void {
  try { localStorage.setItem(SHADOW_HISTORY_KEY, JSON.stringify(list.slice(0, MAX_HISTORY))); }
  catch { /* ignore */ }
}

let shadows: ShadowTrade[] = load();
let history: ShadowTrade[] = loadHistory();
let resolvedCount = 0;
const listeners = new Set<() => void>();

export function subscribeShadowChanges(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit() { listeners.forEach(fn => fn()); }

/** Register a hypothetical (judge-rejected) trade for outcome tracking. */
export function trackShadowSignal(input: ShadowInput): void {
  const now = Date.now();
  // Dedupe: skip if we already have a pending shadow for the same symbol+tf+dir
  const dup = shadows.find(s =>
    s.symbol === input.symbol &&
    s.timeframe === input.timeframe &&
    s.direction === input.direction &&
    (now - s.createdAt) < TF_TTL_MS[input.timeframe],
  );
  if (dup) return;

  shadows.unshift({
    id: `shadow|${input.symbol}|${input.timeframe}|${now}`,
    ...input,
    createdAt: now,
    ttlMs: TF_TTL_MS[input.timeframe],
    outcome: "pending",
  });
  shadows = shadows.slice(0, MAX_SHADOWS);
  save(shadows);
  emit();
}

/** Resolve all pending shadow trades against live prices. Called on SniperTab tick. */
export function tickShadowResolver(): void {
  const now = Date.now();
  const remaining: ShadowTrade[] = [];
  let resolvedThisTick = 0;

  for (const t of shadows) {
    const price = getLivePriceSnapshot(t.symbol);
    if (price === undefined || price === null) {
      // No live price yet — keep until TTL
      if (now - t.createdAt > t.ttlMs) {
        // expired — push to history with expired outcome
        history.unshift({ ...t, outcome: "expired", resolvedAt: now });
        continue;
      }
      remaining.push(t);
      continue;
    }

    let outcome: string | null = null;
    if (t.direction === "long") {
      if (price >= t.target2) outcome = "target2";
      else if (price >= t.target1) outcome = "target1";
      else if (price <= t.stopLoss) outcome = "stopLoss";
    } else {
      if (price <= t.target2) outcome = "target2";
      else if (price <= t.target1) outcome = "target1";
      else if (price >= t.stopLoss) outcome = "stopLoss";
    }

    if (outcome) {
      void recordPersistentOutcome(
        t.id,
        t.patternLabel,
        t.regimeLabel,
        t.direction,
        t.timeframe,
        outcome,
      );
      resolvedCount++;
      resolvedThisTick++;
      history.unshift({
        ...t,
        outcome: outcome as ShadowTrade["outcome"],
        resolvedAt: now,
        resolvedPrice: price,
      });
      logDebug(
        "judge",
        `👻 ظل تعلّم: ${t.baseAsset} ${t.direction === "long" ? "صعود" : "هبوط"} → ${outcome}`,
        { frame: t.timeframe, symbol: t.symbol },
      );
    } else if (now - t.createdAt > t.ttlMs) {
      history.unshift({ ...t, outcome: "expired", resolvedAt: now });
    } else {
      remaining.push(t);
    }
  }

  if (resolvedThisTick > 0 || remaining.length !== shadows.length) {
    shadows = remaining;
    save(shadows);
    history = history.slice(0, MAX_HISTORY);
    saveHistory(history);
    emit();
  }
}

export function getShadowStats(): { pending: number; totalResolved: number } {
  return { pending: shadows.length, totalResolved: resolvedCount };
}

/** Returns pending + recently-resolved shadow trades, newest first. */
export function getShadowEntries(): ShadowTrade[] {
  return [...shadows, ...history].slice(0, 50);
}

export function clearShadowTrades(): void {
  shadows = [];
  history = [];
  save(shadows);
  saveHistory(history);
  emit();
}