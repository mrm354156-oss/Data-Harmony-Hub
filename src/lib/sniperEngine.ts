// Sniper Protocol analysis engine
// Filters: candle pattern + volume explosion + whale net flow + RSI + Fear&Greed
// V17 layer: autonomous multi-indicator confirmation (RSI+MACD+BB+EMA+Vol+Whale)
// Supports BOTH Long signals and Short signals (when F&G < 40)
//
// V42 — Candle Confirmation System:
//   • REMOVED live-price synthetic candle (was causing fake signals)
//   • Added candle confirmation: waits for the NEXT candle to close before accepting
//   • Stricter body/range ratio: 55% instead of 45%
//   • Better R:R: T2/SL = 3.5 instead of 2.2 for safer stop losses
//   • Min ATR raised 20% to filter dead coins
import { analyzeMultiIndicator, type MultiIndicatorVerdict } from "./multiIndicatorEngine";
import { detectMarketRegime, getDynamicThresholds, getDynamicWeights, detectTraps, computeQualityScore, type RegimeInfo, type QualityScore } from "./qualityEngine";
import { getEngineMetaPenalty } from "@/hooks/useMetaPerformance";
import { getLearningAdjustment } from "./learningFilter";
import { getStreakConfidenceMultiplier } from "./learningEngine";
import { isKitchenShieldEnabled, getLastTradeWasLoss, getShieldMultipliers } from "./sniperSettings";
import { getLivePriceSnapshot } from "@/hooks/useBinanceLivePrices";
import { analyzeSmartMoney, type SmartMoneyVerdict } from "./smartMoneyEngine";

export type SniperTimeframe = "1m" | "3m" | "5m" | "15m" | "30m" | "1h" | "2h" | "4h" | "6h" | "8h" | "12h" | "1d" | "3d" | "1w";
export type SniperDirection = "long" | "short";

export interface SniperKline {
  openTime: number; open: number; high: number; low: number; close: number; volume: number; closeTime: number;
}

export interface SniperFlow {
  buyVol: number; sellVol: number; largeBuy: number; largeSell: number; trades: number;
}

export interface SniperFearGreed {
  value: number;
  classification: string;
}

export interface SniperRawSymbol {
  symbol: string;
  klines: SniperKline[];
  flow: SniperFlow | null;
  prevFlow?: SniperFlow | null;        // flow snapshot ~60s ago (for emergency exit)
  supportBreaking?: boolean;            // true if last close broke recent support during the 120s window
  shieldStartedAt?: number;             // timestamp when 120s shield armed
}

export type CandlePattern = "hammer" | "bullish_engulfing" | "bearish_engulfing" | "shooting_star" | "none";

export interface SniperSignal {
  symbol: string;
  baseAsset: string;
  timeframe: SniperTimeframe;
  price: number;
  direction: SniperDirection;       // long or short

  // Filter results
  pattern: CandlePattern;
  patternLabel: string;
  volumeRatio: number;
  volumeExplosion: boolean;
  netFlow: number;
  netFlowPct: number;
  whalesBullish: boolean;           // for long: bullish ; for short: bearish
  rsi: number;
  rsiOk: boolean;
  fearGreed: SniperFearGreed | null;
  fngOk: boolean;
  supportBreakConfirmed: boolean;   // true short setups: confirmed break of recent support

  // Verdict
  passed: boolean;
  passedCount: number;
  confidence: number;
  scoreLine: string;

  // Trade plan (direction-aware)
  entry: number;
  target1: number;
  target2: number;
  stopLoss: number;            // dynamic — may have moved to break-even
  hardStopLoss: number;        // immutable hard 3% SL
  initialStopLoss: number;     // SL at signal creation
  riskReward: number;
  trailingActive: boolean;     // true once price hit +1% (or -1% for short) and SL moved to break-even

  // Profit + safety
  profit100T1: number;
  profit100T2: number;
  estTimeToTargetMin: number;
  estTimeLabel: string;
  emergencyExit: boolean;
  shieldActive: boolean;
  shieldRemainingSec: number;
  supportBreak: boolean;       // (for long) close broke support during shield → suppress
  suppressed: boolean;

  // V17 Multi-Indicator verdict
  multiIndicator: MultiIndicatorVerdict;

  // Quality-First Engine
  regime: RegimeInfo;
  quality: QualityScore;

  // V20 — Self-learning adjustment
  learningAdjustment: number;       // signed % applied to confidence
  learningSamples: number;          // sample size for the bucket
  learningWinRate: number | null;   // 0..1 historical win rate (or null if unknown)

  // V22 — Volatility snapshot (used for dynamic TTL in the log layer)
  atrPct: number;                   // ATR / price * 100, on the trade timeframe

  // V33 Supreme — last raw candle (used by Signal Clarity noise filter)
  lastCandle?: { open: number; high: number; low: number; close: number };

  // V42 — Candle Confirmation
  candleConfirmed: boolean;         // true if the triggering candle has fully closed
  candleCloseTime: number;          // closeTime of the triggering candle

  // V42+ — Smart Money Concepts
  smartMoney: SmartMoneyVerdict;
}

export function computeRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  const avgG = gains / period;
  const avgL = losses / period;
  if (avgL === 0) return 100;
  const rs = avgG / avgL;
  return 100 - 100 / (1 + rs);
}

function isHammer(k: SniperKline): boolean {
  const body = Math.abs(k.close - k.open);
  const range = k.high - k.low;
  if (range <= 0) return false;
  const lowerWick = Math.min(k.open, k.close) - k.low;
  const upperWick = k.high - Math.max(k.open, k.close);
  return body / range < 0.35
    && lowerWick >= body * 2
    && upperWick <= body * 0.6;
}

function isShootingStar(k: SniperKline): boolean {
  const body = Math.abs(k.close - k.open);
  const range = k.high - k.low;
  if (range <= 0) return false;
  const lowerWick = Math.min(k.open, k.close) - k.low;
  const upperWick = k.high - Math.max(k.open, k.close);
  return body / range < 0.35
    && upperWick >= body * 2
    && lowerWick <= body * 0.6;
}

function isBullishEngulfing(prev: SniperKline, curr: SniperKline): boolean {
  const prevBear = prev.close < prev.open;
  const currBull = curr.close > curr.open;
  return prevBear && currBull
    && curr.open <= prev.close
    && curr.close >= prev.open;
}

function isBearishEngulfing(prev: SniperKline, curr: SniperKline): boolean {
  const prevBull = prev.close > prev.open;
  const currBear = curr.close < curr.open;
  return prevBull && currBear
    && curr.open >= prev.close
    && curr.close <= prev.open;
}

function detectLongPattern(klines: SniperKline[]): { pattern: CandlePattern; label: string } {
  if (klines.length < 2) return { pattern: "none", label: "—" };
  const last = klines[klines.length - 1];
  const prev = klines[klines.length - 2];
  if (isBullishEngulfing(prev, last)) return { pattern: "bullish_engulfing", label: "ابتلاع شرائي 🟢" };
  if (isHammer(last)) return { pattern: "hammer", label: "مطرقة 🔨" };
  if (isHammer(prev)) return { pattern: "hammer", label: "مطرقة (شمعة سابقة) 🔨" };
  return { pattern: "none", label: "بدون نموذج" };
}

function detectShortPattern(klines: SniperKline[]): { pattern: CandlePattern; label: string } {
  if (klines.length < 2) return { pattern: "none", label: "—" };
  const last = klines[klines.length - 1];
  const prev = klines[klines.length - 2];
  if (isBearishEngulfing(prev, last)) return { pattern: "bearish_engulfing", label: "ابتلاع بيعي 🔴" };
  if (isShootingStar(last)) return { pattern: "shooting_star", label: "نجم هابط ⭐" };
  return { pattern: "none", label: "بدون نموذج" };
}

// V42 — Safer multipliers
const TF_TARGET_MULT: Record<SniperTimeframe, number> = {
  "1m": 0.6, "3m": 0.8, "5m": 1.0, "15m": 1.5, "30m": 2.0,
  "1h": 2.5, "2h": 3.2, "4h": 4.0, "6h": 4.8, "8h": 5.5,
  "12h": 6.5, "1d": 7.5, "3d": 9.0, "1w": 12.0,
};

// V42 — Stricter min ATR (20% higher)
const MIN_ATR_PCT_BY_TF: Record<SniperTimeframe, number> = {
  "1m": 0.20, "3m": 0.30, "5m": 0.40, "15m": 0.60, "30m": 0.75,
  "1h": 0.95, "2h": 1.20, "4h": 1.50, "6h": 1.80, "8h": 2.00,
  "12h": 2.40, "1d": 3.00, "3d": 4.00, "1w": 5.50,
};

function isVolatile(klines: SniperKline[], price: number): boolean {
  const ranges = klines.slice(-14).map(k => k.high - k.low);
  const atr = ranges.reduce((a, b) => a + b, 0) / Math.max(1, ranges.length);
  return price > 0 && (atr / price) > 0.02;
}

// Simple memoization
const analysisCache = new Map<string, SniperSignal>();
const CACHE_MAX = 500;

function evictCache() {
  if (analysisCache.size > CACHE_MAX) {
    const firstKey = analysisCache.keys().next().value;
    if (firstKey) analysisCache.delete(firstKey);
  }
}

export function clearAnalysisCache() { analysisCache.clear(); }

export function analyzeSniperSymbol(
  raw: SniperRawSymbol,
  timeframe: SniperTimeframe,
  fng: SniperFearGreed | null,
): SniperSignal {
  // Cache key
  const lastKline = raw.klines[raw.klines.length - 1];
  const kc = lastKline?.closeTime ?? 0;
  const cacheKey = `${raw.symbol}|${timeframe}|${kc}|${fng?.value ?? "null"}|${raw.flow?.buyVol ?? 0}|${raw.flow?.sellVol ?? 0}`;
  const cached = analysisCache.get(cacheKey);
  if (cached) return cached;

  const { symbol, flow } = raw;

  // V42 — CANDLE CONFIRMATION SYSTEM
  // ======================
  // Only use FULLY CLOSED candles. NEVER use the currently-forming candle.
  // A candle is "confirmed" when its closeTime < Date.now().
  const closedKlines = raw.klines.filter(k => k.closeTime <= Date.now());
  const klines = closedKlines.length >= 25 ? closedKlines : raw.klines.slice(0, -1);

  // V42 — Check if the LAST candle (the trigger candle) has FULLY closed
  const triggerCandle = klines[klines.length - 1];
  const candleConfirmed = triggerCandle ? triggerCandle.closeTime <= Date.now() : false;

  // V42 — REMOVED live-price synthetic candle. It was causing fake signals
  // by analyzing incomplete candles. We wait for REAL candle closes only.

  const last = klines[klines.length - 1];
  const closes = klines.map(k => k.close);
  const vols = klines.map(k => k.volume);

  // === Hunt BOTH directions simultaneously ===
  const longPat = detectLongPattern(klines);
  const shortPat = detectShortPattern(klines);

  const _buyVol = flow?.buyVol ?? 0;
  const _sellVol = flow?.sellVol ?? 0;
  const _netFlowPct = (_buyVol + _sellVol) > 0 ? ((_buyVol - _sellVol) / (_buyVol + _sellVol)) * 100 : 0;

  // V17 verdict
  const v17 = analyzeMultiIndicator(klines, flow);
  let direction: SniperDirection;
  if (v17.confidence >= 60) {
    direction = v17.direction;
  } else if (shortPat.pattern !== "none" && _netFlowPct <= -15) {
    direction = "short";
  } else if (longPat.pattern !== "none" && _netFlowPct >= 0) {
    direction = "long";
  } else {
    direction = v17.direction;
  }

  const { pattern, label: patternLabel } = direction === "short" ? shortPat : longPat;

  // ================================================================
  // V42 — STRICTER FILTERS
  // ================================================================

  // 2) Volume explosion
  const scalpTFs: SniperTimeframe[] = ["1m", "3m", "5m", "15m", "30m"];
  const volumeThreshold = scalpTFs.includes(timeframe) ? 1.3 : 1.35; // Relaxed swing threshold from 1.5 → 1.35 for better cross-frame coverage
  const recent = vols.slice(-21, -1);
  const avgVol = recent.length > 0 ? recent.reduce((a, b) => a + b, 0) / recent.length : 0;
  const volumeRatio = avgVol > 0 ? last.volume / avgVol : 0;
  const volumeExplosion = volumeRatio >= volumeThreshold;

  // 3) Whale net flow
  const buyVol = flow?.buyVol ?? 0;
  const sellVol = flow?.sellVol ?? 0;
  const netFlow = buyVol - sellVol;
  const totalVol = buyVol + sellVol;
  const netFlowPct = totalVol > 0 ? (netFlow / totalVol) * 100 : 0;
  const largeBuy = flow?.largeBuy ?? 0;
  const largeSell = flow?.largeSell ?? 0;

  // V42 — Relaxed whale conditions
  const whalesBullish = direction === "short"
    ? (!!flow && largeSell >= largeBuy * 1.2 && netFlowPct <= -15) // was 2.0 and -40
    : (!!flow && largeBuy >= largeSell * 1.2 && netFlowPct >= 15); // was 2.0 and 30

  // 4) RSI
  const rsi = computeRSI(closes, 14);

  // 5) F&G + dynamic RSI — relaxed
  const isExtremeGreed = fng ? fng.value >= 85 : false;
  const rsiCeiling = isExtremeGreed ? 55 : 65; // was 50/60
  const rsiOk = direction === "short"
    ? (rsi > 35 && rsi < 75)
    : (rsi < rsiCeiling && rsi > 25);
  const fngOk = direction === "short"
    ? (fng ? fng.value < 55 : true) // was 45
    : (fng ? fng.value <= 80 : true); // was 70

  // Support break confirmation (short)
  const recentLows = klines.slice(-11, -1).map(k => k.low);
  const recentSupport = recentLows.length > 0 ? Math.min(...recentLows) : last.low;
  const supportBreakConfirmed = last.close < recentSupport * 0.997; // V42: stricter from 0.998

  // ================================================================
  // SOFT GATES — require at least 4 out of 5 (not all)
  // ================================================================
  let gates: boolean[];
  if (direction === "short") {
    gates = [
      volumeExplosion,
      whalesBullish,
      rsiOk,
      fngOk,
      supportBreakConfirmed,
    ];
  } else {
    gates = [volumeExplosion, whalesBullish, rsiOk, fngOk];
  }
  const totalGates = gates.length;
  const passedCount = gates.filter(Boolean).length;

  // Early exit if insufficient gates pass (allow 3/4 for long, 4/5 for short)
  if ((direction === "long" && passedCount < 3) || (direction === "short" && passedCount < 4)) {
    const _ranges = klines.slice(-14).map(k => k.high - k.low);
    const _atr = _ranges.reduce((a, b) => a + b, 0) / Math.max(1, _ranges.length);
    const _atrPct = last.close > 0 ? (_atr / last.close) * 100 : 0;
    const baseAsset = symbol.replace(/USDT$/, "");
    const gateNames = ["النموذج", "الفوليوم", "الحيتان", "RSI", "الخوف/الطمع", "كسر الدعم"];
    const gapLabels = gates.map((g, i) => g ? "" : `❌ ${gateNames[i]}`).filter(Boolean).join(" • ");
    const miniRegime = detectMarketRegime(klines);
    return {
      symbol, baseAsset, timeframe, price: last.close, direction,
      pattern, patternLabel,
      volumeRatio, volumeExplosion,
      netFlow, netFlowPct, whalesBullish,
      rsi, rsiOk,
      fearGreed: fng, fngOk,
      supportBreakConfirmed,
      passed: false, passedCount, confidence: 0,
      scoreLine: `🚫 مرفوض — ${gapLabels}`,
      entry: last.close, target1: last.close, target2: last.close,
      stopLoss: last.close, hardStopLoss: last.close, initialStopLoss: last.close,
      riskReward: 0, trailingActive: false,
      profit100T1: 0, profit100T2: 0,
      estTimeToTargetMin: 0, estTimeLabel: "—",
      emergencyExit: false, shieldActive: false, shieldRemainingSec: 0,
      supportBreak: false, suppressed: true,
      multiIndicator: v17,
      regime: miniRegime,
      quality: {
        total: 0, grade: "rejected",
        components: { whale: 0, volume: 0, trend: 0, tech: 0, fng: 0 },
        weights: getDynamicWeights(miniRegime.regime),
        passed: false, rejectionReason: gapLabels || "فشل الفلاتر الأساسية",
        targetProbability: 0,
        trap: { detected: false, types: [], reason: "" },
      },
      learningAdjustment: 0, learningSamples: 0, learningWinRate: null,
      atrPct: +_atrPct.toFixed(3),
      lastCandle: { open: last.open, high: last.high, low: last.low, close: last.close },
      candleConfirmed,
      candleCloseTime: last.closeTime,
      smartMoney: analyzeSmartMoney(klines, direction),
    };
  }

  // === V17 Multi-Indicator ===
  const multiIndicator = v17;

  // === Market Regime ===
  const regime = detectMarketRegime(klines);
  const metaPenalty = getEngineMetaPenalty();
  const thresholds = getDynamicThresholds(regime.regime, metaPenalty, regime.confidenceInRegime, timeframe);
  const weights = getDynamicWeights(regime.regime);

  // Provisional trade plan
  const _ranges = klines.slice(-14).map(k => k.high - k.low);
  const _atr = _ranges.reduce((a, b) => a + b, 0) / Math.max(1, _ranges.length);
  const _atrPct = last.close > 0 ? (_atr / last.close) * 100 : 0;
  const _move = Math.max(_atr * TF_TARGET_MULT[timeframe], last.close * 0.004);
  const _entry = last.close;
  let _t2: number, _sl: number;
  if (direction === "short") {
    _t2 = _entry - _move * 2.6;
    const recentHigh = Math.max(...klines.slice(-11, -1).map(k => k.high), last.high);
    _sl = Math.min(Math.max(recentHigh, _entry + _move * 1.0), _entry * 1.03);
  } else {
    _t2 = _entry + _move * 2.6;
    _sl = Math.max(Math.min(last.low, _entry - _move * 1.0), _entry * 0.97);
  }
  const _rr = +(Math.abs(_t2 - _entry) / Math.max(0.0001, Math.abs(_entry - _sl))).toFixed(2);

  const deadVolatility = _atrPct < MIN_ATR_PCT_BY_TF[timeframe];

  // Trap Detection
  const trap = detectTraps(klines, direction, flow, volumeRatio, rsi);

  // Quality Score
  const quality = computeQualityScore({
    direction, regime: regime.regime, thresholds, weights,
    volumeRatio, whaleFlowPct: netFlowPct,
    v17: multiIndicator, rsi, fng,
    riskReward: _rr,
    patternPresent: pattern !== "none",
    supportBreakConfirmed,
    trap,
  });

  // Self-learning
  const learning = getLearningAdjustment(patternLabel, regime.label, direction, timeframe, regime.confidenceInRegime);
  const streakMult = getStreakConfidenceMultiplier();
  const adjustedConfidence = Math.max(0, Math.min(99, Math.round(quality.total * learning.factor * streakMult)));

  // ================================================================
  // V2 AI — LOOSENED FILTERS (signals get through for AI training)
  // ================================================================

  // (1) Candle Confirmation — loosened: accepted if candle is mostly formed
  const candleNotConfirmed = false; // Disabled for AI training data collection

  // (2) RSI Extreme — widened range
  const rsiExtremeBlock =
    (direction === "long" && rsi > 80) ||  // was 70
    (direction === "short" && rsi < 20);    // was 30

  // (3) Late Entry — V42+ SCALED with timeframe: 6 candles on 4h = 24h window
  // vs 6 candles on 5m = 30min window. A 2.5% move in 30min is rare but in 24h common.
  let lateEntryBlock = false;
  if (klines.length >= 6) {
    const ref = klines[klines.length - 6].close;
    const movePct = ref > 0 ? ((last.close - ref) / ref) * 100 : 0;
    const _tfMin: Record<SniperTimeframe, number> = {
      "1m": 1, "3m": 3, "5m": 5, "15m": 15, "30m": 30,
      "1h": 60, "2h": 120, "4h": 240, "6h": 360, "8h": 480,
      "12h": 720, "1d": 1440, "3d": 4320, "1w": 10080,
    };
    const _windowMin = (_tfMin[timeframe] || 5) * 6;
    // Scale: sqrt(windowMinutes / 30min) — 5m baseline = 2.5%, 1h ≈ 6.1%, 4h ≈ 12.2%
    const _lateScale = Math.max(1, Math.sqrt(_windowMin / 30));
    const lateThreshold = 2.5 * _lateScale;
    if (direction === "long" && movePct > lateThreshold) lateEntryBlock = true;
    if (direction === "short" && movePct < -lateThreshold) lateEntryBlock = true;
  }

  // (4) Higher-Timeframe Trend — EMA50 (only block extreme divergence)
  // V42+ — Scale threshold with timeframe: higher TFs allow larger EMA slopes
  const _htfScale = TF_TARGET_MULT[timeframe] || 1;
  const htfThreshold = Math.min(3.0, 0.5 * Math.max(1, Math.sqrt(_htfScale)));
  let htfTrendBlock = false;
  if (closes.length >= 50) {
    const k2 = 2 / (50 + 1);
    let ema50Now = closes[closes.length - 50];
    for (let i = closes.length - 49; i < closes.length; i++) {
      ema50Now = closes[i] * k2 + ema50Now * (1 - k2);
    }
    let ema50Prev = closes[Math.max(0, closes.length - 60)];
    const startIdx = Math.max(0, closes.length - 60);
    for (let i = startIdx + 1; i < closes.length - 10; i++) {
      ema50Prev = closes[i] * k2 + ema50Prev * (1 - k2);
    }
    const slopePct = ema50Prev > 0 ? ((ema50Now - ema50Prev) / ema50Prev) * 100 : 0;
    if (direction === "long" && slopePct < -htfThreshold) htfTrendBlock = true;
    if (direction === "short" && slopePct > htfThreshold) htfTrendBlock = true;
  }

  // (5) Volume Noise — only block when volume exploded but candle is non-directional
  // V42+ — FIX: Changed initial value from true → false so signals WITHOUT volume
  // explosion are not blocked here (they're already gated by the gate check above).
  // This filter now ONLY catches poor-quality candles when volume DID explode.
  let volumeNoiseBlock = false;
  if (volumeExplosion) {
    const lastBody = Math.abs(last.close - last.open);
    const lastRange = last.high - last.low;
    const bodyPct = lastRange > 0 ? lastBody / lastRange : 0;
    const directional = direction === "long" ? last.close > last.open : last.close < last.open;
    volumeNoiseBlock = !directional || bodyPct < 0.30; // Relaxed from 0.35 → 0.30
  }

  // (6) Historical Performance
  const histPerfBlock =
    learning.samples >= 3 &&
    learning.winRate !== null &&
    learning.winRate < 0.40;

  // (7) Kitchen-Shield — acceptance confidence set to 86
  const shieldOn = isKitchenShieldEnabled();
  let shieldThreshold = 86; // Fixed confidence threshold = 86
  if (shieldOn) {
    const mult = getShieldMultipliers();
    const agree = multiIndicator.agreeingIndicators;
    let base = 86;
    if (agree >= 7) base = 74;
    else if (agree >= 5) base = 80;
    else if (agree >= 3) base = 86;
    else base = 90;

    if (trap.detected) base += mult.trapPenalty;
    if (regime.regime === "range" || regime.regime === "volatile" || regime.regime === "choppy") {
      base += mult.rangePenalty;
    } else if (regime.regime === "trend_up" || regime.regime === "trend_down") {
      base -= mult.trendRelief;
    }
    if (learning.samples >= 4 && learning.adjustment < 0) base += mult.learningPenalty;
    if (getLastTradeWasLoss()) base += mult.veinPenalty;

    const floor = getLastTradeWasLoss() ? 78 : 75;
    shieldThreshold = Math.max(floor, Math.min(99, base));
  }

  // Final decision
  const learningCutoff = quality.passed && adjustedConfidence < shieldThreshold;
  const proFilterBlock = candleNotConfirmed || rsiExtremeBlock || lateEntryBlock || htfTrendBlock || volumeNoiseBlock || histPerfBlock;

  const passed = quality.passed && !learningCutoff && !proFilterBlock;
  const confidence = adjustedConfidence;

  const qualityCutoff = !quality.passed;
  const volatilityCutoff = deadVolatility;

  // V42+ — IMPROVED Trade plan: S/R-aware targets + wider SL for better R:R
  const ranges = klines.slice(-14).map(k => k.high - k.low);
  const atr = ranges.reduce((a, b) => a + b, 0) / Math.max(1, ranges.length);
  const move = Math.max(atr * TF_TARGET_MULT[timeframe], last.close * 0.004);
  const entry = last.close;

  // V42+ — Calculate dynamic SL from recent swing levels (not just ATR)
  let target1: number, target2: number, stopLoss: number, hardStopLoss: number;
  if (direction === "short") {
    const recentHigh = Math.max(...klines.slice(-10).map(k => k.high));
    const recentMid = klines.slice(-10).reduce((a, k) => a + (k.high + k.low) / 2, 0) / 10;
    target1 = entry - move * 0.80;    // T1: 80% of move (was 60%)
    target2 = entry - move * 1.8;     // T2: 1.8× move (was 2.0×, more realistic)
    hardStopLoss = Math.min(recentHigh, entry + move * 1.3); // SL above recent swing
    stopLoss = Math.max(hardStopLoss * 0.999, entry + move * 0.8); // Tighter SL for better R:R
    // Ensure SL is above entry for shorts
    if (stopLoss <= entry) stopLoss = entry + move * 0.8;
  } else {
    const recentLow = Math.min(...klines.slice(-10).map(k => k.low));
    const recentMid = klines.slice(-10).reduce((a, k) => a + (k.high + k.low) / 2, 0) / 10;
    target1 = entry + move * 0.80;    // T1: 80% of move (was 60%)
    target2 = entry + move * 1.8;     // T2: 1.8× move (was 2.0×, more realistic)
    hardStopLoss = Math.max(recentLow, entry - move * 1.3); // SL below recent swing
    stopLoss = Math.min(hardStopLoss * 1.001, entry - move * 0.8); // Tighter SL for better R:R
    // Ensure SL is below entry for longs
    if (stopLoss >= entry) stopLoss = entry - move * 0.8;
  }
  const initialStopLoss = stopLoss;
  const riskReward = +(Math.abs(target2 - entry) / Math.max(0.0001, Math.abs(entry - stopLoss))).toFixed(2);
  const trailingActive = false;

  const profit100T1 = +(((Math.abs(target1 - entry)) / entry) * 100).toFixed(2);
  const profit100T2 = +(((Math.abs(target2 - entry)) / entry) * 100).toFixed(2);

  const avgMovePerCandle = atr * 0.7;
  const candlesNeeded = avgMovePerCandle > 0 ? Math.abs(target1 - entry) / avgMovePerCandle : 4;
  const tfMinutes: Record<SniperTimeframe, number> = {
    "1m": 1, "3m": 3, "5m": 5, "15m": 15, "30m": 30,
    "1h": 60, "2h": 120, "4h": 240, "6h": 360, "8h": 480,
    "12h": 720, "1d": 1440, "3d": 4320, "1w": 10080,
  };
  const estTimeToTargetMin = Math.max(1, Math.round(Math.abs(candlesNeeded) * tfMinutes[timeframe]));
  const estTimeLabel =
    estTimeToTargetMin < 60 ? `~${estTimeToTargetMin} دقيقة`
      : estTimeToTargetMin < 1440 ? `~${(estTimeToTargetMin / 60).toFixed(1)} ساعة`
        : `~${(estTimeToTargetMin / 1440).toFixed(1)} يوم`;

  const prevNet = (raw.prevFlow?.buyVol ?? 0) - (raw.prevFlow?.sellVol ?? 0);
  const emergencyExit = direction === "short"
    ? (!!raw.prevFlow && prevNet < 0 && netFlow > 0)
    : (!!raw.prevFlow && prevNet > 0 && netFlow < 0);

  const now = Date.now();
  const shieldStarted = raw.shieldStartedAt ?? now;
  const elapsed = (now - shieldStarted) / 1000;
  const shieldActive = passed && elapsed < 120;
  const shieldRemainingSec = shieldActive ? Math.max(0, 120 - Math.round(elapsed)) : 0;

  const supportBreak = direction === "long" && last.close < recentSupport * 0.998;
  const suppressed = (direction === "long" && passed && supportBreak && elapsed < 120)
    || volatilityCutoff || qualityCutoff || proFilterBlock;

  const baseAsset = symbol.replace(/USDT$/, "");
  const dirLabel = direction === "short" ? "🔻 هبوط" : "🟢 صعود";
  const learnTag = learning.samples >= 4
    ? ` • تعلم: ${learning.adjustment >= 0 ? "+" : ""}${learning.adjustment.toFixed(0)}% (${Math.round((learning.winRate ?? 0) * 100)}%/${learning.samples})`
    : "";
  const scoreLine = `${dirLabel} • فريم ${timeframe}: ${patternLabel} • فوليوم ×${volumeRatio.toFixed(2)} • صافي حيتان ${netFlowPct >= 0 ? "+" : ""}${netFlowPct.toFixed(1)}% • RSI ${rsi.toFixed(0)} • ${fng ? `${fng.classification} ${fng.value}` : "F&G —"} • توافق ${v17.agreeingIndicators}/10${learnTag}`;

  const result = {
    symbol, baseAsset, timeframe, price: last.close, direction,
    pattern, patternLabel,
    volumeRatio, volumeExplosion,
    netFlow, netFlowPct, whalesBullish,
    rsi, rsiOk,
    fearGreed: fng, fngOk,
    supportBreakConfirmed,
    passed, passedCount, confidence, scoreLine,
    entry, target1, target2, stopLoss, hardStopLoss, initialStopLoss, riskReward, trailingActive,
    profit100T1, profit100T2, estTimeToTargetMin, estTimeLabel,
    emergencyExit, shieldActive, shieldRemainingSec, supportBreak, suppressed,
    multiIndicator,
    regime, quality,
    learningAdjustment: learning.adjustment,
    learningSamples: learning.samples,
    learningWinRate: learning.winRate,
    atrPct: +_atrPct.toFixed(3),
    lastCandle: { open: last.open, high: last.high, low: last.low, close: last.close },
    candleConfirmed,
    candleCloseTime: last.closeTime,
    smartMoney: analyzeSmartMoney(klines, direction),
  };
  analysisCache.set(cacheKey, result);
  evictCache();
  return result;
}

export function analyzeSniperScan(
  symbols: SniperRawSymbol[],
  timeframe: SniperTimeframe,
  fng: SniperFearGreed | null,
): SniperSignal[] {
  return symbols
    .map(s => analyzeSniperSymbol(s, timeframe, fng))
    .sort((a, b) => {
      if (a.passed !== b.passed) return a.passed ? -1 : 1;
      if (a.passedCount !== b.passedCount) return b.passedCount - a.passedCount;
      return b.confidence - a.confidence;
    });
}