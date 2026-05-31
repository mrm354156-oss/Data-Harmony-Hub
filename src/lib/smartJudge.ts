// V33 Supreme — Smart Judge (Deep 10k-Candle Backtest of Live Signals)
// For each currently passing sniper signal, pull up to 10,000 historical
// candles (cached) for that symbol/timeframe, replay the engine on every
// candle, and aggregate outcomes. The Judge is the supreme gate: a trade
// is only admitted into the live log if the Judge approves.

import {
  analyzeSniperSymbol,
  type SniperKline,
  type SniperRawSymbol,
  type SniperSignal,
  type SniperTimeframe,
  type SniperFearGreed,
} from "./sniperEngine";
import { fetchHistoricalKlines } from "./binanceDataLayer";
import { logDebug } from "./debugBus";

// V35 — Two-stage analysis:
//   • FAST_LOOKBACK (2000) → emit a preliminary verdict the moment we hit it,
//     so signals appear in the list quickly during the learning phase.
//   • DEEP_LOOKBACK (10000) → continue auditing in the background; the final
//     verdict overwrites the preliminary one once it completes.
const FAST_LOOKBACK = 2_000;
const DEEP_LOOKBACK = 10_000;

// V36 — Minimum candles required to START the deep audit. Lowered from 200
// so the Judge can deliver a verdict on more symbols (esp. newer listings).
const MIN_CANDLES_FOR_AUDIT = 500;

// V36 — How far back (in hours) the Judge sweeps for similar setups.
// Was effectively ~24h via TF_24H_CANDLES; now 168h (one full week) so the
// historical Win Rate is more representative for the Kitchen Shield.
const REVIEW_WINDOW_HOURS = 168;

export interface JudgeMatch {
  outcome: "target1" | "target2" | "stopLoss" | "expired";
  rMultiple: number;
}

export interface JudgeVerdict {
  symbol: string;
  timeframe: SniperTimeframe;
  matches: number;        // how many similar signals fired in the lookback
  wins: number;
  losses: number;
  winRate: number;        // 0..1
  avgR: number;
  verdict: "strong" | "ok" | "weak" | "insufficient";
  durationMs: number;     // execution time
}

// V37 — Judge backtest cache.
// Caches the FINAL deep verdict per (symbol, timeframe, direction) to avoid
// re-running the 10k-candle replay on every refresh. TTL is timeframe-aware:
// short frames refresh faster, longer frames stay cached longer.
interface JudgeCacheEntry {
  verdict: JudgeVerdict;
  expiresAt: number;
  inFlight?: Promise<JudgeVerdict>;
}
const JUDGE_CACHE = new Map<string, JudgeCacheEntry>();
const TF_CACHE_TTL_MS: Record<SniperTimeframe, number> = {
  "1m": 2 * 60_000, "3m": 5 * 60_000, "5m": 8 * 60_000, "15m": 20 * 60_000,
  "30m": 35 * 60_000, "1h": 60 * 60_000, "2h": 2 * 60 * 60_000,
  "4h": 3 * 60 * 60_000, "6h": 4 * 60 * 60_000, "8h": 5 * 60 * 60_000,
  "12h": 6 * 60 * 60_000, "1d": 12 * 60 * 60_000, "3d": 24 * 60 * 60_000,
  "1w": 48 * 60 * 60_000,
};
const cacheKey = (s: string, tf: SniperTimeframe, d: "long" | "short") => `${s}|${tf}|${d}`;

/** Manually invalidate a specific cached verdict (e.g. after a resolved trade). */
export function invalidateJudgeCache(symbol?: string, tf?: SniperTimeframe, dir?: "long" | "short") {
  if (!symbol) { JUDGE_CACHE.clear(); return; }
  if (tf && dir) { JUDGE_CACHE.delete(cacheKey(symbol, tf, dir)); return; }
  for (const k of Array.from(JUDGE_CACHE.keys())) {
    if (k.startsWith(`${symbol}|`)) JUDGE_CACHE.delete(k);
  }
}

const TF_24H_CANDLES: Record<SniperTimeframe, number> = {
  "1m": 1440, "3m": 480, "5m": 288, "15m": 96, "30m": 48,
  "1h": 24, "2h": 12, "4h": 6, "6h": 4, "8h": 3,
  "12h": 2, "1d": 1, "3d": 1, "1w": 1,
};

// V36 — Candles per hour per timeframe (for review-window sizing).
const TF_CANDLES_PER_HOUR: Record<SniperTimeframe, number> = {
  "1m": 60, "3m": 20, "5m": 12, "15m": 4, "30m": 2,
  "1h": 1, "2h": 0.5, "4h": 0.25, "6h": 1 / 6, "8h": 0.125,
  "12h": 1 / 12, "1d": 1 / 24, "3d": 1 / 72, "1w": 1 / 168,
};

async function fetchKlines(symbol: string, tf: SniperTimeframe, limit: number): Promise<SniperKline[]> {
  // V33 Supreme: pull from the cached, paginated historical layer (up to 10k).
  const raw = await fetchHistoricalKlines(symbol, tf, limit);
  if (!raw) return [];
  return raw.map((k): SniperKline => {
    const row = k as readonly unknown[];
    return {
      openTime: row[0] as number,
      open: +row[1],
      high: +row[2],
      low: +row[3],
      close: +row[4],
      volume: +row[5],
      closeTime: row[6] as number,
    };
  });
}

function simulate(sig: SniperSignal, future: SniperKline[], ttl: number): JudgeMatch {
  const max = Math.min(ttl, future.length);
  const slDist = Math.abs(sig.entry - sig.stopLoss);
  for (let i = 0; i < max; i++) {
    const c = future[i];
    if (sig.direction === "long") {
      const sl = c.low <= sig.stopLoss;
      const t2 = c.high >= sig.target2;
      const t1 = c.high >= sig.target1;
      if (sl && !t1) return { outcome: "stopLoss", rMultiple: -1 };
      if (sl && t1) return { outcome: "stopLoss", rMultiple: -1 };
      if (t2) return { outcome: "target2", rMultiple: slDist > 0 ? (sig.target2 - sig.entry) / slDist : 2 };
      if (t1) return { outcome: "target1", rMultiple: slDist > 0 ? (sig.target1 - sig.entry) / slDist : 0.7 };
    } else {
      const sl = c.high >= sig.stopLoss;
      const t2 = c.low <= sig.target2;
      const t1 = c.low <= sig.target1;
      if (sl && !t1) return { outcome: "stopLoss", rMultiple: -1 };
      if (sl && t1) return { outcome: "stopLoss", rMultiple: -1 };
      if (t2) return { outcome: "target2", rMultiple: slDist > 0 ? (sig.entry - sig.target2) / slDist : 2 };
      if (t1) return { outcome: "target1", rMultiple: slDist > 0 ? (sig.entry - sig.target1) / slDist : 0.7 };
    }
  }
  return { outcome: "expired", rMultiple: 0 };
}

export async function judgeSignal(
  symbol: string,
  tf: SniperTimeframe,
  fng: SniperFearGreed | null,
  direction: "long" | "short",
  onPreliminary?: (v: JudgeVerdict) => void,
): Promise<JudgeVerdict> {
  const t0 = performance.now();
  // V37 — Cache lookup
  const ck = cacheKey(symbol, tf, direction);
  const cached = JUDGE_CACHE.get(ck);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    logDebug("judge", `💾 كاش: ${direction === "short" ? "هبوط" : "صعود"} • WR ${(cached.verdict.winRate * 100).toFixed(0)}% • ${Math.round((cached.expiresAt - now) / 1000)}s متبقية`, { frame: tf, symbol });
    return cached.verdict;
  }
  if (cached?.inFlight) return cached.inFlight;

  const exec = (async (): Promise<JudgeVerdict> => {
    // V36 — Deep window now sized to cover at least one full week of history,
    // capped at DEEP_LOOKBACK (10k). Fast verdict still emitted at FAST_LOOKBACK.
    const weekCandles = Math.ceil(REVIEW_WINDOW_HOURS * (TF_CANDLES_PER_HOUR[tf] ?? 4));
    const targetLookback = Math.min(DEEP_LOOKBACK, Math.max(FAST_LOOKBACK, weekCandles));
    logDebug("judge", `🔎 فحص سريع ${FAST_LOOKBACK} → تعميق ${targetLookback} شمعة (~${REVIEW_WINDOW_HOURS}h) • ${direction === "short" ? "هبوط" : "صعود"}`, { frame: tf, symbol });

    const klines = await fetchKlines(symbol, tf, targetLookback);
    if (klines.length < MIN_CANDLES_FOR_AUDIT) {
      logDebug("judge", `⚠️ بيانات غير كافية (${klines.length} شمعة فقط) — حكم: بيانات قليلة`, { frame: tf, symbol });
      return {
        symbol, timeframe: tf, matches: 0, wins: 0, losses: 0,
        winRate: 0, avgR: 0, verdict: "insufficient",
        durationMs: Math.round(performance.now() - t0),
      };
    }

    const ttl = Math.min(20, Math.floor(TF_24H_CANDLES[tf] / 3) || 6);
    const matches: JudgeMatch[] = [];
    let preliminaryEmitted = false;

    // Walk every candle: build window, run analyzer, if a same-direction signal
    // passes → simulate forward.
    let i = 50;
    while (i < klines.length - ttl) {
      // V35 — emit preliminary verdict the moment we cross the fast window
      if (!preliminaryEmitted && i >= FAST_LOOKBACK && onPreliminary) {
        const w0 = matches.filter(m => m.outcome === "target1" || m.outcome === "target2").length;
        const l0 = matches.filter(m => m.outcome === "stopLoss").length;
        const dec0 = w0 + l0;
        const wr0 = dec0 > 0 ? w0 / dec0 : 0;
        const avgR0 = matches.length > 0 ? matches.reduce((s, m) => s + m.rMultiple, 0) / matches.length : 0;
        let v0: JudgeVerdict["verdict"];
        if (matches.length < 3) v0 = "insufficient";
        else if (wr0 >= 0.6 && avgR0 >= 0.3) v0 = "strong";
        else if (wr0 >= 0.45) v0 = "ok";
        else v0 = "weak";
        onPreliminary({
          symbol, timeframe: tf, matches: matches.length, wins: w0, losses: l0,
          winRate: wr0, avgR: avgR0, verdict: v0,
          durationMs: Math.round(performance.now() - t0),
        });
        preliminaryEmitted = true;
      }

      const window = klines.slice(Math.max(0, i - 50), i + 1);
      const raw: SniperRawSymbol = {
        symbol,
        klines: window,
        flow: null,
        prevFlow: null,
        shieldStartedAt: window[window.length - 1]?.closeTime,
      };
      let sig: SniperSignal;
      try { sig = analyzeSniperSymbol(raw, tf, fng); }
      catch { i++; continue; }

      if (sig.passed && !sig.suppressed && !sig.emergencyExit && sig.direction === direction) {
        const m = simulate(sig, klines.slice(i + 1), ttl);
        matches.push(m);
        i = i + 1 + ttl; // skip past simulated trade
        continue;
      }
      i++;
    }

    const wins = matches.filter(m => m.outcome === "target1" || m.outcome === "target2").length;
    const losses = matches.filter(m => m.outcome === "stopLoss").length;
    const decisive = wins + losses;
    const winRate = decisive > 0 ? wins / decisive : 0;
    const avgR = matches.length > 0 ? matches.reduce((s, m) => s + m.rMultiple, 0) / matches.length : 0;

    let verdict: JudgeVerdict["verdict"];
    if (matches.length < 3) verdict = "insufficient";
    else if (winRate >= 0.6 && avgR >= 0.3) verdict = "strong";
    else if (winRate >= 0.45) verdict = "ok";
    else verdict = "weak";

    const ms = Math.round(performance.now() - t0);
    logDebug(
      "judge",
      `⚖️ ${verdict === "strong" ? "قوي ✅" : verdict === "ok" ? "مقبول 🟡" : verdict === "weak" ? "ضعيف 🔴" : "بيانات قليلة"} • مطابقات ${matches.length} • WR ${(winRate * 100).toFixed(0)}% • R ${avgR.toFixed(2)} • ${ms}ms`,
      { frame: tf, symbol },
    );

    return {
      symbol, timeframe: tf, matches: matches.length, wins, losses,
      winRate, avgR, verdict,
      durationMs: ms,
    };
  })();

  // Track in-flight to coalesce duplicate calls
  JUDGE_CACHE.set(ck, { verdict: cached?.verdict ?? { symbol, timeframe: tf, matches: 0, wins: 0, losses: 0, winRate: 0, avgR: 0, verdict: "insufficient", durationMs: 0 }, expiresAt: cached?.expiresAt ?? 0, inFlight: exec });
  const finalVerdict = await exec;
  JUDGE_CACHE.set(ck, { verdict: finalVerdict, expiresAt: Date.now() + (TF_CACHE_TTL_MS[tf] ?? 10 * 60_000) });
  return finalVerdict;
}
