// ═══════════════════════════════════════════════════════════════════
// sniperDecisionCore.ts — THE SINGLE DECISION BRAIN
// ═══════════════════════════════════════════════════════════════════
// This is the ONLY file that makes trading decisions.
// All other engines provide scores, this engine makes the final call.
//
// Architecture:
//   Indicators (25%) + Smart Money (30%) + Market Quality (20%)
//   + HTF Bias (15%) + Learning (10%) = FINAL SCORE
//
// Score Range:
//   > 70  → BUY signal
//   < -70 → SELL signal
//   40-70 → HOLD (weak signal, don't trade)
//   < 40  → NO_TRADE
// ═══════════════════════════════════════════════════════════════════

import type { SniperKline, SniperFlow, SniperFearGreed, SniperDirection, SniperTimeframe } from "./sniperEngine";
import { analyzeMultiIndicator, type MultiIndicatorVerdict } from "./multiIndicatorEngine";
import { analyzeSmartMoney, type SmartMoneyVerdict } from "./smartMoneyEngine";
import { detectMarketRegime, type RegimeInfo, type MarketRegime } from "./qualityEngine";
import { detectTraps, type TrapVerdict } from "./qualityEngine";
import { getLearningAdjustment, refreshLearningCache } from "./learningFilter";

// ─────────────── Types ───────────────

export type TradeAction = "buy" | "sell" | "hold" | "no_trade";

export interface DecisionScore {
    indicators: number;    // -100 to +100 (positive = bullish, negative = bearish)
    smartMoney: number;    // -100 to +100
    marketQuality: number; // -100 to +100
    htfBias: number;       // -100 to +100
    learning: number;      // -100 to +100
    final: number;         // weighted final score
}

export interface DecisionBreakdown {
    // Component details
    indicatorsDetail: {
        rsi: number;
        macd: number;
        volume: number;
        whaleFlow: number;
        direction: "bullish" | "bearish" | "neutral";
    };
    smartMoneyDetail: {
        bos: boolean;
        mss: boolean;
        structureBias: string;
        orderBlock: boolean;
        fvg: boolean;
        score: number;
    };
    marketQualityDetail: {
        regime: MarketRegime;
        regimeLabel: string;
        trendStrength: number;
        trapDetected: boolean;
        trapTypes: string[];
    };
    htfDetail: {
        htfTimeframe: SniperTimeframe;
        htfDirection: "bullish" | "bearish" | "neutral";
        htfTrendStrength: number;
        aligned: boolean;
    };
    learningDetail: {
        adjustmentFactor: number;
        sampleSize: number;
        historicalWinRate: number;
    };
}

export interface DecisionResult {
    action: TradeAction;
    score: DecisionScore;
    breakdown: DecisionBreakdown;
    confidence: number;        // 0-100 absolute confidence
    riskReward: number;        // estimated R:R
    direction: SniperDirection;
    entry: number;
    target1: number;
    target2: number;
    target3: number;
    runner: number;
    stopLoss: number;
    hardStopLoss: number;
    reasons: string[];
    timestamp: number;
}

// ─────────────── Weights ───────────────

const SCORE_WEIGHTS = {
    indicators: 0.25,
    smartMoney: 0.30,
    marketQuality: 0.20,
    htfBias: 0.15,
    learning: 0.10,
};

// Regime-specific weight adjustments
function getRegimeWeightAdjustment(regime: MarketRegime): Partial<typeof SCORE_WEIGHTS> {
    switch (regime) {
        case "strong_trend_up":
        case "strong_trend_down":
            return { smartMoney: 0.35, indicators: 0.25, htfBias: 0.20 };
        case "trend_up":
        case "trend_down":
            return { smartMoney: 0.30, indicators: 0.25, htfBias: 0.15 };
        case "range":
            return { indicators: 0.30, smartMoney: 0.25, marketQuality: 0.25 };
        case "volatile":
            return { smartMoney: 0.35, marketQuality: 0.25, indicators: 0.20 };
        case "choppy":
        case "squeeze":
        case "low_liquidity":
            return { marketQuality: 0.30, smartMoney: 0.25, indicators: 0.20 };
        default:
            return {};
    }
}

// ─────────────── Indicator Scoring ───────────────

function scoreIndicators(
    multiIndicator: MultiIndicatorVerdict,
    flow: SniperFlow | null,
    direction: SniperDirection,
): DecisionBreakdown["indicatorsDetail"] {
    // RSI score: -100 to +100
    const rsiReading = multiIndicator.reading;
    let rsiScore = 0;
    if (direction === "long") {
        if (rsiReading.rsi >= 30 && rsiReading.rsi <= 65) rsiScore = 50;
        else if (rsiReading.rsi < 30) rsiScore = 80; // oversold = bullish
        else rsiScore = -30; // overbought = bearish for longs
    } else {
        if (rsiReading.rsi >= 35 && rsiReading.rsi <= 70) rsiScore = 50;
        else if (rsiReading.rsi > 70) rsiScore = 80; // overbought = bearish
        else rsiScore = -30;
    }

    // MACD score
    const macdScore = multiIndicator.direction === direction ? 60 : -40;

    // Volume score
    const volumeScore = rsiReading.volumeRatio >= 2.0 ? 80
        : rsiReading.volumeRatio >= 1.5 ? 60
            : rsiReading.volumeRatio >= 1.2 ? 40
                : rsiReading.volumeRatio >= 1.0 ? 20 : -10;

    // Whale flow score
    let whaleScore = 0;
    if (flow) {
        const total = flow.buyVol + flow.sellVol;
        const flowPct = total > 0 ? ((flow.buyVol - flow.sellVol) / total) * 100 : 0;
        const alignedFlow = direction === "long" ? flowPct : -flowPct;
        whaleScore = alignedFlow >= 25 ? 90
            : alignedFlow >= 15 ? 70
                : alignedFlow >= 5 ? 40
                    : alignedFlow >= -5 ? 0
                        : -50;
    }

    // Combined indicator score
    const combined = Math.round(
        rsiScore * 0.25 + macdScore * 0.25 + volumeScore * 0.25 + whaleScore * 0.25
    );

    return {
        rsi: rsiScore,
        macd: macdScore,
        volume: volumeScore,
        whaleFlow: whaleScore,
        direction: multiIndicator.direction === direction ? "bullish" : multiIndicator.direction === "short" ? "bearish" : "neutral",
    };
}

// ─────────────── Smart Money Scoring ───────────────

function scoreSmartMoney(
    smartMoney: SmartMoneyVerdict,
    direction: SniperDirection,
): DecisionBreakdown["smartMoneyDetail"] {
    let score = 0;

    // BOS aligned: +25
    if (smartMoney.hasBOS && smartMoney.bosDirection === (direction === "long" ? "bullish" : "bearish")) {
        score += 25;
    } else if (smartMoney.hasBOS) {
        score -= 15; // BOS against direction
    }

    // MSS aligned: +25
    if (smartMoney.hasMSS && smartMoney.mssDirection === (direction === "long" ? "bullish" : "bearish")) {
        score += 25;
    } else if (smartMoney.hasMSS) {
        score -= 15;
    }

    // Structure bias: +20
    if (smartMoney.structureBias === (direction === "long" ? "bullish" : "bearish")) {
        score += 20;
    } else if (smartMoney.structureBias !== "neutral") {
        score -= 10;
    }

    // Order block: +15
    if (smartMoney.nearestOB) score += 15;

    // FVG: +15
    if (smartMoney.nearestFVG) score += 15;

    return {
        bos: smartMoney.hasBOS,
        mss: smartMoney.hasMSS,
        structureBias: smartMoney.structureBias,
        orderBlock: !!smartMoney.nearestOB,
        fvg: !!smartMoney.nearestFVG,
        score: Math.max(-100, Math.min(100, score)),
    };
}

// ─────────────── Market Quality Scoring ───────────────

function scoreMarketQuality(
    regime: RegimeInfo,
    trap: TrapVerdict,
    direction: SniperDirection,
): DecisionBreakdown["marketQualityDetail"] {
    let score = 0;

    // Regime alignment
    const goodRegimes: MarketRegime[] = ["strong_trend_up", "strong_trend_down", "trend_up", "trend_down"];
    if (goodRegimes.includes(regime.regime)) {
        const aligned = (direction === "long" && (regime.regime.includes("up")))
            || (direction === "short" && (regime.regime.includes("down")));
        score += aligned ? 40 : -20;
    } else if (regime.regime === "range") {
        score += 10; // neutral
    } else {
        score -= 30; // bad regimes
    }

    // Trend strength
    score += Math.round(regime.trendStrength * 0.3);

    // Regime confidence
    score += Math.round(regime.confidenceInRegime * 0.2);

    // Trap penalty
    if (trap.detected) {
        const hardTraps = ["fake_breakout", "liquidity_grab", "volume_trap", "stop_hunt", "exhaustion_climax"];
        const hasHardTrap = trap.types.some(t => hardTraps.includes(t));
        score -= hasHardTrap ? 60 : 30;
    }

    return {
        regime: regime.regime,
        regimeLabel: regime.label,
        trendStrength: regime.trendStrength,
        trapDetected: trap.detected,
        trapTypes: trap.types,
    };
}

// ─────────────── HTF Bias Scoring ───────────────

function scoreHTFBias(
    htfDirection: "bullish" | "bearish" | "neutral",
    htfTrendStrength: number,
    htfTimeframe: SniperTimeframe,
    direction: SniperDirection,
): DecisionBreakdown["htfDetail"] {
    let score = 0;

    if (htfDirection === "neutral") {
        score = 0;
    } else if (
        (direction === "long" && htfDirection === "bullish") ||
        (direction === "short" && htfDirection === "bearish")
    ) {
        // Aligned with HTF — strong bonus
        score = 50 + Math.round(htfTrendStrength * 0.5);
    } else {
        // Against HTF — penalty
        score = -50 - Math.round(htfTrendStrength * 0.3);
    }

    return {
        htfTimeframe,
        htfDirection,
        htfTrendStrength,
        aligned: (direction === "long" && htfDirection === "bullish") ||
            (direction === "short" && htfDirection === "bearish"),
    };
}

// ─────────────── Learning Scoring ───────────────

function scoreLearning(
    symbol: string,
    timeframe: SniperTimeframe,
    direction: SniperDirection,
    regime: MarketRegime,
): DecisionBreakdown["learningDetail"] {
    try {
        refreshLearningCache();
        const adj = getLearningAdjustment(symbol, timeframe, direction, regime);
        // adj.factor: 0.7-1.0 (penalty multiplier)
        // adj.adjustment: -15 to +6 (percentage adjustment)
        const score = Math.round(adj.adjustment * 10); // convert to -100 to +100 range
        return {
            adjustmentFactor: adj.factor,
            sampleSize: adj.samples ?? 0,
            historicalWinRate: adj.winRate ?? 0,
        };
    } catch {
        return { adjustmentFactor: 1.0, sampleSize: 0, historicalWinRate: 0 };
    }
}

// ─────────────── HTF Timeframe Selection ───────────────

function getHTFTimeframe(ltf: SniperTimeframe): SniperTimeframe {
    const hierarchy: Record<string, SniperTimeframe> = {
        "1m": "5m", "3m": "15m", "5m": "15m", "15m": "1h",
        "30m": "1h", "1h": "4h", "2h": "4h", "4h": "1d",
        "6h": "1d", "8h": "1d", "12h": "1d", "1d": "1w",
        "3d": "1w", "1w": "1w",
    };
    return hierarchy[ltf] || "1h";
}

// ─────────────── TP/SL Calculation ───────────────

function calculateTargets(
    entry: number,
    direction: SniperDirection,
    atr: number,
    regime: RegimeInfo,
    smartMoney: SmartMoneyVerdict,
): { tp1: number; tp2: number; tp3: number; runner: number; sl: number; hardStop: number; rr: number } {
    const regimeMult = regime.regime.includes("trend") ? 1.3
        : regime.regime === "volatile" ? 1.4
            : regime.regime === "range" ? 0.8
                : 1.0;

    const smBonus = smartMoney.score >= 50 ? 1.1 : 1.0;

    if (direction === "long") {
        const tp1 = entry + atr * 0.8 * regimeMult * smBonus;
        const tp2 = entry + atr * 1.5 * regimeMult * smBonus;
        const tp3 = entry + atr * 2.5 * regimeMult * smBonus;
        const runner = entry + atr * 4.0 * regimeMult * smBonus;
        const sl = entry - atr * 1.2;
        const hardStop = entry - atr * 2.0;
        const rr = Math.abs(tp1 - entry) / Math.abs(entry - sl);
        return { tp1, tp2, tp3, runner, sl, hardStop, rr };
    } else {
        const tp1 = entry - atr * 0.8 * regimeMult * smBonus;
        const tp2 = entry - atr * 1.5 * regimeMult * smBonus;
        const tp3 = entry - atr * 2.5 * regimeMult * smBonus;
        const runner = entry - atr * 4.0 * regimeMult * smBonus;
        const sl = entry + atr * 1.2;
        const hardStop = entry + atr * 2.0;
        const rr = Math.abs(tp1 - entry) / Math.abs(sl - entry);
        return { tp1, tp2, tp3, runner, sl, hardStop, rr };
    }
}

// ═══════════════════════════════════════════════════════════════════
// MAIN DECISION FUNCTION — THE SINGLE BRAIN
// ═══════════════════════════════════════════════════════════════════

export interface DecisionInput {
    klines: SniperKline[];           // LTF klines (selected timeframe)
    htfKlines: SniperKline[];        // HTF klines (higher timeframe)
    symbol: string;
    baseAsset: string;
    timeframe: SniperTimeframe;
    htfTimeframe: SniperTimeframe;
    flow: SniperFlow | null;
    fearGreed: SniperFearGreed | null;
}

export function makeDecision(input: DecisionInput): DecisionResult {
    const { klines, htfKlines, symbol, timeframe, htfTimeframe, flow, fearGreed } = input;
    const now = Date.now();

    // Default empty result
    const noTrade = (reasons: string[]): DecisionResult => ({
        action: "no_trade",
        score: { indicators: 0, smartMoney: 0, marketQuality: 0, htfBias: 0, learning: 0, final: 0 },
        breakdown: {
            indicatorsDetail: { rsi: 0, macd: 0, volume: 0, whaleFlow: 0, direction: "neutral" },
            smartMoneyDetail: { bos: false, mss: false, structureBias: "neutral", orderBlock: false, fvg: false, score: 0 },
            marketQualityDetail: { regime: "range", regimeLabel: "—", trendStrength: 0, trapDetected: false, trapTypes: [] },
            htfDetail: { htfTimeframe, htfDirection: "neutral", htfTrendStrength: 0, aligned: false },
            learningDetail: { adjustmentFactor: 1.0, sampleSize: 0, historicalWinRate: 0 },
        },
        confidence: 0, riskReward: 0, direction: "long",
        entry: 0, target1: 0, target2: 0, target3: 0, runner: 0, stopLoss: 0, hardStopLoss: 0,
        reasons, timestamp: now,
    });

    if (klines.length < 20) return noTrade(["بيانات LTF غير كافية"]);
    if (htfKlines.length < 10) return noTrade(["بيانات HTF غير كافية"]);

    const lastPrice = klines[klines.length - 1].close;

    // ──── Step 1: Run all engines ────
    const multiIndicator = analyzeMultiIndicator(klines, flow);
    const smartMoney = analyzeSmartMoney(klines, multiIndicator.direction);
    const regime = detectMarketRegime(klines);
    const trap = detectTraps(klines, multiIndicator.direction, flow, multiIndicator.reading.volumeRatio, multiIndicator.reading.rsi);

    // HTF analysis
    const htfMultiIndicator = analyzeMultiIndicator(htfKlines, null);
    const htfRegime = detectMarketRegime(htfKlines);

    // ──── Step 2: Try both directions and pick the better one ────
    const longResult = evaluateDirection("long", lastPrice, klines, multiIndicator, smartMoney, regime, trap, htfMultiIndicator, htfRegime, symbol, timeframe, htfTimeframe, flow);
    const shortResult = evaluateDirection("short", lastPrice, klines, multiIndicator, smartMoney, regime, trap, htfMultiIndicator, htfRegime, symbol, timeframe, htfTimeframe, flow);

    // Pick the stronger signal
    const best = Math.abs(longResult.score.final) >= Math.abs(shortResult.score.final) ? longResult : shortResult;

    // ──── Step 3: Apply absolute thresholds ────
    const absScore = Math.abs(best.score.final);

    if (absScore >= 70) {
        best.action = best.score.final > 0 ? "buy" : "sell";
        best.confidence = Math.min(100, Math.round(50 + absScore * 0.5));
    } else if (absScore >= 40) {
        best.action = "hold";
        best.confidence = Math.round(absScore);
    } else {
        best.action = "no_trade";
        best.confidence = Math.round(absScore);
    }

    // ──── Step 4: Trap override ────
    if (trap.detected) {
        const hardTraps = ["fake_breakout", "liquidity_grab", "volume_trap", "stop_hunt", "exhaustion_climax"];
        const hasHardTrap = trap.types.some(t => hardTraps.includes(t));
        if (hasHardTrap && best.action !== "no_trade") {
            best.action = "no_trade";
            best.confidence = 0;
            best.reasons.push(`🪤 فخ صلب: ${trap.types.join(", ")}`);
        }
    }

    best.timestamp = now;
    return best;
}

// ──── Evaluate a single direction ────

function evaluateDirection(
    direction: SniperDirection,
    entry: number,
    klines: SniperKline[],
    multiIndicator: MultiIndicatorVerdict,
    smartMoney: SmartMoneyVerdict,
    regime: RegimeInfo,
    trap: TrapVerdict,
    htfMultiIndicator: MultiIndicatorVerdict,
    htfRegime: RegimeInfo,
    symbol: string,
    timeframe: SniperTimeframe,
    htfTimeframe: SniperTimeframe,
    flow: SniperFlow | null,
): DecisionResult {
    const reasons: string[] = [];

    // Score each component
    const indicatorsDetail = scoreIndicators(multiIndicator, flow, direction);
    const smartMoneyDetail = scoreSmartMoney(smartMoney, direction);
    const marketQualityDetail = scoreMarketQuality(regime, trap, direction);

    // HTF direction from multi-indicator
    const htfDirection = htfMultiIndicator.direction === "long" ? "bullish"
        : htfMultiIndicator.direction === "short" ? "bearish" : "neutral";
    const htfTrendStrength = regime.trendStrength;
    const htfDetail = scoreHTFBias(htfDirection, htfTrendStrength, htfTimeframe, direction);

    const learningDetail = scoreLearning(symbol, timeframe, direction, regime.regime);

    // Combine indicator scores
    const indicatorScore = Math.round(
        indicatorsDetail.rsi * 0.25 +
        indicatorsDetail.macd * 0.25 +
        indicatorsDetail.volume * 0.25 +
        indicatorsDetail.whaleFlow * 0.25
    );

    // Compute component scores for weighting
    const marketQualityScore = Math.round(
        (marketQualityDetail.regime.includes("trend") ? 30 : marketQualityDetail.regime === "range" ? 10 : -20)
        + marketQualityDetail.trendStrength * 0.3
        - (marketQualityDetail.trapDetected ? 40 : 0)
    );
    // Compute HTF score separately (htfDetail doesn't store it)
    const htfScore = !htfDetail.aligned && htfDetail.htfDirection !== "neutral"
        ? -50 - Math.round(htfTrendStrength * 0.3)
        : htfDetail.aligned
            ? 50 + Math.round(htfTrendStrength * 0.5)
            : 0;
    const learningScore = Math.round(learningDetail.adjustmentFactor * 50);

    // Apply weights with regime adjustment
    const weights = { ...SCORE_WEIGHTS, ...getRegimeWeightAdjustment(regime.regime) };
    const finalScore = Math.round(
        indicatorScore * weights.indicators +
        smartMoneyDetail.score * weights.smartMoney +
        marketQualityScore * weights.marketQuality +
        htfScore * weights.htfBias +
        learningScore * weights.learning
    );

    // Learning adjustment
    const learningAdj = learningDetail.adjustmentFactor;
    const adjustedScore = Math.round(finalScore * learningAdj);

    // TP/SL
    const atr = klines.slice(-14).reduce((a, k) => a + (k.high - k.low), 0) / 14;
    const { tp1, tp2, tp3, runner, sl, hardStop, rr } = calculateTargets(entry, direction, atr, regime, smartMoney);

    // Build reasons
    if (indicatorsDetail.rsi > 30) reasons.push(`RSI: ${indicatorsDetail.rsi > 0 ? "✓ متوافق" : "✗ معاكس"}`);
    if (smartMoneyDetail.bos) reasons.push("✓ BOS مؤكد");
    if (smartMoneyDetail.mss) reasons.push("✓ MSS مؤكد");
    if (smartMoneyDetail.orderBlock) reasons.push("✓ Order Block");
    if (smartMoneyDetail.fvg) reasons.push("✓ FVG");
    if (htfDetail.aligned) reasons.push(`✓ HTF ${htfTimeframe} متوافق`);
    else reasons.push(`✗ HTF ${htfTimeframe} معاكس`);
    if (trap.detected) reasons.push(`⚠ فخ: ${trap.types.join(", ")}`);
    if (learningAdj < 1) reasons.push(`⚠ تعليم: خصم ${(1 - learningAdj) * 100}%`);
    if (learningAdj > 1) reasons.push(`✓ تعليم: مكافأة ${(learningAdj - 1) * 100}%`);

    return {
        action: "no_trade", // will be set later
        score: {
            indicators: indicatorScore,
            smartMoney: smartMoneyDetail.score,
            marketQuality: marketQualityScore,
            htfBias: htfScore,
            learning: Math.round(learningAdj * 50),
            final: adjustedScore,
        },
        breakdown: {
            indicatorsDetail,
            smartMoneyDetail,
            marketQualityDetail,
            htfDetail,
            learningDetail,
        },
        confidence: 0,
        riskReward: rr,
        direction,
        entry,
        target1: tp1,
        target2: tp2,
        target3: tp3,
        runner,
        stopLoss: sl,
        hardStopLoss: hardStop,
        reasons,
        timestamp: Date.now(),
    };
}