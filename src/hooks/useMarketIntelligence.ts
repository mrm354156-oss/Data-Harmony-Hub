// V36 — Market Intelligence Hook (Local / WebSocket-based)
// لم نعد نقرأ من جدول `تدفق_بيانات_السوق` (تم إيقاف الـ feeder لتوفير Egress).
// بدلاً من ذلك نحسب aiScore و whaleFlow من بيانات Binance ticker24h المُتاحة محلياً
// عبر binanceDataLayer. الترجيح يبقى مطابقاً لـ V33 لضمان توافق المنطق.

import { useEffect, useState } from "react";
import { fetchTopLiquiditySymbols, fetchTicker24h } from "@/lib/binanceDataLayer";

export interface MarketIntelEntry {
  aiScore: number;       // 0..100
  whaleFlow: number;     // 0..1
  price: number;
  change24h: number;
  volume: number;
  takenAt: string;
}

export type MarketIntelMap = Map<string, MarketIntelEntry>;

function computeScore(change24h: number, quoteVolume: number): { aiScore: number; whaleFlow: number } {
  // نطاق المؤشر الذكي: تجمع زخم 24س + سيولة لوغاريتمية.
  const trend = Math.max(0, Math.min(40, 20 + change24h * 2)); // ±10% → 0..40
  const liq = Math.max(0, Math.min(30, Math.log10(Math.max(1, quoteVolume)) * 4)); // 1M→24, 100M→32
  const base = 30 + trend + liq * 0.5;
  const aiScore = Math.max(0, Math.min(100, base));
  // تدفق الحيتان: تقدير تقريبي من الحجم (0..1)
  const whaleFlow = Math.max(0, Math.min(1, Math.log10(Math.max(1, quoteVolume)) / 9));
  return { aiScore, whaleFlow };
}

let cache: { map: MarketIntelMap; ts: number } | null = null;
const TTL_MS = 60_000;

async function buildIntel(): Promise<MarketIntelMap> {
  if (cache && Date.now() - cache.ts < TTL_MS) return cache.map;
  const map: MarketIntelMap = new Map();
  try {
    const symbols = await fetchTopLiquiditySymbols(50);
    // ticker24h مُخزّن مؤقتاً 60s — استدعاءات متوازية رخيصة
    await Promise.all(
      symbols.map(async (sym) => {
        const t = await fetchTicker24h(sym);
        if (!t) return;
        const { aiScore, whaleFlow } = computeScore(t.priceChangePercent, t.quoteVolume);
        map.set(sym, {
          aiScore,
          whaleFlow,
          price: t.lastPrice,
          change24h: t.priceChangePercent,
          volume: t.quoteVolume,
          takenAt: new Date().toISOString(),
        });
      }),
    );
    cache = { map, ts: Date.now() };
  } catch { /* offline → empty map; القناص يعمل بدون intel */ }
  return map;
}

export function useMarketIntelligence(enabled: boolean = true) {
  const [data, setData] = useState<MarketIntelMap | undefined>(cache?.map);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const tick = async () => {
      const m = await buildIntel();
      if (alive) setData(m);
    };
    tick();
    const id = setInterval(tick, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, [enabled]);

  return { data };
}

// ── دمج هجين: تطبيق aiScore على إشارة القناص (نفس منطق V33) ──
export interface IntelEnrichResult<T> {
  signal: T & {
    aiScore: number | null;
    whaleFlow: number | null;
    intelGate: "pass" | "block" | "unknown";
    intelBoost: number;
  };
}

export function enrichSignalWithIntel<
  T extends { symbol: string; passed: boolean; confidence: number },
>(signal: T, intel: MarketIntelMap | undefined): IntelEnrichResult<T>["signal"] {
  const entry = intel?.get(signal.symbol);
  if (!entry) {
    return { ...signal, aiScore: null, whaleFlow: null, intelGate: "unknown", intelBoost: 0 };
  }
  const minGate = 50;
  const block = entry.aiScore < minGate;
  const rawBoost = (entry.aiScore - 65) / 2;
  const boost = Math.max(-15, Math.min(15, rawBoost));
  const adjustedConfidence = Math.max(0, Math.min(100, signal.confidence + boost));
  return {
    ...signal,
    confidence: adjustedConfidence,
    passed: signal.passed && !block,
    aiScore: entry.aiScore,
    whaleFlow: entry.whaleFlow,
    intelGate: block ? "block" : "pass",
    intelBoost: boost,
  };
}
