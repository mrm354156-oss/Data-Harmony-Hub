// Dynamic Confidence Engine — V2
// Computes a unified confidence score from multiple sources:
// - Indicators (RSI, MACD, Volume, EMA)
// - Smart Money (BOS, MSS, Order Blocks, Liquidity, FVG)
// - Market Context (Regime, Trend Strength, Volatility)
// - Candlestick Confirmation (Engulfing, Pin Bar, Breakout)
// - Structure (Trend Alignment, HTF Confirmation)

import type { SniperKline, SniperFlow, SniperDirection } from "./sniperEngine";
import type { MarketRegime, RegimeInfo, SignalBehavior } from "./qualityEngine";
import { analyzeSmartMoney, type SmartMoneyVerdict, getLiquidityTargets } from "./smartMoneyEngine";
import type { MultiIndicatorVerdict } from "./multiIndicatorEngine";

export interface ConfidenceInput {
    klines: SniperKline[];
    direction: SniperDirection;
    regime: RegimeInfo;
    multiIndicator: MultiIndicatorVerdict;
    volumeRatio: number;
    flow: SniperFlow | null;
    smartMoneyScore: number;
    smartMoneyVerdict: SmartMoneyVerdict;
    rsi: number;
    patternPresent: boolean;
    volumeConfirmed: boolean;
    timeframe: string;
}

export interface ConfidenceBreakdown {
    indicatorScore: number;     // 0-100
    smartMoneyScore: number;    // 0-100
    contextScore: number;       // 0-100
    candleScore: number;        // 0-100
    structureScore: number;     // 0-100
    weights: ConfidenceWeights;
}

export interface ConfidenceWeights {
    indicator: number;
    smartMoney: number;
    context: number;
    candle: number;
    structure: number;
}

export interface ConfidenceResult {
    score: number;              // 0-100
    breakdown: ConfidenceBreakdown;
    grade: "A+" | "A" | "B+" | "B" | "C" | "D";
    recommendation: "strong_entry" | "entry" | "caution" | "avoid" | "skip";
    riskMultiplier: number;     // 0.5 - 1.5
    signalBehavior: SignalBehavior;
    reasons: string[];
}

// V2 — Dynamic weights based on market regime
function getConfidenceWeights(regime: MarketRegime): ConfidenceWeights {
    switch (regime) {
        case "strong_trend_up":
        case "strong_trend_down":
            // Strong trend: trust indicators + structure more
            return { indicator: 25, smartMoney: 25, context: 20, candle: 15, structure: 15 };
        case "trend_up":
        case "trend_down":
            // Trend: balanced but structure-weighted
            return { indicator: 25, smartMoney: 25, context: 20, candle: 15, structure: 15 };
        case "range":
            // Range: trust smart money + indicators more
            return { indicator: 30, smartMoney: 30, context: 15, candle: 15, structure: 10 };
        case "volatile":
            // Volatile: trust smart money + context more
            return { indicator: 20, smartMoney: 30, context: 25, candle: 15, structure: 10 };
        case "choppy":
        case "squeeze":
        case "low_liquidity":
        default:
            // Choppy: trust context + smart money more
            return { indicator: 20, smartMoney: 25, context: 25, candle: 15, structure: 15 };
    }
}

// V2 — Score indicators (RSI, MACD, Volume, EMA)
function scoreIndicators(input: ConfidenceInput): { score: number; reasons: string[] } {
    const { multiIndicator, volumeRatio, rsi, direction, flow } = input;
    let score = 0;
    const reasons: string[] = [];

    // RSI alignment (0-25)
    const rsiAligned = direction === "long"
        ? (rsi >= 30 && rsi <= 65)
        : (rsi >= 35 && rsi <= 70);
    if (rsiAligned) {
        score += 20;
        reasons.push(`RSI متوافق (${rsi.toFixed(0)})`);
    } else {
        score += 5;
        reasons.push(`RSI غير متوافق (${rsi.toFixed(0)})`);
    }

    // MACD alignment (0-25)
    if (multiIndicator.direction === direction) {
        score += Math.min(25, Math.round(multiIndicator.confidence * 0.25));
        reasons.push(`MACD متوافق`);
    } else {
        score += 5;
        reasons.push(`MACD غير متوافق`);
    }

    // Volume confirmation (0-25)
    if (volumeRatio >= 1.5) {
        score += Math.min(25, Math.round((volumeRatio - 1) * 15));
        reasons.push(`فوليوم قوي (×${volumeRatio.toFixed(2)})`);
    } else if (volumeRatio >= 1.0) {
        score += 10;
    } else {
        score += 0;
        reasons.push(`فوليوم ضعيف`);
    }

    // Whale flow (0-25)
    if (flow) {
        const total = flow.buyVol + flow.sellVol;
        const flowPct = total > 0 ? ((flow.buyVol - flow.sellVol) / total) * 100 : 0;
        const alignedFlow = direction === "long" ? flowPct : -flowPct;
        if (alignedFlow > 15) {
            score += 25;
            reasons.push(`تيار حيتان صاعد (+${alignedFlow.toFixed(0)}%)`);
        } else if (alignedFlow > 5) {
            score += 15;
            reasons.push(`تيار حيتان محايد`);
        } else {
            score += 5;
            reasons.push(`تيار حيتان هابط`);
        }
    } else {
        score += 10;
    }

    return { score: Math.min(100, score), reasons };
}

// V2 — Score smart money components
function scoreSmartMoney(verdict: SmartMoneyVerdict, direction: SniperDirection): { score: number; reasons: string[] } {
    let score = 0;
    const reasons: string[] = [];

    // BOS alignment
    if (verdict.hasBOS && verdict.bosDirection === (direction === "long" ? "bullish" : "bearish")) {
        score += 25;
        reasons.push("BOS مؤكد");
    }

    // MSS alignment
    if (verdict.hasMSS && verdict.mssDirection === (direction === "long" ? "bullish" : "bearish")) {
        score += 25;
        reasons.push("MSS مؤكد");
    }

    // Structure bias alignment
    if (verdict.structureBias === (direction === "long" ? "bullish" : "bearish")) {
        score += 20;
        reasons.push("البنية متوافقة");
    }

    // Order block presence
    if (verdict.nearestOB) {
        score += 15;
        reasons.push("Order Block موجود");
    }

    // FVG presence
    if (verdict.nearestFVG) {
        score += 15;
        reasons.push("FVG موجود");
    }

    return { score: Math.min(100, score), reasons };
}

// V2 — Score market context
function scoreContext(regime: RegimeInfo, direction: SniperDirection): { score: number; reasons: string[] } {
    let score = 0;
    const reasons: string[] = [];

    // Regime confidence
    score += Math.round(regime.confidenceInRegime * 0.3);
    reasons.push(`ثقة النظام: ${regime.confidenceInRegime}%`);

    // Trend strength
    if (regime.trendStrength > 50) {
        score += 25;
        reasons.push(`قوة ترند عالية (${regime.trendStrength})`);
    } else if (regime.trendStrength > 30) {
        score += 15;
    } else {
        score += 5;
    }

    // Regime type bonus
    const goodRegimes: MarketRegime[] = ["strong_trend_up", "strong_trend_down", "trend_up", "trend_down"];
    if (goodRegimes.includes(regime.regime)) {
        score += 25;
        reasons.push(`نظام سوق م favorabel`);
    } else if (regime.regime === "range") {
        score += 15;
    } else {
        score += 5;
    }

    // ADX-lite quality
    if (regime.adxLite > 60) {
        score += 20;
        reasons.push(`جودة ترند عالية (ADX ${regime.adxLite})`);
    } else {
        score += Math.round(regime.adxLite * 0.2);
    }

    return { score: Math.min(100, score), reasons };
}

// V2 — Score candlestick patterns
function scoreCandlestick(klines: SniperKline[], direction: SniperDirection, patternPresent: boolean): { score: number; reasons: string[] } {
    let score = 0;
    const reasons: string[] = [];

    if (klines.length < 5) return { score: 50, reasons: ["بيانات غير كافية"] };

    const last = klines[klines.length - 1];
    const prev = klines[klines.length - 2];
    const body = Math.abs(last.close - last.open);
    const range = last.high - last.low;
    const bodyPct = range > 0 ? body / range : 0;

    // Pattern present
    if (patternPresent) {
        score += 30;
        reasons.push("نمط شمعي مؤكد");
    }

    // Engulfing pattern
    const prevBody = Math.abs(prev.close - prev.open);
    if (direction === "long" && last.close > last.open && last.open <= prev.close && last.close >= prev.open) {
        score += 25;
        reasons.push("نمط ابتلاع صاعد");
    } else if (direction === "short" && last.close < last.open && last.open >= prev.close && last.close <= prev.open) {
        score += 25;
        reasons.push("نمط ابتلاع هابط");
    }

    // Strong candle body
    if (bodyPct > 0.6) {
        score += 20;
        reasons.push("شمعة قوية");
    } else if (bodyPct > 0.4) {
        score += 10;
    }

    // Confirmation candle (close above/below key level)
    if (direction === "long" && last.close > last.open) {
        score += 15;
        reasons.push("إغلاق صاعد");
    } else if (direction === "short" && last.close < last.open) {
        score += 15;
        reasons.push("إغلاق هابط");
    }

    return { score: Math.min(100, score), reasons };
}

// V2 — Score structure alignment
function scoreStructure(
    regime: RegimeInfo,
    direction: SniperDirection,
    timeframe: string,
): { score: number; reasons: string[] } {
    let score = 0;
    const reasons: string[] = [];

    // Regime direction alignment
    const isTrendUp = regime.regime === "trend_up" || regime.regime === "strong_trend_up";
    const isTrendDown = regime.regime === "trend_down" || regime.regime === "strong_trend_down";

    if ((direction === "long" && isTrendUp) || (direction === "short" && isTrendDown)) {
        score += 40;
        reasons.push("الاتجاه متوافق مع النظام");
    } else if (regime.regime === "range") {
        score += 20;
        reasons.push("سوق عرضي");
    } else {
        score += 5;
        reasons.push("الاتجاه يعاكس النظام");
    }

    // Timeframe bonus (higher TFs = more conviction)
    const tfBonus: Record<string, number> = {
        "1m": 0, "3m": 5, "5m": 10, "15m": 15, "30m": 20,
        "1h": 25, "2h": 30, "4h": 35, "6h": 35, "8h": 40,
        "12h": 40, "1d": 45, "3d": 45, "1w": 50,
    };
    score += tfBonus[timeframe] || 10;

    // Volume stability bonus
    if (regime.volumeStability > 60) {
        score += 15;
        reasons.push("استقرار فوليوم عالي");
    }

    // Liquidity score
    if (regime.liquidityScore > 50) {
        score += 5;
    }

    return { score: Math.min(100, score), reasons };
}

// Main confidence calculation
export function calculateConfidence(input: ConfidenceInput): ConfidenceResult {
    const weights = getConfidenceWeights(input.regime.regime);

    // Score each component
    const indicatorResult = scoreIndicators(input);
    const smartMoneyResult = scoreSmartMoney(input.smartMoneyVerdict, input.direction);
    const contextResult = scoreContext(input.regime, input.direction);
    const candleResult = scoreCandlestick(input.klines, input.direction, input.patternPresent);
    const structureResult = scoreStructure(input.regime, input.direction, input.timeframe);

    // Weighted final score
    const score = Math.round(
        indicatorResult.score * (weights.indicator / 100) +
        smartMoneyResult.score * (weights.smartMoney / 100) +
        contextResult.score * (weights.context / 100) +
        candleResult.score * (weights.candle / 100) +
        structureResult.score * (weights.structure / 100)
    );

    // Grade determination
    let grade: ConfidenceResult["grade"] = "D";
    if (score >= 85) grade = "A+";
    else if (score >= 75) grade = "A";
    else if (score >= 65) grade = "B+";
    else if (score >= 55) grade = "B";
    else if (score >= 45) grade = "C";

    // Recommendation
    let recommendation: ConfidenceResult["recommendation"] = "skip";
    if (score >= 80) recommendation = "strong_entry";
    else if (score >= 65) recommendation = "entry";
    else if (score >= 50) recommendation = "caution";
    else if (score >= 40) recommendation = "avoid";

    // Risk multiplier based on score
    const riskMultiplier = score >= 80 ? 1.5 : score >= 65 ? 1.2 : score >= 50 ? 1.0 : score >= 40 ? 0.7 : 0.5;

    // Collect all reasons
    const reasons = [
        ...indicatorResult.reasons,
        ...smartMoneyResult.reasons,
        ...contextResult.reasons,
        ...candleResult.reasons,
        ...structureResult.reasons,
    ];

    return {
        score: Math.max(0, Math.min(100, score)),
        breakdown: {
            indicatorScore: indicatorResult.score,
            smartMoneyScore: smartMoneyResult.score,
            contextScore: contextResult.score,
            candleScore: candleResult.score,
            structureScore: structureResult.score,
            weights,
        },
        grade,
        recommendation,
        riskMultiplier,
        signalBehavior: input.regime.signalBehavior,
        reasons,
    };
}

// V2 — Utility: get confidence label in Arabic
export function getConfidenceLabel(grade: ConfidenceResult["grade"]): string {
    switch (grade) {
        case "A+": return "ممتاز";
        case "A": return "جيد جداً";
        case "B+": return "جيد";
        case "B": return "مقبول";
        case "C": return "ضعيف";
        case "D": return "ضعيف جداً";
    }
}

// V2 — Utility: should we take this trade?
export function shouldTakeTrade(result: ConfidenceResult): boolean {
    return result.recommendation === "strong_entry" || result.recommendation === "entry";
}

// V2 — Utility: get adjusted TP/SL based on confidence
export function getAdjustedTargets(
    baseTP: number,
    baseSL: number,
    confidence: ConfidenceResult,
    direction: "long" | "short",
): { tp1: number; tp2: number; tp3: number; runner: number; sl: number } {
    const mult = confidence.riskMultiplier;
    const behavior = confidence.signalBehavior;

    // TP adjustment
    const tpMult = behavior.expandTargets ? 1.3 : behavior.reduceTargets ? 0.7 : 1.0;

    if (direction === "long") {
        const slDistance = Math.abs(baseTP - baseSL);
        return {
            tp1: baseTP,
            tp2: baseTP + slDistance * 0.5 * tpMult,
            tp3: baseTP + slDistance * 1.0 * tpMult,
            runner: behavior.allowRunner ? baseTP + slDistance * 2.0 * tpMult : baseTP,
            sl: baseSL,
        };
    } else {
        const slDistance = Math.abs(baseSL - baseTP);
        return {
            tp1: baseTP,
            tp2: baseTP - slDistance * 0.5 * tpMult,
            tp3: baseTP - slDistance * 1.0 * tpMult,
            runner: behavior.allowRunner ? baseTP - slDistance * 2.0 * tpMult : baseTP,
            sl: baseSL,
        };
    }
}