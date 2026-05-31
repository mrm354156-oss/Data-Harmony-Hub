// Sniper-Bot V17 — Autonomous Multi-Indicator Analyst
// Reads RSI + MACD + Bollinger + EMA cross + Volume Energy + Whale Flow,
// then computes a self-weighted confidence score and direction.
// Used as an additional confirmation layer over the main sniper engine.

import type { SniperKline, SniperFlow } from "./sniperEngine";
import { computeRSI } from "./sniperEngine";

export interface IndicatorReading {
  rsi: number;                  // 0-100
  rsiScore: number;             // 0-100 (how favorable for direction)
  macdHist: number;             // raw histogram value
  macdScore: number;            // 0-100
  bbPosition: number;           // 0=lower band, 1=upper band
  bbScore: number;              // 0-100 (extremes favored)
  emaCrossBull: boolean;        // EMA9 > EMA21
  emaScore: number;             // 0-100
  volumeRatio: number;
  volumeScore: number;          // 0-100
  whaleFlowPct: number;         // -100 .. +100
  whaleScore: number;           // 0-100
  stochK: number;               // 0-100 Stochastic %K
  stochScore: number;           // 0-100 (favorable for direction)
  obvSlope: number;             // -1..+1 normalized OBV slope sign/strength
  obvScore: number;             // 0-100
  vwapDistPct: number;          // (price-vwap)/vwap * 100
  vwapScore: number;            // 0-100
  atrPct: number;               // ATR / price * 100
  atrScore: number;             // 0-100 (favors healthy volatility band)
}

export interface MultiIndicatorVerdict {
  reading: IndicatorReading;
  direction: "long" | "short";
  confidence: number;           // 0-100, weighted
  agreeingIndicators: number;   // out of 10 (V20)
  reasonLine: string;
}

function ema(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const out: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    out.push(values[i] * k + out[i - 1] * (1 - k));
  }
  return out;
}

function macdHistogram(closes: number[]): number {
  if (closes.length < 35) return 0;
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macdLine: number[] = ema12.map((v, i) => v - ema26[i]).slice(-20);
  const signal = ema(macdLine, 9);
  const last = macdLine[macdLine.length - 1] - signal[signal.length - 1];
  return last;
}

function bollingerPosition(closes: number[], period = 20): number {
  if (closes.length < period) return 0.5;
  const slice = closes.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
  const std = Math.sqrt(variance);
  const upper = mean + 2 * std;
  const lower = mean - 2 * std;
  const last = closes[closes.length - 1];
  if (upper === lower) return 0.5;
  return Math.max(0, Math.min(1, (last - lower) / (upper - lower)));
}

function stochasticK(klines: SniperKline[], period = 14): number {
  if (klines.length < period) return 50;
  const slice = klines.slice(-period);
  const highest = Math.max(...slice.map(k => k.high));
  const lowest = Math.min(...slice.map(k => k.low));
  const last = slice[slice.length - 1].close;
  if (highest === lowest) return 50;
  return ((last - lowest) / (highest - lowest)) * 100;
}

function obvSlope(klines: SniperKline[], period = 14): number {
  if (klines.length < period + 1) return 0;
  const obv: number[] = [0];
  for (let i = 1; i < klines.length; i++) {
    const prev = klines[i - 1].close, curr = klines[i].close;
    const v = klines[i].volume;
    const last = obv[obv.length - 1];
    if (curr > prev) obv.push(last + v);
    else if (curr < prev) obv.push(last - v);
    else obv.push(last);
  }
  const slice = obv.slice(-period);
  const n = slice.length;
  const xMean = (n - 1) / 2;
  const yMean = slice.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (slice[i] - yMean);
    den += (i - xMean) ** 2;
  }
  const slope = den > 0 ? num / den : 0;
  const avgAbs = slice.reduce((a, b) => a + Math.abs(b), 0) / n || 1;
  return Math.max(-1, Math.min(1, slope / (avgAbs * 0.05 + 1)));
}

function vwap(klines: SniperKline[], period = 20): number {
  const slice = klines.slice(-period);
  let pv = 0, v = 0;
  for (const k of slice) {
    const tp = (k.high + k.low + k.close) / 3;
    pv += tp * k.volume;
    v += k.volume;
  }
  return v > 0 ? pv / v : slice[slice.length - 1].close;
}

function atrPct(klines: SniperKline[], period = 14): number {
  const slice = klines.slice(-period);
  if (slice.length === 0) return 0;
  const ranges = slice.map(k => k.high - k.low);
  const atr = ranges.reduce((a, b) => a + b, 0) / slice.length;
  const last = slice[slice.length - 1].close;
  return last > 0 ? (atr / last) * 100 : 0;
}

/**
 * V20 — Multi-Indicator Analyst (Harmonized Edition)
 * Weights (sum=100): Volume 25, Whale 25, MACD 14, RSI 12, EMA 10, BB 5,
 *                    Stoch 5, OBV 5, VWAP 3, ATR 1
 * 
 * التعديلات:
 * - وزن الفوليوم والحيتان زاد (الأهمية القصوى)
 * - عتبات التسجيل تشددت (مش مجرد إشارة ضعيفة تمر)
 * - الأغلبية المطلوبة للاتجاه صارت 5/8 بدل 4/8
 */
export function analyzeMultiIndicator(
  klines: SniperKline[],
  flow: SniperFlow | null,
): MultiIndicatorVerdict {
  const closes = klines.map(k => k.close);
  const vols = klines.map(k => k.volume);
  const last = klines[klines.length - 1];

  // === Raw indicator values ===
  const rsi = computeRSI(closes, 14);
  const macdHist = macdHistogram(closes);
  const bbPos = bollingerPosition(closes, 20);

  const ema9Arr = ema(closes, 9);
  const ema21Arr = ema(closes, 21);
  const ema9 = ema9Arr[ema9Arr.length - 1];
  const ema21 = ema21Arr[ema21Arr.length - 1];
  const emaCrossBull = ema9 > ema21;

  const recentVols = vols.slice(-21, -1);
  const avgVol = recentVols.length > 0 ? recentVols.reduce((a, b) => a + b, 0) / recentVols.length : 0;
  const volumeRatio = avgVol > 0 ? last.volume / avgVol : 0;

  const buyVol = flow?.buyVol ?? 0;
  const sellVol = flow?.sellVol ?? 0;
  const totalVol = buyVol + sellVol;
  const whaleFlowPct = totalVol > 0 ? ((buyVol - sellVol) / totalVol) * 100 : 0;

  const stochK = stochasticK(klines, 14);
  const obvSlp = obvSlope(klines, 14);
  const vwapVal = vwap(klines, 20);
  const vwapDistPct = vwapVal > 0 ? ((last.close - vwapVal) / vwapVal) * 100 : 0;
  const atrP = atrPct(klines, 14);

  // === Direction by majority vote (needs 5/8 for consensus) ===
  const bullVotes =
    (rsi > 55 ? 1 : 0) +
    (macdHist > 0 ? 1 : 0) +
    (emaCrossBull ? 1 : 0) +
    (whaleFlowPct > 5 ? 1 : 0) +
    (bbPos < 0.4 ? 1 : 0) +
    (stochK < 40 ? 1 : stochK > 60 ? 0 : 0.3) +
    (obvSlp > 0.05 ? 1 : 0) +
    (vwapDistPct > 0.1 ? 1 : 0);
  const direction: "long" | "short" = bullVotes >= 5 ? "long" : "short";

  // === Score each indicator 0-100 (Harmonized) ===
  const rsiScore = direction === "long"
    ? (rsi >= 35 && rsi <= 60 ? 100 - Math.abs(50 - rsi) * 1.5 : 25)
    : (rsi >= 40 && rsi <= 65 ? 100 - Math.abs(55 - rsi) * 1.5 : 25);

  const macdScore = direction === "long"
    ? (macdHist > 0 ? Math.min(100, 70 + macdHist * 1500) : 20)
    : (macdHist < 0 ? Math.min(100, 70 + Math.abs(macdHist) * 1500) : 20);

  const bbScore = direction === "long"
    ? (bbPos < 0.25 ? 100 : bbPos < 0.45 ? 80 : 35)
    : (bbPos > 0.75 ? 100 : bbPos > 0.55 ? 80 : 35);

  const emaScore = direction === "long"
    ? (emaCrossBull ? 100 : 25)
    : (!emaCrossBull ? 100 : 25);

  const volumeScore = volumeRatio >= 2.5 ? 100
    : volumeRatio >= 1.8 ? 85
      : volumeRatio >= 1.5 ? 70
        : volumeRatio >= 1.2 ? 50
          : 20;

  const whaleScore = direction === "long"
    ? (whaleFlowPct > 35 ? 100 : whaleFlowPct > 20 ? 80 : whaleFlowPct > 5 ? 55 : 20)
    : (whaleFlowPct < -35 ? 100 : whaleFlowPct < -20 ? 80 : whaleFlowPct < -5 ? 55 : 20);

  const stochScore = direction === "long"
    ? (stochK < 20 ? 100 : stochK < 40 ? 80 : stochK < 60 ? 50 : stochK < 80 ? 30 : 10)
    : (stochK > 80 ? 100 : stochK > 60 ? 80 : stochK > 40 ? 50 : stochK > 20 ? 30 : 10);

  const obvScore = direction === "long"
    ? (obvSlp > 0.4 ? 100 : obvSlp > 0.15 ? 80 : obvSlp > 0 ? 55 : 20)
    : (obvSlp < -0.4 ? 100 : obvSlp < -0.15 ? 80 : obvSlp < 0 ? 55 : 20);

  const vwapScore = direction === "long"
    ? (vwapDistPct > 0.5 ? 100 : vwapDistPct > 0.15 ? 75 : vwapDistPct > -0.5 ? 40 : 15)
    : (vwapDistPct < -0.5 ? 100 : vwapDistPct < -0.15 ? 75 : vwapDistPct < 0.5 ? 40 : 15);

  const atrScore = atrP < 0.3 ? 15
    : atrP < 0.5 ? 45
      : atrP <= 1.5 ? 100
        : atrP <= 3 ? 70
          : atrP <= 5 ? 45 : 20;

  // === Weighted confidence (Harmonized — Volume + Whale = 50% of total) ===
  // RSI & MACD got a boost; minor indicators (BB, Stoch, OBV, VWAP, ATR) reduced
  const confidence = Math.round(
    volumeScore * 0.25 +
    whaleScore * 0.25 +
    macdScore * 0.14 +
    rsiScore * 0.12 +
    emaScore * 0.10 +
    bbScore * 0.05 +
    stochScore * 0.05 +
    obvScore * 0.05 +
    vwapScore * 0.03 +
    atrScore * 0.01
  );

  // Agreeing indicators: score >= 65 (was 60) = counting
  const agreeingIndicators =
    (rsiScore >= 65 ? 1 : 0) +
    (macdScore >= 65 ? 1 : 0) +
    (bbScore >= 65 ? 1 : 0) +
    (emaScore >= 65 ? 1 : 0) +
    (volumeScore >= 65 ? 1 : 0) +
    (whaleScore >= 65 ? 1 : 0) +
    (stochScore >= 65 ? 1 : 0) +
    (obvScore >= 65 ? 1 : 0) +
    (vwapScore >= 65 ? 1 : 0) +
    (atrScore >= 65 ? 1 : 0);

  const reading: IndicatorReading = {
    rsi, rsiScore: Math.round(rsiScore),
    macdHist, macdScore: Math.round(macdScore),
    bbPosition: bbPos, bbScore: Math.round(bbScore),
    emaCrossBull, emaScore: Math.round(emaScore),
    volumeRatio, volumeScore: Math.round(volumeScore),
    whaleFlowPct, whaleScore: Math.round(whaleScore),
    stochK, stochScore: Math.round(stochScore),
    obvSlope: obvSlp, obvScore: Math.round(obvScore),
    vwapDistPct, vwapScore: Math.round(vwapScore),
    atrPct: atrP, atrScore: Math.round(atrScore),
  };

  const reasonLine = `تناغم: توافق ${agreeingIndicators}/10 مؤشرات • RSI ${rsi.toFixed(0)} • MACD ${macdHist > 0 ? "صاعد" : "هابط"} • فوليوم ×${volumeRatio.toFixed(2)} • حيتان ${whaleFlowPct >= 0 ? "+" : ""}${whaleFlowPct.toFixed(1)}% • Stoch ${stochK.toFixed(0)} • OBV ${obvSlp > 0 ? "صاعد" : "هابط"} • VWAP ${vwapDistPct >= 0 ? "+" : ""}${vwapDistPct.toFixed(2)}%`;

  return { reading, direction, confidence, agreeingIndicators, reasonLine };
}