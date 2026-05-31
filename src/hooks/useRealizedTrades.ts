import { useCallback, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export interface RealizedTrade {
  id: string;
  symbol: string;
  name_ar: string;
  asset_type: "stock" | "crypto";
  currency: "EGP" | "USD";
  buy_price: number;
  sell_price: number;
  quantity: number;
  realized_pl: number;
  realized_pl_pct: number;
  sold_at: string;
}

const keyFor = (uid: string) => `realized_trades_${uid}`;

export function useRealizedTrades(user: User | null) {
  const [trades, setTrades] = useState<RealizedTrade[]>([]);

  // Hydrate: cache first (instant), then cloud (authoritative)
  useEffect(() => {
    if (!user) { setTrades([]); return; }
    try {
      const raw = localStorage.getItem(keyFor(user.id));
      if (raw) setTrades(JSON.parse(raw));
    } catch { /* ignore */ }

    (async () => {
      const { data, error } = await supabase
        .from("realized_trades")
        .select("*")
        .order("sold_at", { ascending: false });
      if (!error && data) {
        const mapped: RealizedTrade[] = data.map((r) => ({
          id: r.id,
          symbol: r.symbol,
          name_ar: r.name_ar,
          asset_type: r.asset_type as "stock" | "crypto",
          currency: r.currency as "EGP" | "USD",
          buy_price: Number(r.buy_price),
          sell_price: Number(r.sell_price),
          quantity: Number(r.quantity),
          realized_pl: Number(r.realized_pl),
          realized_pl_pct: Number(r.realized_pl_pct),
          sold_at: r.sold_at,
        }));
        setTrades(mapped);
        try { localStorage.setItem(keyFor(user.id), JSON.stringify(mapped)); } catch { /* ignore */ }
      }
    })();
  }, [user]);

  const addTrade = useCallback((t: Omit<RealizedTrade, "id" | "sold_at">) => {
    if (!user) return;
    const trade: RealizedTrade = {
      ...t,
      id: crypto.randomUUID(),
      sold_at: new Date().toISOString(),
    };
    setTrades(prev => {
      const next = [trade, ...prev];
      try { localStorage.setItem(keyFor(user.id), JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
    // Cloud sync (graceful)
    supabase.from("realized_trades").insert({
      id: trade.id,
      user_id: user.id,
      symbol: trade.symbol,
      name_ar: trade.name_ar,
      asset_type: trade.asset_type,
      currency: trade.currency,
      buy_price: trade.buy_price,
      sell_price: trade.sell_price,
      quantity: trade.quantity,
      realized_pl: trade.realized_pl,
      realized_pl_pct: trade.realized_pl_pct,
      sold_at: trade.sold_at,
    }).then(({ error }) => { if (error) console.warn("realized_trades insert:", error.message); });
  }, [user]);

  const removeTrade = useCallback((id: string) => {
    if (!user) return;
    setTrades(prev => {
      const next = prev.filter(t => t.id !== id);
      try { localStorage.setItem(keyFor(user.id), JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
    supabase.from("realized_trades").delete().eq("id", id).then(({ error }) => {
      if (error) console.warn("realized_trades delete:", error.message);
    });
  }, [user]);

  const totalRealized = trades.reduce(
    (acc, t) => {
      if (t.currency === "USD") acc.usd += t.realized_pl;
      else acc.egp += t.realized_pl;
      return acc;
    },
    { egp: 0, usd: 0 }
  );

  return { trades, addTrade, removeTrade, totalRealized };
}
