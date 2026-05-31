import { useEffect, useState, useCallback } from "react";
import type { CryptoWithSignal } from "@/hooks/useCryptoSignals";

export type SignalOutcome = "pending" | "target1" | "target2" | "target3" | "stopLoss";

export interface TrackedSignal {
  id: string;            // unique: cryptoId-timestamp
  cryptoId: string;
  symbol: string;
  name: string;
  image: string;
  signal: "buy" | "sell" | "hold";
  entry: number;
  target1: number;
  target2: number;
  target3: number;
  stopLoss: number;
  timeframeLabel: string;
  createdAt: number;     // ms
  outcome: SignalOutcome;
  resolvedAt?: number;
  resolvedPrice?: number;
}

const STORAGE_KEY = "crypto_signal_history_v1";
const MAX_HISTORY = 40;

function load(): TrackedSignal[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as TrackedSignal[];
  } catch {
    return [];
  }
}

function save(list: TrackedSignal[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_HISTORY)));
  } catch { /* ignore */ }
}

export function useSignalHistory(currentCryptos: CryptoWithSignal[]) {
  const [history, setHistory] = useState<TrackedSignal[]>(() => load());

  // Auto-track perfect entry signals (one per crypto per session window)
  useEffect(() => {
    if (currentCryptos.length === 0) return;
    setHistory(prev => {
      const next = [...prev];
      let changed = false;
      const sixHours = 6 * 60 * 60 * 1000;
      const now = Date.now();

      for (const c of currentCryptos) {
        if (!c.isPerfectEntry && c.signal !== "buy") continue;
        if (c.signal === "hold") continue;

        // Skip if we already have a recent pending signal for this crypto
        const recent = next.find(s =>
          s.cryptoId === c.id && s.outcome === "pending" && (now - s.createdAt) < sixHours
        );
        if (recent) continue;

        // Only auto-add high-confidence signals
        if (!c.isPerfectEntry && c.confidence < 70) continue;

        next.unshift({
          id: `${c.id}-${now}`,
          cryptoId: c.id,
          symbol: c.symbol,
          name: c.name,
          image: c.image,
          signal: c.signal,
          entry: c.plan.entry,
          target1: c.plan.target1,
          target2: c.plan.target2,
          target3: c.plan.target3,
          stopLoss: c.plan.stopLoss,
          timeframeLabel: c.plan.timeframeLabel,
          createdAt: now,
          outcome: "pending",
        });
        changed = true;
      }

      // Resolve pending signals against live price
      const priceMap = new Map(currentCryptos.map(c => [c.id, c.currentPrice]));
      for (const s of next) {
        if (s.outcome !== "pending") continue;
        const price = priceMap.get(s.cryptoId);
        if (price === undefined) continue;

        const isLong = s.signal === "buy";
        const hitT3 = isLong ? price >= s.target3 : price <= s.target3;
        const hitT2 = isLong ? price >= s.target2 : price <= s.target2;
        const hitT1 = isLong ? price >= s.target1 : price <= s.target1;
        const hitSL = isLong ? price <= s.stopLoss : price >= s.stopLoss;

        let outcome: SignalOutcome | null = null;
        if (hitT3) outcome = "target3";
        else if (hitT2) outcome = "target2";
        else if (hitT1) outcome = "target1";
        else if (hitSL) outcome = "stopLoss";

        if (outcome) {
          s.outcome = outcome;
          s.resolvedAt = now;
          s.resolvedPrice = price;
          changed = true;
        }
      }

      if (!changed) return prev;
      const trimmed = next.slice(0, MAX_HISTORY);
      save(trimmed);
      return trimmed;
    });
  }, [currentCryptos]);

  const clear = useCallback(() => {
    setHistory([]);
    save([]);
  }, []);

  return { history, clear };
}
