// V2 AI — Feature Extractor
// Converts raw klines + flow data into ML-ready feature vectors
// Used by XGBoost, LSTM, Bayesian Optimizer, and RL Agent

import type { SniperKline, SniperFlow } from "@/lib/sniperEngine";
import type { ExtractedFeatures } from "@/ai/types";

// ─── Technical Indicators (computed on-the-fly) ────────────────────────────

function computeRSI(closes: number[], period = 14): number {
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

function computeEMA(prices: number[], period: number): number {
    if (prices.length < period) return prices[prices.length - 1];
    const k = 2 / (period + 1);
    let ema = prices[prices.length - period];
    for (let i = prices.length - period + 1; i < prices.length; i++) {
        ema = prices[i] * k + ema * (1 - k);
    }
    return ema;
}

function computeMACD(closes: number[]): { hist: number; signal: number } {
    const ema12 = computeEMA(closes, 12);
    const ema26 = computeEMA(closes, 26);
    const macdLine = ema12 - ema26;

    // Signal line (EMA of MACD line over 9 periods)
    const macdValues: number[] = [];
    for (let i = Math.max(0, closes.length - 34); i < closes.length; i++) {
        const e12 = computeEMA(closes.slice(0, i + 1), 12);
        const e26 = computeEMA(closes.slice(0, i + 1), 26);
        macdValues.push(e12 - e26);
    }
    const signal = macdValues.length >= 9
        ? computeEMA(macdValues, 9)
        : macdLine;

    return { hist: macdLine - signal, signal };
}

function computeBB(closes: number[], period = 20): { position: number; width: number } {
    if (closes.length < period) return { position: 0.5, width: 0 };
    const recent = closes.slice(-period);
    const mean = recent.reduce((a, b) => a + b, 0) / period;
    const variance = recent.reduce((s, v) => s + (v - mean) ** 2, 0) / period;
    const std = Math.sqrt(variance);
    const upper = mean + 2 * std;
    const lower = mean - 2 * std;
    const last = closes[closes.length - 1];
    const position = upper !== lower ? (last - lower) / (upper - lower) : 0.5;
    return { position, width: std > 0 ? (upper - lower) / mean : 0 };
}

function computeVolatility(klines: SniperKline[], period = 14): number {
    const ranges = klines.slice(-period).map(k => k.high - k.low);
    if (ranges.length === 0) return 0;
    return ranges.reduce((a, b) => a + b, 0) / ranges.length;
}

// ─── Main Feature Extractor ────────────────────────────────────────────────

export function extractFeatures(
    klines: SniperKline[],
    flow: SniperFlow | null,
    regime: string,
    regimeConfidence: number,
): ExtractedFeatures | null {
    if (klines.length < 25) return null;

    const closes = klines.map(k => k.close);
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    const volumes = klines.map(k => k.volume);

    const last = klines[klines.length - 1];
    const prev = klines[klines.length - 2];
    const price = last.close;

    // Technical Indicators
    const rsi = computeRSI(closes);
    const macd = computeMACD(closes);
    const bb = computeBB(closes);

    const emaShort = computeEMA(closes, 9);
    const emaMedium = computeEMA(closes, 21);
    const emaLong = computeEMA(closes, 50);

    // Volume Analysis
    const recentVol = volumes.slice(-21, -1);
    const volumeMA = recentVol.length > 0
        ? recentVol.reduce((a, b) => a + b, 0) / recentVol.length
        : 0;
    const volumeRatio = volumeMA > 0 ? last.volume / volumeMA : 1;
    const volumeSpike = volumeRatio >= 1.5;

    // Whale Flow
    const buyVol = flow?.buyVol ?? 0;
    const sellVol = flow?.sellVol ?? 0;
    const totalVol = buyVol + sellVol;
    const whaleFlowPct = totalVol > 0 ? ((buyVol - sellVol) / totalVol) * 100 : 0;
    const largeBuy = flow?.largeBuy ?? 0;
    const largeSell = flow?.largeSell ?? 0;
    const largeTrades = flow?.trades ?? 0;

    // Time Features
    const now = Date.now();
    const candleTime = new Date(last.closeTime);
    const hourOfDay = candleTime.getUTCHours();
    const dayOfWeek = candleTime.getUTCDay();
    const marketOpen = new Date(candleTime);
    marketOpen.setUTCHours(0, 0, 0, 0);
    const minutesSinceOpen = (candleTime.getTime() - marketOpen.getTime()) / 60000;

    // Composite Features
    const volatility = computeVolatility(klines);
    const spread = price > 0 ? ((last.high - last.low) / price) * 100 : 0;

    const body = Math.abs(last.close - last.open);
    const range = last.high - last.low;
    const bodyRatio = range > 0 ? body / range : 0;

    const candleDirection = last.close > last.open ? 1 : last.close < last.open ? -1 : 0;

    return {
        price,
        open: last.open,
        high: last.high,
        low: last.low,
        close: last.close,
        volume: last.volume,
        rsi,
        macdHist: macd.hist,
        macdSignal: macd.signal,
        bbPosition: bb.position,
        bbWidth: bb.width,
        emaShort,
        emaMedium,
        emaLong,
        volumeRatio,
        volumeMA,
        volumeSpike,
        regime,
        regimeConfidence,
        whaleFlowPct,
        whaleBuyVol: buyVol,
        whaleSellVol: sellVol,
        largeTrades,
        hourOfDay,
        dayOfWeek,
        minutesSinceOpen,
        volatility,
        spread,
        bodyRatio,
        candleDirection,
    };
}

// ─── Feature Normalization ─────────────────────────────────────────────────

export function normalizeFeatures(
    features: ExtractedFeatures,
    stats?: { mean: Record<string, number>; std: Record<string, number> },
): Record<string, number> {
    const raw: Record<string, number> = {
        price: Math.log(features.price + 1),
        rsi: features.rsi / 100,
        macdHist: Math.tanh(features.macdHist),
        macdSignal: Math.tanh(features.macdSignal),
        bbPosition: features.bbPosition,
        bbWidth: Math.min(features.bbWidth, 0.5),
        volumeRatio: Math.log(features.volumeRatio + 0.1),
        volumeMA: Math.log(features.volumeMA + 1),
        whaleFlowPct: features.whaleFlowPct / 100,
        whaleBuyVol: Math.log(features.whaleBuyVol + 1),
        whaleSellVol: Math.log(features.whaleSellVol + 1),
        largeTrades: Math.log(features.largeTrades + 1),
        hourOfDay: features.hourOfDay / 24,
        dayOfWeek: features.dayOfWeek / 7,
        minutesSinceOpen: features.minutesSinceOpen / 1440,
        volatility: Math.min(features.volatility / price, 0.1), // will use price from features
        spread: features.spread / 10,
        bodyRatio: features.bodyRatio,
        candleDirection: (features.candleDirection + 1) / 2,
    };

    // Optional z-score normalization if stats provided
    if (stats) {
        for (const [key, val] of Object.entries(raw)) {
            const m = stats.mean[key];
            const s = stats.std[key];
            if (m !== undefined && s !== undefined && s > 0) {
                raw[key] = (val - m) / s;
            }
        }
    }

    return raw;
}

const price = 100; // dummy export to avoid unused var warning

// ─── Feature Vector for ML Models ──────────────────────────────────────────

export function featuresToArray(
    features: ExtractedFeatures,
): number[] {
    return [
        Math.log(features.price + 1),
        Math.log(features.volume + 1),
        features.rsi / 100,
        Math.tanh(features.macdHist),
        Math.tanh(features.macdSignal),
        features.bbPosition,
        Math.log(features.volumeRatio + 0.1),
        features.whaleFlowPct / 100,
        Math.log(features.whaleBuyVol + 1),
        Math.log(features.whaleSellVol + 1),
        features.hourOfDay / 24,
        features.dayOfWeek / 7,
        Math.min(features.volatility / features.price, 0.1),
        features.spread / 10,
        features.bodyRatio,
        (features.candleDirection + 1) / 2,
        features.regimeConfidence / 100,
    ];
}

export const FEATURE_COUNT = 17;
export const FEATURE_NAMES = [
    "logPrice", "logVolume", "rsiNorm", "macdHistTanh", "macdSignalTanh",
    "bbPosition", "logVolumeRatio", "whaleFlowNorm", "logWhaleBuy",
    "logWhaleSell", "hourNorm", "dayNorm", "volatilityNorm", "spreadNorm",
    "bodyRatio", "candleDirNorm", "regimeConfidenceNorm",
];