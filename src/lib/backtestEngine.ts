// V28 — Backtesting Engine
// يُشغّل نفس محرك القناص (analyzeSniperSymbol) على بيانات تاريخية ويُحاكي
// نتائج الصفقات على الشموع اللاحقة لحساب المقاييس الاحترافية:
// Win Rate، Profit Factor، Sharpe Ratio، Max Drawdown، Expectancy، Avg R، رسوم + slippage.

import {
  analyzeSniperSymbol,
  type SniperKline,
  type SniperRawSymbol,
  type SniperSignal,
  type SniperTimeframe,
  type SniperFearGreed,
} from "./sniperEngine";

export interface BacktestConfig {
  timeframe: SniperTimeframe;
  symbols: string[];
  lookbackCandles: number;     // initial fetch (per symbol)
  warmupCandles: number;
  fearGreed: number | null;
  feePct: number;
  slippagePct: number;
  spreadPct?: number;
  riskPerTradePct: number;
  startingBalance: number;
  ttlCandles: number;
  /** V33 — when true, auto-grow lookback up to maxLookbackCandles if too few trades found. */
  autoExtendLookback?: boolean;
  /** V33 — minimum trades wanted before stopping auto-extend. */
  minTradesTarget?: number;
  /** V33 — hard cap on lookback (Binance max ≈ 10,000 paginated). */
  maxLookbackCandles?: number;
}

export const DEFAULT_BACKTEST_CONFIG: Omit<BacktestConfig, "symbols"> = {
  timeframe: "15m",
  lookbackCandles: 500,
  warmupCandles: 40,
  fearGreed: 55,
  feePct: 0.1,
  slippagePct: 0.05,
  spreadPct: 0.03,
  riskPerTradePct: 1.0,
  startingBalance: 1000,
  ttlCandles: 20,
  autoExtendLookback: true,
  minTradesTarget: 10,
  maxLookbackCandles: 10_000,
};

export interface BacktestTrade {
  symbol: string;
  direction: "long" | "short";
  entryIdx: number;
  entryTime: number;
  entryPrice: number;       // after slippage
  exitPrice: number;        // after slippage
  exitIdx: number;
  exitTime: number;
  outcome: "target1" | "target2" | "stopLoss" | "expired" | "target3" | "runner";
  rawPnlPct: number;        // price-only
  netPnlPct: number;        // after fees + slippage
  rMultiple: number;        // how many R we captured
  confidence: number;
  grade?: string;
  pattern: string;
  // V2 — enhanced fields
  marketRegime?: string;
  smartMoneyScore?: number;
  confidenceScore?: number;
  breakoutType?: "real" | "weak" | "fake";
}

export interface BacktestMetrics {
  trades: number;
  wins: number;
  losses: number;
  winRate: number;          // 0..1
  totalReturnPct: number;   // cumulative % on starting balance
  finalBalance: number;
  profitFactor: number;     // sum(wins) / sum(losses)
  expectancy: number;       // avg netPnlPct per trade
  sharpe: number;           // annualized
  maxDrawdownPct: number;
  avgR: number;
  avgWinR: number;
  avgLossR: number;
  longs: number;
  shorts: number;
  equityCurve: { t: number; balance: number; drawdown: number }[];
  // V2 — enhanced metrics
  bestRegime?: string;
  worstRegime?: string;
  bestTimeframe?: string;
  regimeBreakdown?: Record<string, { trades: number; winRate: number; avgPnl: number }>;
  consecutiveMaxLoss?: number;
  fakeBreakoutRate?: number;
}

export interface BacktestResult {
  config: BacktestConfig;
  trades: BacktestTrade[];
  metrics: BacktestMetrics;
  perSymbol: Record<string, { trades: number; wins: number; winRate: number; pnlPct: number }>;
}

// ---------- Data fetching ----------
// V33 Phase 3 — uses centralized binanceDataLayer for true pagination up to
// 10,000 candles (Binance caps each request at 1000; we now stitch them).
import { fetchHistoricalKlines as fetchHistFromLayer } from "./binanceDataLayer";

async function fetchHistoricalKlines(
  symbol: string,
  tf: SniperTimeframe,
  limit: number,
): Promise<SniperKline[]> {
  const raw = await fetchHistFromLayer(symbol, tf, Math.min(limit, 10_000));
  if (!raw) return [];
  return raw.map((k: unknown) => ({
    openTime: k[0],
    open: +k[1],
    high: +k[2],
    low: +k[3],
    close: +k[4],
    volume: +k[5],
    closeTime: k[6],
  }));
}

// ---------- Simulation ----------

/**
 * Given a signal and the *future* candles after entry, determine the outcome.
 * For longs: T1/T2 hit if high >= target ; SL hit if low <= SL.
 * For shorts: T1/T2 hit if low <= target ; SL hit if high >= SL.
 * If SL and T1 happen in the same candle we assume SL first (pessimistic).
 */
function simulateOutcome(
  sig: SniperSignal,
  futureCandles: SniperKline[],
  ttlCandles: number,
): { outcome: BacktestTrade["outcome"]; exitPrice: number; exitIdx: number; exitTime: number } {
  const max = Math.min(ttlCandles, futureCandles.length);
  for (let i = 0; i < max; i++) {
    const c = futureCandles[i];
    if (sig.direction === "long") {
      const slHit = c.low <= sig.stopLoss;
      const t2Hit = c.high >= sig.target2;
      const t1Hit = c.high >= sig.target1;
      if (slHit && !t1Hit) {
        return { outcome: "stopLoss", exitPrice: sig.stopLoss, exitIdx: i, exitTime: c.closeTime };
      }
      if (slHit && t1Hit) {
        // ambiguous — pessimistic = SL first
        return { outcome: "stopLoss", exitPrice: sig.stopLoss, exitIdx: i, exitTime: c.closeTime };
      }
      if (t2Hit) {
        return { outcome: "target2", exitPrice: sig.target2, exitIdx: i, exitTime: c.closeTime };
      }
      if (t1Hit) {
        // T1 partial — book 50% at T1, then check remaining candles for T2 or BE-stop
        return simulateAfterT1(sig, futureCandles, i, ttlCandles);
      }
    } else {
      const slHit = c.high >= sig.stopLoss;
      const t2Hit = c.low <= sig.target2;
      const t1Hit = c.low <= sig.target1;
      if (slHit && !t1Hit) {
        return { outcome: "stopLoss", exitPrice: sig.stopLoss, exitIdx: i, exitTime: c.closeTime };
      }
      if (slHit && t1Hit) {
        return { outcome: "stopLoss", exitPrice: sig.stopLoss, exitIdx: i, exitTime: c.closeTime };
      }
      if (t2Hit) {
        return { outcome: "target2", exitPrice: sig.target2, exitIdx: i, exitTime: c.closeTime };
      }
      if (t1Hit) {
        return simulateAfterT1(sig, futureCandles, i, ttlCandles);
      }
    }
  }
  // TTL expired without T1 — exit at last close
  const last = futureCandles[max - 1] ?? futureCandles[futureCandles.length - 1];
  return { outcome: "expired", exitPrice: last?.close ?? sig.entry, exitIdx: max - 1, exitTime: last?.closeTime ?? Date.now() };
}

function simulateAfterT1(
  sig: SniperSignal,
  future: SniperKline[],
  t1Idx: number,
  ttlCandles: number,
): { outcome: BacktestTrade["outcome"]; exitPrice: number; exitIdx: number; exitTime: number } {
  // After T1: SL is at break-even (= entry). Check remaining candles for T2 or BE stop.
  const max = Math.min(ttlCandles, future.length);
  for (let i = t1Idx + 1; i < max; i++) {
    const c = future[i];
    if (sig.direction === "long") {
      if (c.low <= sig.entry) {
        // BE stop → secured T1 on first 50% ; second 50% exits at break-even
        const blended = (sig.target1 + sig.entry) / 2;
        return { outcome: "target1", exitPrice: blended, exitIdx: i, exitTime: c.closeTime };
      }
      if (c.high >= sig.target2) {
        const blended = (sig.target1 + sig.target2) / 2;
        return { outcome: "target2", exitPrice: blended, exitIdx: i, exitTime: c.closeTime };
      }
    } else {
      if (c.high >= sig.entry) {
        const blended = (sig.target1 + sig.entry) / 2;
        return { outcome: "target1", exitPrice: blended, exitIdx: i, exitTime: c.closeTime };
      }
      if (c.low <= sig.target2) {
        const blended = (sig.target1 + sig.target2) / 2;
        return { outcome: "target2", exitPrice: blended, exitIdx: i, exitTime: c.closeTime };
      }
    }
  }
  // Expired after T1 → exit at last close (blended with T1)
  const last = future[max - 1] ?? future[future.length - 1];
  const blended = ((last?.close ?? sig.entry) + sig.target1) / 2;
  return { outcome: "target1", exitPrice: blended, exitIdx: max - 1, exitTime: last?.closeTime ?? Date.now() };
}

// ---------- Metrics ----------

function computeMetrics(trades: BacktestTrade[], config: BacktestConfig): BacktestMetrics {
  const n = trades.length;
  if (n === 0) {
    return {
      trades: 0, wins: 0, losses: 0, winRate: 0, totalReturnPct: 0,
      finalBalance: config.startingBalance, profitFactor: 0, expectancy: 0,
      sharpe: 0, maxDrawdownPct: 0, avgR: 0, avgWinR: 0, avgLossR: 0,
      longs: 0, shorts: 0, equityCurve: [],
    };
  }
  const wins = trades.filter(t => t.netPnlPct > 0).length;
  const losses = n - wins;
  const winRate = wins / n;
  const longs = trades.filter(t => t.direction === "long").length;
  const shorts = n - longs;

  const grossWins = trades.filter(t => t.netPnlPct > 0).reduce((s, t) => s + t.netPnlPct, 0);
  const grossLosses = Math.abs(trades.filter(t => t.netPnlPct < 0).reduce((s, t) => s + t.netPnlPct, 0));
  const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? 999 : 0;

  const expectancy = trades.reduce((s, t) => s + t.netPnlPct, 0) / n;
  const avgR = trades.reduce((s, t) => s + t.rMultiple, 0) / n;
  const winTrades = trades.filter(t => t.rMultiple > 0);
  const lossTrades = trades.filter(t => t.rMultiple <= 0);
  const avgWinR = winTrades.length ? winTrades.reduce((s, t) => s + t.rMultiple, 0) / winTrades.length : 0;
  const avgLossR = lossTrades.length ? lossTrades.reduce((s, t) => s + t.rMultiple, 0) / lossTrades.length : 0;

  // Equity curve — compound using riskPerTrade% as position sizing
  let balance = config.startingBalance;
  let peak = balance;
  let maxDd = 0;
  const curve: BacktestMetrics["equityCurve"] = [{ t: trades[0].entryTime, balance, drawdown: 0 }];
  for (const t of trades) {
    // position size s.t. loss at SL = riskPerTrade% of balance
    // actual P&L % applied: netPnlPct × (riskPct / slDistancePct)
    // Simplified: treat rMultiple × riskPct as balance impact
    const impactPct = t.rMultiple * config.riskPerTradePct;
    balance = balance * (1 + impactPct / 100);
    peak = Math.max(peak, balance);
    const dd = ((peak - balance) / peak) * 100;
    if (dd > maxDd) maxDd = dd;
    curve.push({ t: t.exitTime, balance, drawdown: dd });
  }

  const totalReturnPct = ((balance - config.startingBalance) / config.startingBalance) * 100;

  // Sharpe: mean(returns) / stdev(returns) × sqrt(periods per year for the timeframe)
  const returns = trades.map(t => t.rMultiple * config.riskPerTradePct);
  const mean = returns.reduce((s, v) => s + v, 0) / returns.length;
  const variance = returns.reduce((s, v) => s + (v - mean) ** 2, 0) / returns.length;
  const stdev = Math.sqrt(variance);
  // V29 — proper per-timeframe annualization (24/7 crypto market)
  const PERIODS_PER_YEAR: Record<SniperTimeframe, number> = {
    "1m": 525_600, "3m": 175_200, "5m": 105_120, "15m": 35_040, "30m": 17_520,
    "1h": 8_760, "2h": 4_380, "4h": 2_190, "6h": 1_460, "8h": 1_095,
    "12h": 730, "1d": 365, "3d": 122, "1w": 52,
  };
  const annualFactor = Math.sqrt(PERIODS_PER_YEAR[config.timeframe] ?? 35_040);
  const sharpe = stdev > 0 ? (mean / stdev) * annualFactor : 0;

  return {
    trades: n, wins, losses, winRate,
    totalReturnPct, finalBalance: balance,
    profitFactor, expectancy,
    sharpe, maxDrawdownPct: maxDd,
    avgR, avgWinR, avgLossR,
    longs, shorts,
    equityCurve: curve,
  };
}

// ---------- Main runner ----------

async function runBacktestOnce(
  config: BacktestConfig,
  onProgress?: (done: number, total: number, status: string) => void,
): Promise<BacktestResult> {
  const trades: BacktestTrade[] = [];
  const perSymbolRaw: Record<string, BacktestTrade[]> = {};
  const fng: SniperFearGreed | null = config.fearGreed !== null
    ? { value: config.fearGreed, classification: fngLabel(config.fearGreed) }
    : null;

  for (let sIdx = 0; sIdx < config.symbols.length; sIdx++) {
    const symbol = config.symbols[sIdx];
    onProgress?.(sIdx, config.symbols.length, `جلب ${symbol} (${config.lookbackCandles} شمعة)`);
    const klines = await fetchHistoricalKlines(symbol, config.timeframe, config.lookbackCandles);
    if (klines.length < config.warmupCandles + 10) continue;

    perSymbolRaw[symbol] = [];
    let i = config.warmupCandles;
    while (i < klines.length - config.ttlCandles) {
      const window = klines.slice(Math.max(0, i - 50), i + 1);
      const raw: SniperRawSymbol = {
        symbol,
        klines: window,
        flow: null,
        prevFlow: null,
        shieldStartedAt: window[window.length - 1]?.closeTime,
      };
      let signal: SniperSignal;
      try { signal = analyzeSniperSymbol(raw, config.timeframe, fng); }
      catch { i++; continue; }

      if (signal.passed && !signal.suppressed && !signal.emergencyExit) {
        const future = klines.slice(i + 1);
        const sim = simulateOutcome(signal, future, config.ttlCandles);

        const slipMultEntry = signal.direction === "long" ? 1 + config.slippagePct / 100 : 1 - config.slippagePct / 100;
        const slipMultExit = signal.direction === "long" ? 1 - config.slippagePct / 100 : 1 + config.slippagePct / 100;
        const actualEntry = signal.entry * slipMultEntry;
        const actualExit = sim.exitPrice * slipMultExit;

        const rawPnlPct = signal.direction === "long"
          ? ((sim.exitPrice - signal.entry) / signal.entry) * 100
          : ((signal.entry - sim.exitPrice) / signal.entry) * 100;
        const netPnlPct = signal.direction === "long"
          ? ((actualExit - actualEntry) / actualEntry) * 100 - 2 * config.feePct - (config.spreadPct ?? 0)
          : ((actualEntry - actualExit) / actualEntry) * 100 - 2 * config.feePct - (config.spreadPct ?? 0);

        const slDistancePct = Math.abs((signal.entry - signal.stopLoss) / signal.entry) * 100;
        const rMultiple = slDistancePct > 0 ? netPnlPct / slDistancePct : 0;

        const trade: BacktestTrade = {
          symbol, direction: signal.direction,
          entryIdx: i, entryTime: klines[i].closeTime,
          entryPrice: actualEntry, exitPrice: actualExit,
          exitIdx: i + 1 + sim.exitIdx, exitTime: sim.exitTime,
          outcome: sim.outcome,
          rawPnlPct, netPnlPct, rMultiple,
          confidence: signal.confidence, grade: signal.quality?.grade,
          pattern: signal.patternLabel,
        };
        trades.push(trade);
        perSymbolRaw[symbol].push(trade);
        i = i + 1 + sim.exitIdx + 1;
        continue;
      }
      i++;
    }
    onProgress?.(sIdx + 1, config.symbols.length, `${symbol}: ${perSymbolRaw[symbol].length} صفقة`);
  }

  onProgress?.(config.symbols.length, config.symbols.length, "حساب المقاييس...");
  trades.sort((a, b) => a.entryTime - b.entryTime);
  const metrics = computeMetrics(trades, config);

  const perSymbol: BacktestResult["perSymbol"] = {};
  for (const [sym, ts] of Object.entries(perSymbolRaw)) {
    const wins = ts.filter(t => t.netPnlPct > 0).length;
    const pnl = ts.reduce((s, t) => s + t.netPnlPct, 0);
    perSymbol[sym] = { trades: ts.length, wins, winRate: ts.length ? wins / ts.length : 0, pnlPct: pnl };
  }

  return { config, trades, metrics, perSymbol };
}

/**
 * V33 — Public runner with optional auto-extend lookback. If the initial run
 * produced fewer than minTradesTarget trades, doubles the lookback and re-runs
 * (cached) up to maxLookbackCandles. This eliminates the practical 24h cap.
 */
export async function runBacktest(
  config: BacktestConfig,
  onProgress?: (done: number, total: number, status: string) => void,
): Promise<BacktestResult> {
  const wantAutoExtend = config.autoExtendLookback !== false;
  const minTrades = config.minTradesTarget ?? 10;
  const maxLookback = Math.min(10_000, config.maxLookbackCandles ?? 10_000);

  let cur = config;
  let result = await runBacktestOnce(cur, onProgress);
  if (!wantAutoExtend) return result;

  let attempts = 0;
  while (result.trades.length < minTrades && cur.lookbackCandles < maxLookback && attempts < 4) {
    const next = Math.min(maxLookback, Math.max(cur.lookbackCandles * 2, cur.lookbackCandles + 1000));
    if (next <= cur.lookbackCandles) break;
    onProgress?.(0, config.symbols.length,
      `صفقات قليلة (${result.trades.length}) — توسيع التاريخ إلى ${next} شمعة...`);
    cur = { ...cur, lookbackCandles: next };
    result = await runBacktestOnce(cur, onProgress);
    attempts++;
  }
  return result;
}

function fngLabel(v: number): string {
  if (v < 25) return "Extreme Fear";
  if (v < 45) return "Fear";
  if (v < 55) return "Neutral";
  if (v < 75) return "Greed";
  return "Extreme Greed";
}
