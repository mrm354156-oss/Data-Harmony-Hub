// ============================================================
// Institutional-Grade Signal Engine V18
//   • Market Regime Detection (Trend / Range / Volatile / Choppy)
//   • Dynamic per-regime weight distribution (sums to 100)
//   • Dynamic ATR thresholds for volume + whale flow
//   • Trap Detection (Fake Breakout / Wick Rejection / Liquidity Grab
//     / Volume Trap / False Momentum)
//   • Hard Quality Gate (≥90 score AND R/R ≥ 1:2)
// ============================================================
import type { SniperKline, SniperFlow, SniperFearGreed, SniperDirection } from "./sniperEngine";
import { getSweepSensitivity } from "./sniperSettings";
import type { MultiIndicatorVerdict } from "./multiIndicatorEngine";

export type MarketRegime =
  | "trend_up"
  | "trend_down"
  | "strong_trend_up"
  | "strong_trend_down"
  | "range"
  | "volatile"
  | "choppy"
  | "squeeze"
  | "low_liquidity";  // V2: سيولة منخفضة — تقلبات عشوائية

export type SignalGrade = "A+" | "A" | "B" | "rejected";
export type TrapType = "fake_breakout" | "wick_rejection" | "liquidity_grab" | "volume_trap" | "false_momentum" | "stop_hunt" | "exhaustion_climax" | "divergence_trap" | "iceberg_absorption" | "low_quality_pattern";

export interface RegimeInfo {
  regime: MarketRegime;
  label: string;
  atrPct: number;        // ATR as % of price
  trendStrength: number; // 0-100 (legacy — EMA spread based)
  // V26 — extended diagnostics
  adxLite: number;             // 0-100 (slope-quality based)
  stdDevPct: number;           // closes std-dev as % of price
  confidenceInRegime: number;  // 0-100 — how sure the detector is
  // V2 — enhanced diagnostics
  bbWidth: number;             // Bollinger Band Width as % of price
  volumeStability: number;     // 0-100 — how stable volume is
  directionChanges: number;    // count of direction flips
  liquidityScore: number;      // 0-100 — estimated liquidity level
  signalBehavior: SignalBehavior; // V2 — recommended behavior for this regime
}

// V2 — Signal behavior recommendations per regime
export interface SignalBehavior {
  allowMoreSignals: boolean;    // allow more entry signals
  expandTargets: boolean;       // widen TP targets
  allowRunner: boolean;         // allow runner TP
  reduceTargets: boolean;       // tighten TP targets
  preventBreakouts: boolean;    // prevent breakout entries
  raiseEntryConditions: boolean; // require stricter entry conditions
  reduceConfidence: boolean;    // lower confidence scores
  reduceRisk: boolean;          // reduce position sizing
  preventRandomEntry: boolean;  // block random entries
  maxSignalsPerHour: number;    // max signals allowed per hour
}

export interface DynamicThresholds {
  minVolumeRatio: number;
  minWhaleFlowAbsPct: number;
  minConfidence: number;
  minAgreeingIndicators: number;
  minRiskReward: number; // V26 — per-regime R/R floor
}

export interface ScoreWeights {
  whale: number; volume: number; trend: number; tech: number; fng: number; // sum = 100
}

export interface TrapVerdict {
  detected: boolean;
  types: TrapType[];
  reason: string;
}

export interface QualityScore {
  total: number;
  grade: SignalGrade;
  components: {
    whale: number; volume: number; trend: number; tech: number; fng: number;
  };
  weights: ScoreWeights;
  passed: boolean;
  rejectionReason?: string;
  targetProbability: number;
  trap: TrapVerdict;
}

// =================== Market Regime ===================
function ema(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const out = [values[0]];
  for (let i = 1; i < values.length; i++) out.push(values[i] * k + out[i - 1] * (1 - k));
  return out;
}

// V26 — Linear-regression slope quality (poor man's ADX): how cleanly the
// price moves in one direction. Returns 0..100.
function adxLite(closes: number[]): { score: number; slopePct: number } {
  const n = Math.min(20, closes.length);
  if (n < 5) return { score: 0, slopePct: 0 };
  const series = closes.slice(-n);
  // Least-squares slope on index→price
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (let i = 0; i < n; i++) { sumX += i; sumY += series[i]; sumXY += i * series[i]; sumXX += i * i; }
  const meanX = sumX / n, meanY = sumY / n;
  const slope = (sumXY - n * meanX * meanY) / Math.max(1e-9, sumXX - n * meanX * meanX);
  const slopePct = meanY > 0 ? (slope / meanY) * 100 : 0;
  // Residual error (deviation around the regression line)
  let ssRes = 0;
  for (let i = 0; i < n; i++) {
    const pred = meanY + slope * (i - meanX);
    ssRes += (series[i] - pred) ** 2;
  }
  const rmse = Math.sqrt(ssRes / n);
  const rmsePct = meanY > 0 ? (rmse / meanY) * 100 : 0;
  // Cleaner trend = high |slopePct| and low rmsePct → high score
  const ratio = rmsePct > 0 ? Math.abs(slopePct) / rmsePct : 0;
  const score = Math.min(100, ratio * 60);
  return { score, slopePct };
}

// V26 — Std-dev of closes as % of mean price. Low = squeeze; high = volatile.
function stdDevPctOfCloses(closes: number[]): number {
  const n = Math.min(20, closes.length);
  if (n < 3) return 0;
  const series = closes.slice(-n);
  const mean = series.reduce((a, b) => a + b, 0) / n;
  if (mean <= 0) return 0;
  const variance = series.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  return (Math.sqrt(variance) / mean) * 100;
}

// V2 — Calculate Bollinger Band Width
function bbWidth(closes: number[], period = 20): number {
  const n = Math.min(period, closes.length);
  if (n < 2) return 0;
  const series = closes.slice(-n);
  const mean = series.reduce((a, b) => a + b, 0) / n;
  if (mean <= 0) return 0;
  const variance = series.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const stdDev = Math.sqrt(variance);
  return (stdDev * 2 / mean) * 100; // BB Width as % of price
}

// V2 — Volume Stability: coefficient of variation of volume (lower = more stable)
function volumeStability(klines: SniperKline[]): number {
  const vols = klines.slice(-14).map(k => k.volume);
  if (vols.length < 3) return 50;
  const mean = vols.reduce((a, b) => a + b, 0) / vols.length;
  if (mean <= 0) return 50;
  const variance = vols.reduce((a, b) => a + (b - mean) ** 2, 0) / vols.length;
  const cv = Math.sqrt(variance) / mean; // coefficient of variation
  // Lower CV = more stable = higher score
  return Math.max(0, Math.min(100, Math.round(100 - cv * 100)));
}

// V2 — Liquidity Score: estimated from volume + spread
function liquidityScore(klines: SniperKline[]): number {
  const recent = klines.slice(-10);
  if (recent.length < 3) return 50;
  const avgVolume = recent.reduce((a, k) => a + k.volume, 0) / recent.length;
  const avgSpread = recent.reduce((a, k) => a + (k.high - k.low), 0) / recent.length;
  const lastPrice = recent[recent.length - 1].close;
  if (lastPrice <= 0) return 50;
  const spreadPct = (avgSpread / lastPrice) * 100;
  // High volume + tight spread = high liquidity
  const volScore = Math.min(100, avgVolume / 1000 * 10); // normalize
  const spreadScore = Math.max(0, 100 - spreadPct * 200); // lower spread = better
  return Math.round(volScore * 0.6 + spreadScore * 0.4);
}

// V2 — Get signal behavior recommendations based on regime
function getSignalBehavior(regime: MarketRegime, confidenceInRegime: number): SignalBehavior {
  switch (regime) {
    case "strong_trend_up":
    case "strong_trend_down":
      return {
        allowMoreSignals: true,
        expandTargets: true,
        allowRunner: true,
        reduceTargets: false,
        preventBreakouts: false,
        raiseEntryConditions: false,
        reduceConfidence: false,
        reduceRisk: false,
        preventRandomEntry: false,
        maxSignalsPerHour: 5,
      };
    case "trend_up":
    case "trend_down":
      return {
        allowMoreSignals: true,
        expandTargets: true,
        allowRunner: true,
        reduceTargets: false,
        preventBreakouts: false,
        raiseEntryConditions: false,
        reduceConfidence: false,
        reduceRisk: false,
        preventRandomEntry: false,
        maxSignalsPerHour: 4,
      };
    case "range":
      return {
        allowMoreSignals: false,
        expandTargets: false,
        allowRunner: false,
        reduceTargets: true,
        preventBreakouts: true,
        raiseEntryConditions: true,
        reduceConfidence: true,
        reduceRisk: true,
        preventRandomEntry: false,
        maxSignalsPerHour: 2,
      };
    case "volatile":
      return {
        allowMoreSignals: false,
        expandTargets: true,
        allowRunner: false,
        reduceTargets: false,
        preventBreakouts: false,
        raiseEntryConditions: true,
        reduceConfidence: true,
        reduceRisk: true,
        preventRandomEntry: true,
        maxSignalsPerHour: 2,
      };
    case "choppy":
    case "squeeze":
    case "low_liquidity":
    default:
      return {
        allowMoreSignals: false,
        expandTargets: false,
        allowRunner: false,
        reduceTargets: true,
        preventBreakouts: true,
        raiseEntryConditions: true,
        reduceConfidence: true,
        reduceRisk: true,
        preventRandomEntry: true,
        maxSignalsPerHour: 1,
      };
  }
}

export function detectMarketRegime(klines: SniperKline[]): RegimeInfo {
  const closes = klines.map(k => k.close);
  const last = closes[closes.length - 1];

  const ranges = klines.slice(-14).map(k => k.high - k.low);
  const atr = ranges.reduce((a, b) => a + b, 0) / Math.max(1, ranges.length);
  const atrPct = last > 0 ? (atr / last) * 100 : 0;

  const e9 = ema(closes, 9);
  const e50 = ema(closes, Math.min(50, closes.length));
  const ema9 = e9[e9.length - 1];
  const ema50 = e50[e50.length - 1];
  const emaSpread = last > 0 ? Math.abs(ema9 - ema50) / last * 100 : 0;
  const trendStrength = Math.min(100, emaSpread * 50);

  // V26 — extended diagnostics
  const { score: adxScore, slopePct } = adxLite(closes);
  const stdDevPct = stdDevPctOfCloses(closes);

  // V2 — enhanced diagnostics
  const bbWidthPct = bbWidth(closes);
  const volumeStab = volumeStability(klines);
  const liqScore = liquidityScore(klines);

  // Choppiness: count direction flips in last 10 closes
  let flips = 0;
  for (let i = closes.length - 10; i < closes.length - 1; i++) {
    if (i < 1) continue;
    const prevDir = closes[i] > closes[i - 1];
    const currDir = closes[i + 1] > closes[i];
    if (prevDir !== currDir) flips++;
  }

  let regime: MarketRegime;
  let label: string;
  let confidenceInRegime: number;

  // V2 — Low Liquidity detection (low volume + high spread)
  if (liqScore < 30 && volumeStab < 40) {
    regime = "low_liquidity";
    label = "💧 سيولة منخفضة";
    confidenceInRegime = Math.round(60 + Math.min(30, (30 - liqScore) * 2));
  }
  // V26 — Squeeze (انضغاط): very low ATR + low std-dev → coiling before expansion
  else if (atrPct < 0.6 && stdDevPct < 0.5 && adxScore < 25) {
    regime = "squeeze";
    label = "🪤 انضغاط — قبل الانفجار";
    confidenceInRegime = Math.round(70 + (0.6 - atrPct) * 30);
  }
  else if (atrPct > 2.5) {
    regime = "volatile";
    label = "🌊 سوق متقلب";
    confidenceInRegime = Math.round(60 + Math.min(30, (atrPct - 2.5) * 15));
  }
  else if (flips >= 6) {
    regime = "choppy";
    label = "⚡ سوق عشوائي";
    confidenceInRegime = Math.round(55 + (flips - 6) * 8);
  }
  else if (adxScore >= 70 && Math.abs(slopePct) >= 0.08) {
    // V2 — Strong trend: very high ADX + steep slope
    regime = slopePct > 0 ? "strong_trend_up" : "strong_trend_down";
    label = slopePct > 0 ? "🚀 ترند صاعد قوي جداً" : "📉 ترند هابط قوي جداً";
    confidenceInRegime = Math.round(Math.min(98, adxScore * 0.95 + 5));
  }
  else if (adxScore >= 50 && Math.abs(slopePct) >= 0.05) {
    // Strong, clean trend (V26 — uses ADX-lite instead of just EMA spread)
    regime = slopePct > 0 ? "trend_up" : "trend_down";
    label = slopePct > 0 ? "📈 ترند صاعد قوي" : "📉 ترند هابط قوي";
    confidenceInRegime = Math.round(Math.min(95, adxScore * 0.9 + 10));
  }
  else if (trendStrength >= 40) {
    regime = ema9 > ema50 ? "trend_up" : "trend_down";
    label = ema9 > ema50 ? "📈 ترند صاعد" : "📉 ترند هابط";
    confidenceInRegime = Math.round(50 + Math.min(35, trendStrength * 0.35));
  }
  else {
    regime = "range";
    label = "↔️ سوق عرضي";
    confidenceInRegime = Math.round(60 - Math.min(20, flips * 3));
  }
  confidenceInRegime = Math.max(20, Math.min(99, confidenceInRegime));

  const signalBehavior = getSignalBehavior(regime, confidenceInRegime);

  return {
    regime, label, atrPct, trendStrength,
    adxLite: Math.round(adxScore), stdDevPct: +stdDevPct.toFixed(3),
    confidenceInRegime,
    bbWidth: +bbWidthPct.toFixed(3),
    volumeStability: volumeStab,
    directionChanges: flips,
    liquidityScore: liqScore,
    signalBehavior,
  };
}

// =================== Dynamic Thresholds ===================
export function getDynamicThresholds(
  regime: MarketRegime,
  metaPenalty: number = 0,
  regimeConfidence: number = 70, // V26 — fade thresholds when regime detection is unsure
  timeframe?: string, // V42+ — adjust thresholds per timeframe
): DynamicThresholds {
  // Harmonized thresholds — customized as requested: body=56, confidence=86
  let base: DynamicThresholds;
  switch (regime) {
    case "volatile":
      base = { minVolumeRatio: 1.5, minWhaleFlowAbsPct: 15, minConfidence: 56, minAgreeingIndicators: 4, minRiskReward: 1.6 };
      break;
    case "choppy":
      base = { minVolumeRatio: 1.6, minWhaleFlowAbsPct: 20, minConfidence: 56, minAgreeingIndicators: 4, minRiskReward: 1.6 };
      break;
    case "squeeze":
      base = { minVolumeRatio: 1.5, minWhaleFlowAbsPct: 15, minConfidence: 56, minAgreeingIndicators: 4, minRiskReward: 1.6 };
      break;
    case "trend_up":
    case "trend_down":
      base = { minVolumeRatio: 1.4, minWhaleFlowAbsPct: 10, minConfidence: 56, minAgreeingIndicators: 3, minRiskReward: 1.4 };
      break;
    case "range":
    default:
      base = { minVolumeRatio: 1.4, minWhaleFlowAbsPct: 12, minConfidence: 56, minAgreeingIndicators: 3, minRiskReward: 1.4 };
  }
  // V26 — when regime detection is uncertain (<60), tighten thresholds slightly
  const uncertaintyPenalty = regimeConfidence < 60 ? (60 - regimeConfidence) * 0.05 : 0;
  // V42+ — Relax thresholds for higher timeframes (more candles = more noise)
  const htfRelax = timeframe && !["1m", "3m", "5m", "15m", "30m"].includes(timeframe) ? 0.85 : 1.0;
  return {
    minVolumeRatio: +(base.minVolumeRatio * htfRelax + metaPenalty * 0.02 + uncertaintyPenalty * 0.01).toFixed(2),
    minWhaleFlowAbsPct: Math.round(base.minWhaleFlowAbsPct * htfRelax + metaPenalty * 0.3 + uncertaintyPenalty * 0.2),
    minConfidence: Math.min(96, Math.round(base.minConfidence * htfRelax + metaPenalty * 0.2 + uncertaintyPenalty * 0.3)),
    minAgreeingIndicators: base.minAgreeingIndicators,
    minRiskReward: +(base.minRiskReward * htfRelax + uncertaintyPenalty * 0.01).toFixed(2),
  };
}

// =================== Dynamic Weights per Regime ===================
// Always sum to 100. Reallocates between Trend (EMA) and Tech (RSI/MACD)
// based on whether the market is trending or ranging.
export function getDynamicWeights(regime: MarketRegime): ScoreWeights {
  switch (regime) {
    case "trend_up":
    case "trend_down":
      // Trend market → boost EMA/Trend weight, lower oscillator weight
      return { whale: 30, volume: 25, trend: 25, tech: 15, fng: 5 };
    case "range":
      // Range market → boost RSI/MACD (mean reversion), lower trend
      return { whale: 30, volume: 25, trend: 15, tech: 25, fng: 5 };
    case "squeeze":
      // V26 — Squeeze: trust volume + smart-money the most (breakout detection)
      return { whale: 35, volume: 35, trend: 10, tech: 15, fng: 5 };
    case "volatile":
      // Volatile → trust smart money + volume more
      return { whale: 35, volume: 30, trend: 15, tech: 15, fng: 5 };
    case "choppy":
    default:
      // Choppy → balanced but most signals will be rejected anyway
      return { whale: 30, volume: 25, trend: 20, tech: 20, fng: 5 };
  }
}

// Arabic label for each trap type — used by both detectTraps and the quality gate.
const TRAP_LABELS: Record<TrapType, string> = {
  fake_breakout: "كسر كاذب",
  wick_rejection: "رفض بظل طويل",
  liquidity_grab: "اصطياد سيولة",
  volume_trap: "فخ فوليوم",
  false_momentum: "زخم وهمي",
  stop_hunt: "صيد ستوبات",
  exhaustion_climax: "إنهاك/قمة شراء",
  divergence_trap: "دايفرجنس عكسي",
  iceberg_absorption: "امتصاص خفي (آيسبرغ)",
  low_quality_pattern: "نطاق ميت — جودة ضعيفة",
};
export const labelOf = (t: TrapType): string => TRAP_LABELS[t];

// =================== Trap Detection (V25 — expanded) ===================
export function detectTraps(
  klines: SniperKline[],
  direction: SniperDirection,
  flow: SniperFlow | null,
  volumeRatio: number,
  rsi?: number,
): TrapVerdict {
  const types: TrapType[] = [];
  const n = klines.length;
  if (n < 6) return { detected: false, types: [], reason: "" };

  const last = klines[n - 1];
  const prev = klines[n - 2];
  const prev2 = klines[n - 3];
  const prev3 = klines[n - 4];

  const body = Math.abs(last.close - last.open);
  const range = last.high - last.low;
  const upperWick = last.high - Math.max(last.open, last.close);
  const lowerWick = Math.min(last.open, last.close) - last.low;
  const bodyPct = range > 0 ? body / range : 0;

  // Recent swing levels for breakout reference
  const lookback = klines.slice(-11, -1);
  const recentHigh = Math.max(...lookback.map(k => k.high));
  const recentLow = Math.min(...lookback.map(k => k.low));
  const lookbackRange = recentHigh - recentLow;
  const lookbackMidPrice = (recentHigh + recentLow) / 2;

  // 1) FAKE BREAKOUT — broke level intra-bar but closed back inside
  if (direction === "long") {
    if (last.high > recentHigh * 1.001 && last.close < recentHigh) {
      types.push("fake_breakout");
    }
  } else {
    if (last.low < recentLow * 0.999 && last.close > recentLow) {
      types.push("fake_breakout");
    }
  }

  // 2) WICK REJECTION — long wick against the trade direction (>= 55% of range)
  // Tightened from 60% → 55% to catch earlier rejections.
  if (range > 0) {
    if (direction === "long" && upperWick / range >= 0.55) types.push("wick_rejection");
    if (direction === "short" && lowerWick / range >= 0.55) types.push("wick_rejection");
  }

  // 3) LIQUIDITY GRAB — wick pierced level, then sharply reversed within same candle
  if (direction === "long") {
    const grabbed = last.low < recentLow && last.close > recentLow * 1.001;
    if (grabbed && lowerWick > body * 1.5) types.push("liquidity_grab");
  } else {
    const grabbed = last.high > recentHigh && last.close < recentHigh * 0.999;
    if (grabbed && upperWick > body * 1.5) types.push("liquidity_grab");
  }

  // 4) VOLUME TRAP — volume exploded but flow contradicts trade direction
  if (flow && volumeRatio >= 1.8) {
    const buy = flow.buyVol, sell = flow.sellVol, total = buy + sell;
    const flowPct = total > 0 ? ((buy - sell) / total) * 100 : 0;
    if (direction === "long" && flowPct < -10) types.push("volume_trap");
    if (direction === "short" && flowPct > 10) types.push("volume_trap");
  }

  // 5) FALSE MOMENTUM — single big push without continuation (mostly wicks)
  const prevBody = Math.abs(prev.close - prev.open);
  const prev2Body = Math.abs(prev2.close - prev2.open);
  const avgPrevBody = (prevBody + prev2Body) / 2;
  if (avgPrevBody > 0 && body > avgPrevBody * 2 && bodyPct < 0.45) {
    types.push("false_momentum");
  }

  // 6) STOP HUNT (V25) — classic 3-bar pattern: spike → sweep → reversal close.
  // For long: prev2 made a local low, prev pierced it (lower low), last closed
  // back above prev2's low with a strong body. For short: mirror image.
  if (direction === "long") {
    const swept = prev.low < prev2.low && prev.low < prev3.low;
    const reclaimed = last.close > prev2.low && last.close > last.open;
    const strongReclaim = body / Math.max(0.0001, range) > 0.5;
    if (swept && reclaimed && strongReclaim) {
      // Only flag as TRAP for our long if the reclaim happened on weak volume
      // (real reversals usually have strong volume confirmation).
      if (volumeRatio < 1.3) types.push("stop_hunt");
    }
  } else {
    const swept = prev.high > prev2.high && prev.high > prev3.high;
    const reclaimed = last.close < prev2.high && last.close < last.open;
    const strongReclaim = body / Math.max(0.0001, range) > 0.5;
    if (swept && reclaimed && strongReclaim) {
      if (volumeRatio < 1.3) types.push("stop_hunt");
    }
  }

  // 7) EXHAUSTION CLIMAX (V25) — parabolic blow-off into the trade direction.
  // Three consecutive same-direction candles, each with growing body, ending in
  // a wide-range candle with extreme volume. RSI also at extreme — likely top/bottom.
  const sameDir3 = (k: SniperKline) => direction === "long" ? k.close > k.open : k.close < k.open;
  const climbing = sameDir3(prev2) && sameDir3(prev) && sameDir3(last);
  const growingBodies = Math.abs(prev.close - prev.open) > prevBody * 0.9
    && body > prevBody * 1.1;
  const wideRange = range > 0 && range > lookbackRange / Math.max(1, lookback.length) * 1.6;
  const extremeVol = volumeRatio >= 2.5;
  const rsiExtreme = direction === "long"
    ? (rsi !== undefined && rsi >= 72)
    : (rsi !== undefined && rsi <= 28);
  if (climbing && growingBodies && wideRange && extremeVol && rsiExtreme) {
    types.push("exhaustion_climax");
  }

  // 8) DIVERGENCE TRAP (V25) — price made a fresh extreme but RSI didn't.
  // For long: price > recent high but RSI overbought (>70) and falling.
  // For short: price < recent low but RSI oversold (<30) and rising.
  if (rsi !== undefined && klines.length >= 14) {
    const closes = klines.map(k => k.close);
    if (direction === "long") {
      const newHigh = last.close >= recentHigh * 0.999;
      // crude divergence: prior swing high was made with similar/higher RSI
      // here we just flag "buying into overbought without room"
      if (newHigh && rsi >= 70 && closes[closes.length - 1] < closes[closes.length - 2]) {
        types.push("divergence_trap");
      }
    } else {
      const newLow = last.close <= recentLow * 1.001;
      if (newLow && rsi <= 30 && closes[closes.length - 1] > closes[closes.length - 2]) {
        types.push("divergence_trap");
      }
    }
  }

  // 9) ICEBERG ABSORPTION (V25) — heavy opposing volume absorbed without
  // matching price progress. Symptom of a hidden seller (for longs) or buyer
  // (for shorts) eating the orderflow. Detected via:
  //   - high volumeRatio (≥ 1.8)
  //   - candle body small relative to range (bodyPct < 0.35)
  //   - flow STRONGLY in our trade direction yet price barely moved
  if (flow && volumeRatio >= 1.8 && bodyPct < 0.35) {
    const total = flow.buyVol + flow.sellVol;
    const flowPct = total > 0 ? ((flow.buyVol - flow.sellVol) / total) * 100 : 0;
    const movedPct = lookbackMidPrice > 0 ? Math.abs(last.close - last.open) / lookbackMidPrice * 100 : 0;
    const inDirection = direction === "long" ? flowPct > 25 : flowPct < -25;
    if (inDirection && movedPct < 0.15) {
      types.push("iceberg_absorption");
    }
  }

  // 10) LOW-QUALITY PATTERN (V25) — pattern formed inside an extremely tight
  // dead range (lookback span < 0.6% of price). Such "patterns" rarely follow
  // through because there is no fuel/range to move into.
  const lookbackPct = lookbackMidPrice > 0 ? (lookbackRange / lookbackMidPrice) * 100 : 0;
  if (lookbackPct < 0.6) {
    types.push("low_quality_pattern");
  }

  // 11) ADVANCED LIQUIDITY SWEEP (V33 Phase 3) — engineered liquidity:
  // multiple equal-highs/lows got swept by the previous bar, current bar reverses.
  // Sensitivity 1=loose (5 bars req, 0.30% tol) … 5=very strict (2 bars req, 0.08% tol).
  if (klines.length >= 8) {
    const sens = Math.max(1, Math.min(5, getSweepSensitivity()));
    const tol = ({ 1: 0.0030, 2: 0.0022, 3: 0.0015, 4: 0.0011, 5: 0.0008 } as Record<number, number>)[sens];
    const requiredEqual = ({ 1: 5, 2: 3, 3: 2, 4: 2, 5: 2 } as Record<number, number>)[sens];
    const lastN = klines.slice(-10, -2);
    if (direction === "long") {
      const equalHighs = lastN.filter(k => Math.abs(k.high - recentHigh) / recentHigh < tol).length;
      const sweptThenFailed = prev.high > recentHigh * (1 + tol) && last.close < recentHigh;
      if (equalHighs >= requiredEqual && sweptThenFailed && !types.includes("liquidity_grab")) {
        types.push("liquidity_grab");
      }
    } else {
      const equalLows = lastN.filter(k => Math.abs(k.low - recentLow) / recentLow < tol).length;
      const sweptThenFailed = prev.low < recentLow * (1 - tol) && last.close > recentLow;
      if (equalLows >= requiredEqual && sweptThenFailed && !types.includes("liquidity_grab")) {
        types.push("liquidity_grab");
      }
    }
  }

  if (types.length === 0) return { detected: false, types: [], reason: "" };

  return {
    detected: true,
    types,
    reason: types.map(labelOf).join(" • "),
  };
}

// =================== Weighted Confluence Score ===================
export interface ScoreInput {
  direction: SniperDirection;
  regime: MarketRegime;
  thresholds: DynamicThresholds;
  weights: ScoreWeights;
  volumeRatio: number;
  whaleFlowPct: number;
  v17: MultiIndicatorVerdict;
  rsi: number;
  fng: SniperFearGreed | null;
  riskReward: number;
  patternPresent: boolean;
  supportBreakConfirmed: boolean;
  trap: TrapVerdict;
}

export function computeQualityScore(inp: ScoreInput): QualityScore {
  const { direction, regime, thresholds, weights, volumeRatio, whaleFlowPct, v17, rsi, fng, riskReward, patternPresent, supportBreakConfirmed, trap } = inp;

  // Whale (smart money)
  const whaleAligned = direction === "long" ? whaleFlowPct : -whaleFlowPct;
  const whale =
    whaleAligned >= 35 ? 100 :
      whaleAligned >= 25 ? 90 :
        whaleAligned >= 15 ? 75 :
          whaleAligned >= 5 ? 55 :
            whaleAligned >= 0 ? 35 : 10;

  // Volume
  const volume =
    volumeRatio >= 2.5 ? 100 :
      volumeRatio >= 2.0 ? 90 :
        volumeRatio >= 1.7 ? 75 :
          volumeRatio >= 1.5 ? 60 :
            volumeRatio >= 1.2 ? 40 : 20;

  // Trend (EMA)
  const trendAligned = v17.direction === direction;
  const trend = trendAligned
    ? Math.round(v17.reading.emaScore * 0.6 + v17.confidence * 0.4)
    : 25;

  // Tech (combined MACD + RSI)
  const rsiHealthy = direction === "long"
    ? (rsi >= 30 && rsi <= 65)
    : (rsi >= 35 && rsi <= 70);
  const rsi100 = rsiHealthy ? Math.round(v17.reading.rsiScore) : 30;
  const macd100 = trendAligned ? Math.round(v17.reading.macdScore) : 25;
  const tech = Math.round(rsi100 * 0.5 + macd100 * 0.5);

  // F&G
  let fngScore = 60;
  if (fng) {
    if (direction === "long") {
      fngScore = fng.value <= 30 ? 100 : fng.value <= 55 ? 85 : fng.value <= 75 ? 60 : 30;
    } else {
      fngScore = fng.value >= 70 ? 100 : fng.value >= 50 ? 85 : fng.value >= 35 ? 60 : 30;
    }
  }

  // Apply DYNAMIC weights (sums to 100)
  const total = Math.round(
    whale * (weights.whale / 100) +
    volume * (weights.volume / 100) +
    trend * (weights.trend / 100) +
    tech * (weights.tech / 100) +
    fngScore * (weights.fng / 100)
  );

  // V42+ — Improved target probability: weighted by actual quality + realistic R:R
  // R:R of 1.5 → +15, R:R of 2.0 → +20, capped at +35
  const rrBonus = Math.min(35, Math.round(riskReward * 12));
  const patternBonus = patternPresent ? 8 : 0;
  const targetProbability = Math.max(0, Math.min(99,
    Math.round(total * 0.65 + rrBonus + patternBonus + (trendAligned ? 8 : -5))
  ));

  // Momentum-confirmed path (signals without a candle pattern).
  // Tightened (V24-fix): higher consensus + full thresholds + R/R ≥ 1.7.
  // Disabled entirely in choppy/volatile regimes — pattern is mandatory there.
  const momentumRegimeAllowed = regime !== "choppy" && regime !== "volatile";
  const momentumConfirmed = momentumRegimeAllowed
    && v17.agreeingIndicators >= 8
    && v17.confidence >= 80
    && volumeRatio >= thresholds.minVolumeRatio
    && whaleAligned >= thresholds.minWhaleFlowAbsPct
    && riskReward >= 1.7;

  // ============ Quality Gate ============
  let passed = true;
  let rejectionReason: string | undefined;


  // V41-Pro (Harmonized):
  //   • HARD traps → 1+ trap = instant reject (previously needed 2+)
  //   • SOFT traps → 1+ trap (unless very strong override)
  //   • Strong override needs HIGHER bar now: 85% confidence + 7 agreeing + 2.0 R/R
  const HARD_TRAPS: TrapType[] = [
    "fake_breakout", "liquidity_grab", "volume_trap",
    "stop_hunt", "exhaustion_climax",
  ];
  const SOFT_TRAPS: TrapType[] = [
    "wick_rejection", "false_momentum", "divergence_trap", "low_quality_pattern", "iceberg_absorption",
  ];
  const hardTrapHits = trap.types.filter(t => HARD_TRAPS.includes(t));
  const softTrapHits = trap.types.filter(t => SOFT_TRAPS.includes(t));
  // Strong override needs HIGHER bar: CONSENSUS must be overwhelming
  const strongOverride =
    v17.confidence >= 85 && riskReward >= 2.0 && v17.agreeingIndicators >= 7;
  // 1+ hard trap = reject (much stricter)
  if (hardTrapHits.length >= 1 && !strongOverride) {
    passed = false;
    rejectionReason = `🪤 فخ صلب مكتشف: ${hardTrapHits.map(labelOf).join(" • ")}`;
  }
  // 1+ soft trap = reject (unless strong override)
  else if (softTrapHits.length >= 1 && !strongOverride) {
    passed = false;
    rejectionReason = `🪤 فخ ناعم مكتشف: ${softTrapHits.map(labelOf).join(" • ")}`;
  }
  else if (!patternPresent && !momentumConfirmed) { passed = false; rejectionReason = "بدون نموذج شمعي أو زخم مؤكد"; }
  else if ((regime === "choppy" || regime === "squeeze") && !momentumConfirmed) { passed = false; rejectionReason = regime === "squeeze" ? "سوق منضغط — انتظار الانفجار" : "السوق عشوائي/غير مستقر"; }
  else if (volumeRatio + 0.01 < thresholds.minVolumeRatio) { passed = false; rejectionReason = `فوليوم ضعيف (×${volumeRatio.toFixed(2)} < ×${thresholds.minVolumeRatio.toFixed(2)})`; }
  else if (Math.abs(whaleFlowPct) < thresholds.minWhaleFlowAbsPct || whaleAligned < 0) { passed = false; rejectionReason = "تدفق حيتان غير مؤكد"; }
  else if (!trendAligned) { passed = false; rejectionReason = "V17 لا يوافق الاتجاه"; }
  else if (v17.agreeingIndicators < thresholds.minAgreeingIndicators) { passed = false; rejectionReason = `توافق مؤشرات ضعيف (${v17.agreeingIndicators}/6)`; }
  else if (riskReward < thresholds.minRiskReward) { passed = false; rejectionReason = `R/R منخفض (${riskReward.toFixed(2)} < ${thresholds.minRiskReward.toFixed(2)})`; }
  else if (direction === "short" && !supportBreakConfirmed) { passed = false; rejectionReason = "بدون تأكيد كسر دعم"; }
  else if (total < thresholds.minConfidence) { passed = false; rejectionReason = `Quality Score منخفض (${total} < ${thresholds.minConfidence})`; }

  let grade: SignalGrade = "rejected";
  if (passed) grade = total >= 86 ? "A+" : total >= 56 ? "A" : "B";

  return {
    total, grade,
    components: { whale, volume, trend, tech, fng: fngScore },
    weights,
    passed, rejectionReason, targetProbability,
    trap,
  };
}
