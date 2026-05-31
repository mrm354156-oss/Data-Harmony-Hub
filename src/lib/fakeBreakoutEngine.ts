// Advanced Fake Breakout Detection Engine — V2
// Detects and filters fake breakouts using multiple criteria:
// - Close confirmation (not just wick)
// - Volume expansion
// - Continuation (2+ candles)
// - Wick rejection analysis
// - Retest confirmation
// - Trend alignment
// - Resistance proximity

import type { SniperKline, SniperFlow, SniperDirection } from "./sniperEngine";
import type { MarketRegime, RegimeInfo } from "./qualityEngine";

export interface BreakoutSignal {
    type: "real" | "fake" | "weak";
    direction: "long" | "short";
    level: number;              // the broken level
    confidence: number;         // 0-100
    reasons: string[];
    details: {
        closeConfirmed: boolean;    // candle closed above/below level
        volumeExpanded: boolean;    // volume > 1.5x average
        continuationCandles: number; // how many candles held above/below
        wickRejection: boolean;     // strong wick rejection present
        retestConfirmed: boolean;   // price retested and held
        trendAligned: boolean;      // aligned with higher timeframe trend
        resistanceProximity: boolean; // near resistance/support zone
    };
}

export interface BreakoutAnalysis {
    signal: BreakoutSignal;
    shouldEnter: boolean;       // final recommendation
    adjustedConfidence: number; // after all adjustments
    riskLevel: "low" | "medium" | "high" | "extreme";
}

// V2 — Detect if a candle body closed above/below a level
function hasCloseConfirmation(kline: SniperKline, level: number, direction: "long" | "short"): boolean {
    if (direction === "long") {
        return kline.close > level && kline.close > kline.open; // bullish close above
    } else {
        return kline.close < level && kline.close < kline.open; // bearish close below
    }
}

// V2 — Check volume expansion
function hasVolumeExpansion(klines: SniperKline[], currentIndex: number): boolean {
    if (currentIndex < 5) return false;
    const recent = klines.slice(Math.max(0, currentIndex - 5), currentIndex);
    const avgVolume = recent.reduce((a, k) => a + k.volume, 0) / recent.length;
    const currentVolume = klines[currentIndex].volume;
    return currentVolume > avgVolume * 1.5;
}

// V2 — Count continuation candles (candles that stayed above/below the level)
function countContinuationCandles(klines: SniperKline[], startIndex: number, level: number, direction: "long" | "short"): number {
    let count = 0;
    for (let i = startIndex; i < klines.length; i++) {
        const k = klines[i];
        if (direction === "long") {
            if (k.close > level) count++;
            else break;
        } else {
            if (k.close < level) count++;
            else break;
        }
    }
    return count;
}

// V2 — Detect wick rejection
function hasWickRejection(kline: SniperKline, level: number, direction: "long" | "short"): boolean {
    const range = kline.high - kline.low;
    if (range <= 0) return false;

    if (direction === "long") {
        // Upper wick rejection: price went above but closed below with long upper wick
        const upperWick = kline.high - Math.max(kline.open, kline.close);
        return upperWick / range > 0.6 && kline.close < level;
    } else {
        // Lower wick rejection: price went below but closed above with long lower wick
        const lowerWick = Math.min(kline.open, kline.close) - kline.low;
        return lowerWick / range > 0.6 && kline.close > level;
    }
}

// V2 — Detect retest confirmation (price returned to level and held)
function hasRetestConfirmation(klines: SniperKline[], breakoutIndex: number, level: number, direction: "long" | "short"): boolean {
    if (breakoutIndex + 3 >= klines.length) return false;

    // Look for a retest within 3-5 candles after breakout
    for (let i = breakoutIndex + 1; i < Math.min(breakoutIndex + 6, klines.length); i++) {
        const k = klines[i];
        if (direction === "long") {
            // Price came back to test the level and held
            if (k.low <= level * 1.002 && k.close > level) {
                return true;
            }
        } else {
            if (k.high >= level * 0.998 && k.close < level) {
                return true;
            }
        }
    }
    return false;
}

// V2 — Check if breakout is aligned with trend
function isTrendAligned(klines: SniperKline[], direction: "long" | "short"): boolean {
    if (klines.length < 20) return false;

    const closes = klines.map(k => k.close);
    const n = Math.min(20, closes.length);
    const series = closes.slice(-n);

    // Simple EMA comparison
    const ema9 = series.reduce((a, b, i) => {
        const k = 2 / 10;
        return i === 0 ? b : b * k + a * (1 - k);
    }, 0);

    const ema20 = series.reduce((a, b, i) => {
        const k = 2 / 21;
        return i === 0 ? b : b * k + a * (1 - k);
    }, 0);

    if (direction === "long") {
        return ema9 > ema20; // uptrend
    } else {
        return ema9 < ema20; // downtrend
    }
}

// V2 — Check if near resistance/support
function isNearResistance(klines: SniperKline[], currentPrice: number, direction: "long" | "short"): boolean {
    if (klines.length < 10) return false;

    const recent = klines.slice(-10);
    const recentHigh = Math.max(...recent.map(k => k.high));
    const recentLow = Math.min(...recent.map(k => k.low));

    if (direction === "long") {
        // Check if price is near recent resistance (within 0.5%)
        return Math.abs(currentPrice - recentHigh) / recentHigh < 0.005;
    } else {
        return Math.abs(currentPrice - recentLow) / recentLow < 0.005;
    }
}

// Main analysis function
export function analyzeBreakout(
    klines: SniperKline[],
    direction: "long" | "short",
    regime: RegimeInfo,
): BreakoutAnalysis {
    if (klines.length < 10) {
        return {
            signal: {
                type: "fake", direction, level: 0, confidence: 0,
                reasons: ["بيانات غير كافية"],
                details: {
                    closeConfirmed: false, volumeExpanded: false,
                    continuationCandles: 0, wickRejection: false,
                    retestConfirmed: false, trendAligned: false,
                    resistanceProximity: false,
                },
            },
            shouldEnter: false,
            adjustedConfidence: 0,
            riskLevel: "extreme",
        };
    }

    const last = klines[klines.length - 1];
    const prev = klines[klines.length - 2];

    // Determine the broken level
    const lookback = klines.slice(-11, -1);
    const brokenLevel = direction === "long"
        ? Math.max(...lookback.map(k => k.high))
        : Math.min(...lookback.map(k => k.low));

    // Analyze breakout quality
    const closeConfirmed = hasCloseConfirmation(last, brokenLevel, direction);
    const volumeExpanded = hasVolumeExpansion(klines, klines.length - 1);
    const continuationCandles = countContinuationCandles(klines, klines.length - 1, brokenLevel, direction);
    const wickRejection = hasWickRejection(last, brokenLevel, direction);
    const retestConfirmed = hasRetestConfirmation(klines, klines.length - 1, brokenLevel, direction);
    const trendAligned = isTrendAligned(klines, direction);
    const resistanceProximity = isNearResistance(klines, last.close, direction);

    // Calculate breakout confidence
    let confidence = 0;
    const reasons: string[] = [];

    // Close confirmation is critical (0-30 points)
    if (closeConfirmed) {
        confidence += 30;
        reasons.push("إغلاق فوق المستوى");
    } else {
        reasons.push("❌ لا يوجد إغلاق فوق المستوى");
    }

    // Volume expansion (0-25 points)
    if (volumeExpanded) {
        confidence += 25;
        reasons.push("توسع الفوليوم");
    } else {
        reasons.push("❌ فوليوم ضعيف");
    }

    // Continuation candles (0-20 points)
    if (continuationCandles >= 2) {
        confidence += Math.min(20, continuationCandles * 10);
        reasons.push(`${continuationCandles} شمعة استمرار`);
    } else {
        reasons.push("❌ بدون استمرار");
    }

    // No wick rejection (0-10 points)
    if (!wickRejection) {
        confidence += 10;
        reasons.push("✓ بدون رفض ظل");
    } else {
        reasons.push("❌ رفض ظل قوي");
    }

    // Retest confirmation (0-10 points)
    if (retestConfirmed) {
        confidence += 10;
        reasons.push("✓ إعادة اختبار ناجحة");
    }

    // Trend alignment (0-5 points)
    if (trendAligned) {
        confidence += 5;
        reasons.push("✓ متوافق مع الترند");
    } else {
        reasons.push("❌ يعاكس الترند");
    }

    // Determine breakout type
    let type: BreakoutSignal["type"] = "fake";
    if (confidence >= 70) {
        type = "real";
    } else if (confidence >= 40) {
        type = "weak";
    } else {
        type = "fake";
    }

    // Adjust confidence based on regime
    let adjustedConfidence = confidence;
    if (regime.regime === "choppy" || regime.regime === "squeeze") {
        adjustedConfidence = Math.round(confidence * 0.7); // reduce in choppy markets
    } else if (regime.regime === "volatile") {
        adjustedConfidence = Math.round(confidence * 0.85); // slight reduction in volatile
    }

    // Determine risk level
    let riskLevel: BreakoutAnalysis["riskLevel"] = "extreme";
    if (adjustedConfidence >= 70) riskLevel = "low";
    else if (adjustedConfidence >= 50) riskLevel = "medium";
    else if (adjustedConfidence >= 30) riskLevel = "high";

    // Final recommendation
    const shouldEnter = type === "real" && adjustedConfidence >= 60 && !resistanceProximity;

    return {
        signal: {
            type,
            direction,
            level: brokenLevel,
            confidence: adjustedConfidence,
            reasons,
            details: {
                closeConfirmed,
                volumeExpanded,
                continuationCandles,
                wickRejection,
                retestConfirmed,
                trendAligned,
                resistanceProximity,
            },
        },
        shouldEnter,
        adjustedConfidence,
        riskLevel,
    };
}

// V2 — Utility: get breakout label in Arabic
export function getBreakoutLabel(type: BreakoutSignal["type"]): string {
    switch (type) {
        case "real": return "اختراق حقيقي";
        case "weak": return "اختراق ضعيف";
        case "fake": return "اختراق وهمي";
    }
}

// V2 — Utility: should we avoid this trade?
export function shouldAvoidBreakout(analysis: BreakoutAnalysis): boolean {
    return analysis.signal.type === "fake" || analysis.riskLevel === "extreme";
}

// V2 — Utility: get adjusted entry based on breakout quality
export function getAdjustedEntry(
    baseEntry: number,
    breakout: BreakoutAnalysis,
    direction: "long" | "short",
): { entry: number; sl: number; tp1: number; tp2: number } {
    const riskBuffer = breakout.riskLevel === "low" ? 0.001
        : breakout.riskLevel === "medium" ? 0.002
            : 0.003;

    if (direction === "long") {
        const entry = baseEntry * (1 + riskBuffer);
        const sl = breakout.signal.level * 0.998; // below broken level
        const tp1 = entry * 1.005; // conservative TP
        const tp2 = entry * 1.015; // aggressive TP
        return { entry, sl, tp1, tp2 };
    } else {
        const entry = baseEntry * (1 - riskBuffer);
        const sl = breakout.signal.level * 1.002; // above broken level
        const tp1 = entry * 0.995;
        const tp2 = entry * 0.985;
        return { entry, sl, tp1, tp2 };
    }
}