import { useEffect, useState, useCallback } from "react";
import type { LoggedSniperSignal } from "@/hooks/useSniperLog";
import { getLivePriceSnapshot } from "@/hooks/useBinanceLivePrices";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";

const STORAGE_KEY = "sniper_virtual_portfolio_v1";
const INITIAL_BALANCE = 10_000;
const POSITION_SIZE_PCT = 10;
const FEE_PCT = 0.1;
const PARTIAL_FRACTION = 0.5;

export interface VirtualTrade {
  id: string;
  symbol: string;
  baseAsset: string;
  direction: "long" | "short";
  entry: number;
  exit: number;
  size: number;
  pnl: number;
  pnlPct: number;
  outcome: "target1" | "target2" | "stopLoss" | "emergencyExit" | "expired";
  openedAt: number;
  closedAt: number;
  partialBooked?: boolean;
  partialPnl?: number;
}

interface State {
  balance: number;
  trades: VirtualTrade[];
  processedIds: string[];
  partialIds: string[];
  updatedAt: number; // V44 — طابع زمني موحد لحل تعارض Local/Cloud
}

function load(): State {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { balance: INITIAL_BALANCE, trades: [], processedIds: [], partialIds: [], updatedAt: Date.now() };
    const parsed = JSON.parse(raw) as State;
    return {
      balance: typeof parsed.balance === "number" ? parsed.balance : INITIAL_BALANCE,
      trades: Array.isArray(parsed.trades) ? parsed.trades : [],
      processedIds: Array.isArray(parsed.processedIds) ? parsed.processedIds : [],
      partialIds: Array.isArray((parsed as State).partialIds) ? (parsed as State).partialIds : [],
      updatedAt: typeof (parsed as State).updatedAt === "number" ? (parsed as State).updatedAt : parsed.trades.length > 0 ? Date.now() : 0,
    };
  } catch {
    return { balance: INITIAL_BALANCE, trades: [], processedIds: [], partialIds: [], updatedAt: Date.now() };
  }
}

function save(state: State) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

async function pushStateToCloud(uid: string, state: State) {
  try {
    await supabase.from("virtual_portfolio_state").upsert([{
      user_id: uid,
      balance: state.balance,
      processed_ids: state.processedIds,
      partial_ids: state.partialIds,
    }], { onConflict: "user_id" });
  } catch { /* graceful */ }
}

async function pushTradeToCloud(uid: string, t: VirtualTrade) {
  try {
    await supabase.from("virtual_portfolio_trades").upsert([{
      id: t.id,
      user_id: uid,
      symbol: t.symbol,
      base_asset: t.baseAsset,
      direction: t.direction,
      entry: t.entry,
      exit_price: t.exit,
      size: t.size,
      pnl: t.pnl,
      pnl_pct: t.pnlPct,
      outcome: t.outcome,
      opened_at: new Date(t.openedAt).toISOString(),
      closed_at: new Date(t.closedAt).toISOString(),
      partial_booked: !!t.partialBooked,
      partial_pnl: t.partialPnl ?? null,
    }], { onConflict: "user_id,id" });
  } catch { /* graceful */ }
}

export function useVirtualPortfolio(
  log: LoggedSniperSignal[],
  forceCloseAsLoss?: (id: string) => void,
) {
  const [state, setState] = useState<State>(() => load());
  const [tick, setTick] = useState(0);
  const [user, setUser] = useState<User | null>(null);

  // Track auth
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setUser(s?.user ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);

  // Hydrate from cloud once user is known
  useEffect(() => {
    if (!user) return;
    (async () => {
      const [{ data: st }, { data: tr }] = await Promise.all([
        supabase.from("virtual_portfolio_state").select("*").eq("user_id", user.id).maybeSingle(),
        supabase.from("virtual_portfolio_trades").select("*").order("closed_at", { ascending: false }).limit(100),
      ]);
      // V39 — Stability: keep last-known-good local balance when cloud has no row yet.
      // Prevents the "flash to $10,000" on app open / re-sync.
      setState(prev => {
        const cloudHasState = !!st;
        const cloudTrades = (tr ?? []).map((r) => ({
          id: r.id,
          symbol: r.symbol,
          baseAsset: r.base_asset,
          direction: r.direction as "long" | "short",
          entry: Number(r.entry),
          exit: Number(r.exit_price),
          size: Number(r.size),
          pnl: Number(r.pnl),
          pnlPct: Number(r.pnl_pct),
          outcome: r.outcome as VirtualTrade["outcome"],
          openedAt: new Date(r.opened_at).getTime(),
          closedAt: new Date(r.closed_at).getTime(),
          partialBooked: r.partial_booked,
          partialPnl: r.partial_pnl != null ? Number(r.partial_pnl) : undefined,
        }));
        // V44 — مقارنة التواريخ: نختار الأحدث فقط
        const cloudUpdatedAt = st?.updated_at ? new Date(st.updated_at as string).getTime() : 0;
        const localUpdatedAt = prev.updatedAt || 0;
        const cloudNewer = cloudHasState && cloudUpdatedAt > localUpdatedAt;
        const next: State = {
          balance: cloudNewer ? Number(st.balance) : prev.balance,
          processedIds: cloudNewer ? ((st?.processed_ids as unknown as string[]) ?? prev.processedIds) : prev.processedIds,
          partialIds: cloudNewer ? ((st?.partial_ids as unknown as string[]) ?? prev.partialIds) : prev.partialIds,
          trades: cloudNewer && cloudTrades.length > 0 ? cloudTrades : prev.trades,
          updatedAt: Math.max(cloudUpdatedAt, localUpdatedAt),
        };
        save(next);
        return next;
      });
    })();
  }, [user]);

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    setState(prev => {
      const processed = new Set(prev.processedIds);
      const partials = new Set(prev.partialIds);
      const newTrades: VirtualTrade[] = [];
      let balance = prev.balance;
      let changed = false;

      for (const l of log) {
        // V2 — Fix: Record partial close for tracking but do NOT add to balance yet
        // The partial PnL will be added when the trade fully resolves
        if (l.partialClosedAt && l.partialClosePrice && !partials.has(l.id) && !processed.has(l.id)) {
          partials.add(l.id);
          changed = true;
        }

        if (l.outcome === "pending") continue;
        if (processed.has(l.id)) continue;
        if (l.resolvedPrice == null) continue;

        const size = Math.max(10, (balance * POSITION_SIZE_PCT) / 100);
        const finalPx = l.resolvedPrice;
        const t1Px = l.partialClosePrice;
        const pctAt = (px: number) => l.direction === "short"
          ? ((l.entry - px) / l.entry) * 100
          : ((px - l.entry) / l.entry) * 100;

        let grossPct: number;
        let pnl: number;
        let partialPnlRecorded = 0;
        if (t1Px != null) {
          // V2 — Fix: Include partial PnL in the final balance calculation
          const partialPct = pctAt(t1Px) - FEE_PCT;
          const remainPct = pctAt(finalPx) - FEE_PCT;
          partialPnlRecorded = (size * PARTIAL_FRACTION * partialPct) / 100;
          const remainPnl = (size * (1 - PARTIAL_FRACTION) * remainPct) / 100;
          pnl = partialPnlRecorded + remainPnl;
          grossPct = pctAt(t1Px) * 0.5 + pctAt(finalPx) * 0.5;
        } else {
          grossPct = pctAt(finalPx);
          pnl = (size * (grossPct - FEE_PCT)) / 100;
        }
        const netPct = grossPct - FEE_PCT;

        // V2 — Fix: Add full PnL (including partial) to balance
        balance += pnl;
        processed.add(l.id);
        const newTrade: VirtualTrade = {
          id: l.id,
          symbol: l.symbol,
          baseAsset: l.baseAsset,
          direction: l.direction,
          entry: l.entry,
          exit: finalPx,
          size,
          // V2 — Fix: pnl already includes partialPnlRecorded, don't double-count
          pnl,
          pnlPct: netPct,
          outcome: l.outcome as VirtualTrade["outcome"],
          openedAt: l.createdAt,
          closedAt: l.resolvedAt ?? Date.now(),
          partialBooked: t1Px != null,
          partialPnl: partialPnlRecorded || undefined,
        };
        newTrades.unshift(newTrade);
        if (user) pushTradeToCloud(user.id, newTrade);
        changed = true;
      }

      if (!changed && newTrades.length === 0) return prev;
      const next: State = {
        balance,
        trades: newTrades.length > 0 ? [...newTrades, ...prev.trades].slice(0, 100) : prev.trades,
        processedIds: Array.from(processed).slice(-500),
        partialIds: Array.from(partials).slice(-500),
        updatedAt: Date.now(),
      };
      save(next);
      if (user) pushStateToCloud(user.id, next);
      return next;
    });
  }, [log, user]);

  const reset = useCallback(() => {
    const fresh: State = { balance: INITIAL_BALANCE, trades: [], processedIds: [], partialIds: [], updatedAt: Date.now() };
    setState(fresh);
    save(fresh);
    if (user) {
      pushStateToCloud(user.id, fresh);
      supabase.from("virtual_portfolio_trades").delete().eq("user_id", user.id).then(() => { /* ignore */ });
    }
  }, [user]);

  const removeTrade = useCallback((id: string) => {
    forceCloseAsLoss?.(id);
    setState(prev => {
      const next = { ...prev, trades: prev.trades.filter(t => t.id !== id) };
      save(next);
      return next;
    });
    if (user) {
      supabase.from("virtual_portfolio_trades").delete().eq("user_id", user.id).eq("id", id).then(() => { /* ignore */ });
    }
  }, [forceCloseAsLoss, user]);

  let floatingPnl = 0;
  for (const l of log) {
    if (l.outcome !== "pending") continue;
    const live = getLivePriceSnapshot(l.symbol);
    if (live == null) continue;
    const size = Math.max(10, (state.balance * POSITION_SIZE_PCT) / 100);
    const remainingFraction = state.partialIds.includes(l.id) ? 1 - PARTIAL_FRACTION : 1;
    const pct = l.direction === "short"
      ? ((l.entry - live) / l.entry) * 100
      : ((live - l.entry) / l.entry) * 100;
    floatingPnl += (size * remainingFraction * pct) / 100;
  }
  void tick;

  const totalPnl = state.balance - INITIAL_BALANCE;
  const totalPnlPct = (totalPnl / INITIAL_BALANCE) * 100;
  const wins = state.trades.filter(t => t.pnl > 0).length;
  const losses = state.trades.filter(t => t.pnl <= 0).length;
  const equity = state.balance + floatingPnl;

  return {
    balance: state.balance,
    equity,
    floatingPnl,
    initialBalance: INITIAL_BALANCE,
    totalPnl,
    totalPnlPct,
    trades: state.trades,
    wins,
    losses,
    reset,
    removeTrade,
  };
}
