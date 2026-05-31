// V30 — Multi-Timeframe Confluence
// Lightweight bias detector: fetch one short-list of recent closes for an
// adjacent (higher) timeframe and report whether trend agrees with the signal.
//
// Used by the engine at scan time only when a signal otherwise passed, so we
// don't burn API quota on rejected setups.

import type { SniperDirection, SniperTimeframe } from "./sniperEngine";
import { binanceProxy } from "./binanceProxy";

export type TFBias = "up" | "down" | "neutral";

const TF_PARENT: Record<SniperTimeframe, SniperTimeframe | null> = {
  "1m": "5m",
  "3m": "15m",
  "5m": "15m",
  "15m": "1h",
  "30m": "2h",
  "1h": "4h",
  "2h": "4h",
  "4h": "1d",
  "6h": "1d",
  "8h": "1d",
  "12h": "1d",
  "1d": "1w",
  "3d": "1w",
  "1w": null,
};

interface BiasCacheEntry { bias: TFBias; ema20: number; ema50: number; ts: number }
const cache = new Map<string, BiasCacheEntry>();
const CACHE_TTL_MS = 60_000;

function ema(closes: number[], period: number): number {
  if (closes.length < period) return closes[closes.length - 1] ?? 0;
  const k = 2 / (period + 1);
  let v = closes[closes.length - period];
  for (let i = closes.length - period + 1; i < closes.length; i++) {
    v = closes[i] * k + v * (1 - k);
  }
  return v;
}

async function fetchBias(symbol: string, tf: SniperTimeframe): Promise<BiasCacheEntry | null> {
  const key = `${symbol}|${tf}`;
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && now - cached.ts < CACHE_TTL_MS) return cached;
  try {
    const raw = await binanceProxy.klines(symbol, tf, 60);
    if (!Array.isArray(raw)) return null;
    const rows = raw as readonly unknown[][];
    const closes = rows.map(k => +k[4]);
    if (closes.length < 50) return null;
    const e20 = ema(closes, 20);
    const e50 = ema(closes, 50);
    const last = closes[closes.length - 1];
    const slope = (e20 - e50) / e50;
    let bias: TFBias = "neutral";
    if (last > e50 && slope > 0.001) bias = "up";
    else if (last < e50 && slope < -0.001) bias = "down";
    const entry = { bias, ema20: e20, ema50: e50, ts: now };
    cache.set(key, entry);
    return entry;
  } catch { return null; }
}

export interface MTFResult {
  parent: SniperTimeframe | null;
  parentBias: TFBias;
  agrees: boolean;            // true if parent bias supports trade direction
  reason: string;
}

export async function checkMTFConfluence(
  symbol: string,
  tf: SniperTimeframe,
  direction: SniperDirection,
): Promise<MTFResult> {
  const parent = TF_PARENT[tf];
  if (!parent) {
    return { parent: null, parentBias: "neutral", agrees: true, reason: "أعلى فريم — بدون اجتماع" };
  }
  const b = await fetchBias(symbol, parent);
  if (!b) {
    return { parent, parentBias: "neutral", agrees: true, reason: `${parent}: غير متاح — تم تجاوز الفلتر` };
  }
  const agrees =
    (direction === "long" && b.bias !== "down") ||
    (direction === "short" && b.bias !== "up");
  const arabicBias = b.bias === "up" ? "صاعد" : b.bias === "down" ? "هابط" : "محايد";
  return {
    parent,
    parentBias: b.bias,
    agrees,
    reason: agrees
      ? `✓ اجتماع فريمات: ${parent} ${arabicBias} يدعم ${direction === "long" ? "الشراء" : "البيع"}`
      : `✗ تعارض فريمات: ${parent} ${arabicBias} يعارض ${direction === "long" ? "الشراء" : "البيع"}`,
  };
}

/** Synchronous read of cached bias (after a prior async fetch). */
export function getCachedBias(symbol: string, tf: SniperTimeframe): TFBias | null {
  const e = cache.get(`${symbol}|${tf}`);
  if (!e) return null;
  if (Date.now() - e.ts > CACHE_TTL_MS * 5) return null;
  return e.bias;
}

/** Auto-Frame: pick best timeframe for a symbol based on volatility & liquidity proxy. */
export async function suggestAutoFrame(symbol: string): Promise<SniperTimeframe> {
  // Heuristic: compute ATR% on 5m, 15m, 1h. Pick the one closest to its "sweet spot".
  // 5m sweet-spot 0.5–0.9, 15m 0.7–1.3, 1h 1.0–2.0.
  const tfs: SniperTimeframe[] = ["5m", "15m", "1h"];
  const sweet = { "5m": 0.7, "15m": 1.0, "1h": 1.5 } as Record<SniperTimeframe, number>;
  const scores: { tf: SniperTimeframe; score: number }[] = [];
  for (const tf of tfs) {
    try {
      const raw = await binanceProxy.klines(symbol, tf, 20);
      if (!Array.isArray(raw)) continue;
      const rows = raw as readonly unknown[][];
      const ranges = rows.slice(-14).map(k => +k[2] - +k[3]);
      const closes = rows.map(k => +k[4]);
      const atr = ranges.reduce((a, b) => a + b, 0) / Math.max(1, ranges.length);
      const last = closes[closes.length - 1] || 1;
      const atrPct = (atr / last) * 100;
      const dist = Math.abs(atrPct - sweet[tf]);
      scores.push({ tf, score: -dist });
    } catch { /* skip */ }
  }
  if (scores.length === 0) return "15m";
  scores.sort((a, b) => b.score - a.score);
  return scores[0].tf;
}
