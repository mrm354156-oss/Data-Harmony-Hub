// V33 Phase 3 — Centralized Binance data layer
// - Top-50 liquidity scan (configurable, default 50; was 180)
// - Historical pagination up to 10,000 candles (max 1000/req → 10 round-trips)
// - 24h ticker quote (used for the auto-jump summary toast)
// - In-memory TTL caches (klines + ticker24h + symbol list) to cut API pressure
// - Concurrency-limited batched fetcher
//
// IMPORTANT: This module is *additive*. The existing useSniperScan keeps its
// 50-candle live scan path working — we just route it through cachedKlines so
// repeated scans within the TTL window become free.

import { binanceProxy } from "./binanceProxy";
// All raw Binance HTTP goes through our edge proxy — direct browser calls to
// api.binance.com are blocked in many regions / sandboxes (CORS / geo).

// ─────────────────────────────────────────────────────────────────────────────
// Cache primitives — LRU-eviction capped at maxEntries to prevent memory leaks
// ─────────────────────────────────────────────────────────────────────────────
interface Entry<T> { value: T; ts: number; }
function makeCache<T>(ttlMs: number, maxEntries = 500) {
  const store = new Map<string, Entry<T>>();
  return {
    get(key: string): T | null {
      const e = store.get(key);
      if (!e) return null;
      if (Date.now() - e.ts > ttlMs) { store.delete(key); return null; }
      // LRU refresh: re-insert to maintain recency order
      store.delete(key);
      store.set(key, e);
      return e.value;
    },
    set(key: string, value: T) {
      // Evict oldest entry if at capacity
      if (store.size >= maxEntries) {
        const oldestKey = store.keys().next().value;
        if (oldestKey) store.delete(oldestKey);
      }
      store.set(key, { value, ts: Date.now() });
    },
    clear() { store.clear(); },
    size() { return store.size; },
  };
}

// TTLs tuned per-resource. Lower frames refresh more often.
const KLINE_TTL: Record<string, number> = {
  "1m": 25_000, "3m": 60_000, "5m": 90_000, "15m": 4 * 60_000, "30m": 8 * 60_000,
  "1h": 12 * 60_000, "2h": 20 * 60_000, "4h": 40 * 60_000, "6h": 60 * 60_000,
  "8h": 80 * 60_000, "12h": 2 * 60 * 60_000, "1d": 4 * 60 * 60_000,
  "3d": 8 * 60 * 60_000, "1w": 12 * 60 * 60_000,
};

const klineCache = makeCache<unknown[]>(60_000);            // generic short-lived
const histCache = makeCache<unknown[]>(10 * 60_000);        // historical (heavier, 10 min)
const ticker24hCache = makeCache<Ticker24h>(60_000);    // 24h price stats per symbol

// ─────────────────────────────────────────────────────────────────────────────
// Symbol list — top liquidity (default 50)
// ─────────────────────────────────────────────────────────────────────────────
const EXCLUDE = /^(USDC|FDUSD|TUSD|BUSD|DAI|USDP|PYUSD|RLUSD|USD1|XUSD|EURUSDT|GBPUSDT|AEUR|WBTC|WBETH|STETH)/i;
const STANDARD_USDT_SYMBOL = /^[A-Z0-9]+USDT$/;

let cachedSymbols: { list: string[]; ts: number; limit: number } | null = null;
const SYMBOLS_TTL = 30 * 60_000;

export interface Ticker24h {
  symbol: string;
  lastPrice: number;
  priceChangePercent: number;
  highPrice: number;
  lowPrice: number;
  quoteVolume: number;
}

let allTickersCache: { list: Record<string, unknown>[]; ts: number } | null = null;
async function fetchAllTickers24h(): Promise<Record<string, unknown>[]> {
  const now = Date.now();
  if (allTickersCache && now - allTickersCache.ts < 60_000) return allTickersCache.list;
  const raw = await binanceProxy.ticker24hAll();
  const list = Array.isArray(raw) ? raw as Record<string, unknown>[] : [];
  allTickersCache = { list, ts: now };
  return list;
}

/**
 * Top-N USDT symbols by 24h quoteVolume. Default 50 (V33 Phase 3 requirement).
 * Cached for 30 min.
 */
export async function fetchTopLiquiditySymbols(limit = 50): Promise<string[]> {
  const now = Date.now();
  if (cachedSymbols && cachedSymbols.limit >= limit && now - cachedSymbols.ts < SYMBOLS_TTL) {
    return cachedSymbols.list.slice(0, limit);
  }
  try {
    const all = await fetchAllTickers24h();
    const list = all
      .filter((t): t is { symbol: string; quoteVolume: string | number } => {
        if (typeof t !== "object" || t === null) return false;
        const symbol = (t as Record<string, unknown>).symbol;
        const quoteVolume = (t as Record<string, unknown>).quoteVolume;
        return typeof symbol === "string"
          && STANDARD_USDT_SYMBOL.test(symbol)
          && !EXCLUDE.test(symbol)
          && (typeof quoteVolume === "string" || typeof quoteVolume === "number");
      })
      .sort((a, b) => +a.quoteVolume - +b.quoteVolume)
      .slice(0, limit)
      .map((t) => t.symbol);
    cachedSymbols = { list, ts: now, limit };
    return list;
  } catch {
    // Sane fallback (top liquidity majors)
    return [
      "BTCUSDT", "ETHUSDT", "BNBUSDT", "XRPUSDT", "SOLUSDT", "ADAUSDT", "DOGEUSDT", "TRXUSDT",
      "AVAXUSDT", "LINKUSDT", "DOTUSDT", "UNIUSDT", "LTCUSDT", "PEPEUSDT", "SHIBUSDT", "NEARUSDT",
      "APTUSDT", "SUIUSDT", "ARBUSDT", "OPUSDT", "ATOMUSDT", "ICPUSDT", "FILUSDT", "HBARUSDT",
      "AAVEUSDT", "INJUSDT", "GRTUSDT", "ALGOUSDT",
    ].slice(0, limit);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Klines — short (cached) + Historical (paginated, up to 10,000)
// ─────────────────────────────────────────────────────────────────────────────
export async function fetchKlinesCached(symbol: string, tf: string, limit = 50): Promise<unknown[] | null> {
  const key = `${symbol}|${tf}|${limit}`;
  const cached = klineCache.get(key);
  if (cached) return cached;
  try {
    const res = await binanceProxy.klinesSafe(symbol, tf, limit);
    if (!res.ok || !Array.isArray(res.data)) return null;
    klineCache.set(key, res.data);
    return res.data;
  } catch { return null; }
}

/**
 * Fetch up to 10,000 historical klines via paginated calls (Binance max=1000/req).
 * Cached 10 min. Used by Judge / Backtest for higher-confidence verdicts.
 * Optimized: push + reverse O(n) instead of unshift O(n²).
 */
export async function fetchHistoricalKlines(
  symbol: string,
  tf: string,
  totalLimit = 10_000,
): Promise<unknown[] | null> {
  const cap = Math.min(totalLimit, 10_000);
  const key = `${symbol}|${tf}|hist|${cap}`;
  const cached = histCache.get(key);
  if (cached) return cached;

  try {
    const batches: unknown[][] = [];
    let endTime: number | undefined = undefined;
    const PER = 1000;
    const rounds = Math.ceil(cap / PER);
    for (let i = 0; i < rounds; i++) {
      const remaining = cap - batches.reduce((a, b) => a + b.length, 0);
      const lim = Math.min(PER, remaining);
      const res = await binanceProxy.klinesSafe(symbol, tf, lim, endTime);
      if (!res.ok || !Array.isArray(res.data) || !res.data.length) break;
      batches.push(res.data);
      endTime = res.data[0][0] - 1;
      if (res.data.length < lim) break;
    }
    if (!batches.length) return null;
    // Reverse batches then concat for chronological order — O(n) instead of O(n²)
    batches.reverse();
    const out = batches.flatMap(b => b);
    // Dedup by openTime just in case
    const seen = new Set<number>();
    const unique = out.filter(k => { if (seen.has(k[0])) return false; seen.add(k[0]); return true; });
    histCache.set(key, unique);
    return unique;
  } catch { return null; }
}

// ─────────────────────────────────────────────────────────────────────────────
// 24h ticker per symbol — used for Auto-Jump summary toast
// ─────────────────────────────────────────────────────────────────────────────
export async function fetchTicker24h(symbol: string): Promise<Ticker24h | null> {
  const cached = ticker24hCache.get(symbol);
  if (cached) return cached;
  try {
    const j = await binanceProxy.ticker24h(symbol);
    const obj = j as Record<string, unknown> | null;
    if (!obj || !obj.symbol) return null;
    const tk: Ticker24h = {
      symbol: obj.symbol as string,
      lastPrice: +(obj.lastPrice ?? 0),
      priceChangePercent: +(obj.priceChangePercent ?? 0),
      highPrice: +(obj.highPrice ?? 0),
      lowPrice: +(obj.lowPrice ?? 0),
      quoteVolume: +(obj.quoteVolume ?? 0),
    };
    ticker24hCache.set(symbol, tk);
    return tk;
  } catch { return null; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Concurrency-limited batched runner (re-exported convenience)
// ─────────────────────────────────────────────────────────────────────────────
export async function runInBatches<T, R>(
  items: T[],
  batchSize: number,
  worker: (item: T) => Promise<R>,
  onProgress?: (done: number, total: number) => void,
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const chunk = items.slice(i, i + batchSize);
    const res = await Promise.all(chunk.map(worker));
    out.push(...res);
    onProgress?.(Math.min(i + batchSize, items.length), items.length);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cache controls (debug / kill-switch hooks)
// ─────────────────────────────────────────────────────────────────────────────
export function clearDataCaches() {
  klineCache.clear();
  histCache.clear();
  ticker24hCache.clear();
  cachedSymbols = null;
  allTickersCache = null;
}

export function dataCacheStats() {
  return {
    klines: klineCache.size(),
    historical: histCache.size(),
    ticker24h: ticker24hCache.size(),
    symbolListAgeMs: cachedSymbols ? Date.now() - cachedSymbols.ts : null,
  };
}
