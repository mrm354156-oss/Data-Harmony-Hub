// Learning Integration — V2
// Bridges existing self-learning systems with new Trading Engine components:
// - Smart Money analysis
// - Confidence Engine
// - Market Regime
// - Trade Results
//
// Learns not just Win/Loss but WHY:
// - Fake Breakout?
// - Against trend?
// - Near resistance?
// - Weak volume?
// - Choppy market?
// - No BOS?
// - No HTF confirmation?

import type { SniperSignal, SniperTimeframe, SniperDirection } from "./sniperEngine";
import type { MarketRegime, RegimeInfo } from "./qualityEngine";
import type { SmartMoneyVerdict } from "./smartMoneyEngine";
import type { ConfidenceResult } from "./confidenceEngine";
import type { BreakoutAnalysis } from "./fakeBreakoutEngine";

export interface LearningOutcome {
    signalId: string;
    symbol: string;
    timeframe: SniperTimeframe;
    direction: SniperDirection;
    entryPrice: number;
    exitPrice: number;
    outcome: "win" | "loss" | "breakeven";
    pnlPct: number;
    rMultiple: number;
    // V2 — Enhanced learning dimensions
    marketRegime: MarketRegime;
    confidenceScore: number;
    smartMoneyScore: number;
    qualityScore: number;
    regimeConfidence: number;
    // Failure reasons (if loss)
    failureReasons: FailureReason[];
    // Context at time of signal
    context: SignalContext;
}

export interface SignalContext {
    regime: RegimeInfo;
    smartMoney: SmartMoneyVerdict;
    confidence: ConfidenceResult;
    breakout: BreakoutAnalysis | null;
    volumeRatio: number;
    whaleFlowPct: number;
    rsi: number;
    patternPresent: boolean;
    trendAligned: boolean;
    nearResistance: boolean;
    nearSupport: boolean;
}

export type FailureReason =
    | "fake_breakout"
    | "against_trend"
    | "near_resistance"
    | "weak_volume"
    | "choppy_market"
    | "no_bos"
    | "no_htf_confirmation"
    | "low_confidence"
    | "bad_rr"
    | "whale_divergence"
    | "wick_rejection"
    | "liquidity_grab"
    | "exhaustion"
    | "regime_mismatch"
    | "unknown";

export interface LearningPattern {
    pattern: string;
    winRate: number;
    sampleSize: number;
    recommendation: string;
    confidence: number;
}

export interface LearningStats {
    totalTrades: number;
    wins: number;
    losses: number;
    winRate: number;
    avgRMultiple: number;
    bestRegime: MarketRegime | null;
    worstRegime: MarketRegime | null;
    bestTimeframe: SniperTimeframe | null;
    mostFailedSetup: FailureReason | null;
    patterns: LearningPattern[];
    regimePerformance: Record<MarketRegime, { wins: number; losses: number; winRate: number }>;
}

// Storage key
const LEARNING_KEY = "sniper.learningIntegration.v2";

// Analyze why a trade failed
export function analyzeFailureReasons(
    signal: SniperSignal,
    context: SignalContext,
    outcome: "win" | "loss",
): FailureReason[] {
    if (outcome === "win") return [];

    const reasons: FailureReason[] = [];

    // 1. Fake Breakout
    if (context.breakout?.signal.type === "fake") {
        reasons.push("fake_breakout");
    }

    // 2. Against Trend
    if (!context.trendAligned) {
        reasons.push("against_trend");
    }

    // 3. Near Resistance
    if (context.nearResistance && signal.direction === "long") {
        reasons.push("near_resistance");
    }

    // 4. Weak Volume
    if (context.volumeRatio < 1.2) {
        reasons.push("weak_volume");
    }

    // 5. Choppy Market
    if (context.regime.regime === "choppy" || context.regime.regime === "squeeze") {
        reasons.push("choppy_market");
    }

    // 6. No BOS
    if (!context.smartMoney.hasBOS) {
        reasons.push("no_bos");
    }

    // 7. Low Confidence
    if (context.confidence.score < 60) {
        reasons.push("low_confidence");
    }

    // 8. Bad R:R
    if (signal.riskReward < 1.5) {
        reasons.push("bad_rr");
    }

    // 9. Whale Divergence
    const whaleAligned = signal.direction === "long"
        ? context.whaleFlowPct > 0
        : context.whaleFlowPct < 0;
    if (!whaleAligned) {
        reasons.push("whale_divergence");
    }

    // 10. Wick Rejection
    const lastCandle = context.regime; // placeholder
    if (signal.direction === "long" && context.rsi > 70) {
        reasons.push("wick_rejection");
    }

    // 11. Regime Mismatch
    const isGoodRegime = ["trend_up", "trend_down", "strong_trend_up", "strong_trend_down"].includes(context.regime.regime);
    if (!isGoodRegime && context.regime.confidenceInRegime > 70) {
        reasons.push("regime_mismatch");
    }

    return reasons.length > 0 ? reasons : ["unknown"];
}

// Record a learning outcome
export function recordLearningOutcome(outcome: LearningOutcome): void {
    try {
        const existing = loadLearningOutcomes();
        existing.push(outcome);

        // Keep last 500 outcomes
        const trimmed = existing.slice(-500);
        localStorage.setItem(LEARNING_KEY, JSON.stringify(trimmed));
    } catch {
        // ignore storage errors
    }
}

// Load all learning outcomes
export function loadLearningOutcomes(): LearningOutcome[] {
    try {
        const raw = localStorage.getItem(LEARNING_KEY);
        if (raw) return JSON.parse(raw);
    } catch {
        // ignore
    }
    return [];
}

// Get learning statistics
export function getLearningStats(): LearningStats {
    const outcomes = loadLearningOutcomes();

    if (outcomes.length === 0) {
        return {
            totalTrades: 0,
            wins: 0,
            losses: 0,
            winRate: 0,
            avgRMultiple: 0,
            bestRegime: null,
            worstRegime: null,
            bestTimeframe: null,
            mostFailedSetup: null,
            patterns: [],
            regimePerformance: {} as any,
        };
    }

    const wins = outcomes.filter(o => o.outcome === "win").length;
    const losses = outcomes.filter(o => o.outcome === "loss").length;
    const winRate = wins / outcomes.length;

    const avgRMultiple = outcomes.reduce((a, o) => a + o.rMultiple, 0) / outcomes.length;

    // Regime performance
    const regimePerf: Record<string, { wins: number; losses: number; winRate: number }> = {};
    for (const o of outcomes) {
        if (!regimePerf[o.marketRegime]) {
            regimePerf[o.marketRegime] = { wins: 0, losses: 0, winRate: 0 };
        }
        if (o.outcome === "win") regimePerf[o.marketRegime].wins++;
        else if (o.outcome === "loss") regimePerf[o.marketRegime].losses++;
    }
    for (const [regime, perf] of Object.entries(regimePerf)) {
        const total = perf.wins + perf.losses;
        perf.winRate = total > 0 ? perf.wins / total : 0;
    }

    // Best/worst regime
    let bestRegime: MarketRegime | null = null;
    let worstRegime: MarketRegime | null = null;
    let bestWinRate = 0;
    let worstWinRate = 1;
    for (const [regime, perf] of Object.entries(regimePerf)) {
        if (perf.winRate > bestWinRate && perf.wins + perf.losses >= 3) {
            bestWinRate = perf.winRate;
            bestRegime = regime as MarketRegime;
        }
        if (perf.winRate < worstWinRate && perf.wins + perf.losses >= 3) {
            worstWinRate = perf.winRate;
            worstRegime = regime as MarketRegime;
        }
    }

    // Most failed setup
    const failureCounts: Record<FailureReason, number> = {} as any;
    for (const o of outcomes) {
        for (const r of o.failureReasons) {
            failureCounts[r] = (failureCounts[r] || 0) + 1;
        }
    }
    let mostFailedSetup: FailureReason | null = null;
    let maxFailures = 0;
    for (const [reason, count] of Object.entries(failureCounts)) {
        if (count > maxFailures) {
            maxFailures = count;
            mostFailedSetup = reason as FailureReason;
        }
    }

    // Best timeframe
    const tfPerf: Record<string, { wins: number; losses: number }> = {};
    for (const o of outcomes) {
        if (!tfPerf[o.timeframe]) tfPerf[o.timeframe] = { wins: 0, losses: 0 };
        if (o.outcome === "win") tfPerf[o.timeframe].wins++;
        else if (o.outcome === "loss") tfPerf[o.timeframe].losses++;
    }
    let bestTimeframe: SniperTimeframe | null = null;
    let bestTfWinRate = 0;
    for (const [tf, perf] of Object.entries(tfPerf)) {
        const total = perf.wins + perf.losses;
        const wr = total > 0 ? perf.wins / total : 0;
        if (wr > bestTfWinRate && total >= 3) {
            bestTfWinRate = wr;
            bestTimeframe = tf as SniperTimeframe;
        }
    }

    // Generate patterns
    const patterns = generateLearningPatterns(outcomes);

    return {
        totalTrades: outcomes.length,
        wins,
        losses,
        winRate,
        avgRMultiple,
        bestRegime,
        worstRegime,
        bestTimeframe,
        mostFailedSetup,
        patterns,
        regimePerformance: regimePerf as any,
    };
}

// Generate learning patterns from outcomes
function generateLearningPatterns(outcomes: LearningOutcome[]): LearningPattern[] {
    const patterns: LearningPattern[] = [];

    // Pattern 1: High confidence + good regime = best results
    const highConfGoodRegime = outcomes.filter(o =>
        o.confidenceScore >= 70 &&
        ["trend_up", "trend_down", "strong_trend_up", "strong_trend_down"].includes(o.marketRegime)
    );
    if (highConfGoodRegime.length >= 5) {
        const wins = highConfGoodRegime.filter(o => o.outcome === "win").length;
        patterns.push({
            pattern: "ثقة عالية + ترند قوي",
            winRate: wins / highConfGoodRegime.length,
            sampleSize: highConfGoodRegime.length,
            recommendation: "فرص ممتازة — زيادة الحجم",
            confidence: Math.min(100, 50 + highConfGoodRegime.length * 2),
        });
    }

    // Pattern 2: Low confidence + choppy = bad results
    const lowConfChoppy = outcomes.filter(o =>
        o.confidenceScore < 50 &&
        (o.marketRegime === "choppy" || o.marketRegime === "squeeze")
    );
    if (lowConfChoppy.length >= 3) {
        const wins = lowConfChoppy.filter(o => o.outcome === "win").length;
        patterns.push({
            pattern: "ثقة منخفضة + سوق عشوائي",
            winRate: wins / lowConfChoppy.length,
            sampleSize: lowConfChoppy.length,
            recommendation: "تجنب هذه الصفقات",
            confidence: Math.min(100, 60 + lowConfChoppy.length * 2),
        });
    }

    // Pattern 3: No BOS = lower win rate
    const noBOS = outcomes.filter(o => !o.context.smartMoney.hasBOS);
    if (noBOS.length >= 5) {
        const wins = noBOS.filter(o => o.outcome === "win").length;
        patterns.push({
            pattern: "بدون BOS",
            winRate: wins / noBOS.length,
            sampleSize: noBOS.length,
            recommendation: "تأكد من وجود BOS قبل الدخول",
            confidence: Math.min(100, 50 + noBOS.length * 2),
        });
    }

    // Pattern 4: Against trend = bad
    const againstTrend = outcomes.filter(o => !o.context.trendAligned);
    if (againstTrend.length >= 5) {
        const wins = againstTrend.filter(o => o.outcome === "win").length;
        patterns.push({
            pattern: "ضد الترند",
            winRate: wins / againstTrend.length,
            sampleSize: againstTrend.length,
            recommendation: "تجنب الدخول ضد الترند",
            confidence: Math.min(100, 50 + againstTrend.length * 2),
        });
    }

    return patterns;
}

// Get adjustment recommendations based on learning
export function getLearningAdjustments(): {
    confidenceThreshold: number;
    riskMultiplier: number;
    avoidRegimes: MarketRegime[];
    avoidTimeframes: SniperTimeframe[];
    requireBOS: boolean;
    requireTrendAlignment: boolean;
} {
    const stats = getLearningStats();

    // Default values
    let adjustments = {
        confidenceThreshold: 56,
        riskMultiplier: 1.0,
        avoidRegimes: [] as MarketRegime[],
        avoidTimeframes: [] as SniperTimeframe[],
        requireBOS: false,
        requireTrendAlignment: false,
    };

    // If we have enough data, adjust
    if (stats.totalTrades >= 10) {
        // If win rate is low, raise threshold
        if (stats.winRate < 0.4) {
            adjustments.confidenceThreshold = 65;
            adjustments.riskMultiplier = 0.7;
        } else if (stats.winRate < 0.5) {
            adjustments.confidenceThreshold = 60;
            adjustments.riskMultiplier = 0.85;
        }

        // Avoid worst regime
        if (stats.worstRegime && stats.regimePerformance[stats.worstRegime]?.winRate < 0.3) {
            adjustments.avoidRegimes.push(stats.worstRegime);
        }

        // Avoid worst timeframe
        if (stats.bestTimeframe) {
            // Focus on best timeframe
            adjustments.avoidTimeframes = ["1m", "3m"] as SniperTimeframe[];
        }

        // If "no_bos" is a major failure reason, require BOS
        const noBOSFailures = stats.patterns.find(p => p.pattern === "بدون BOS");
        if (noBOSFailures && noBOSFailures.winRate < 0.35) {
            adjustments.requireBOS = true;
        }

        // If "against_trend" is a major failure, require trend alignment
        const againstTrendFailures = stats.patterns.find(p => p.pattern === "ضد الترند");
        if (againstTrendFailures && againstTrendFailures.winRate < 0.3) {
            adjustments.requireTrendAlignment = true;
        }
    }

    return adjustments;
}

// Clear learning data
export function clearLearningData(): void {
    try {
        localStorage.removeItem(LEARNING_KEY);
    } catch {
        // ignore
    }
}

// Get failure reason label in Arabic
export function getFailureReasonLabel(reason: FailureReason): string {
    const labels: Record<FailureReason, string> = {
        fake_breakout: "اختراق وهمي",
        against_trend: "ضد الترند",
        near_resistance: "قرب مقاومة",
        weak_volume: "فوليوم ضعيف",
        choppy_market: "سوق عشوائي",
        no_bos: "بدون BOS",
        no_htf_confirmation: "بدون تأكيد HTF",
        low_confidence: "ثقة منخفضة",
        bad_rr: "R:R سيء",
        whale_divergence: "تناقض الحيتان",
        wick_rejection: "رفض ظل",
        liquidity_grab: "اصطياد سيولة",
        exhaustion: "إنهاك",
        regime_mismatch: "نظام غير متوافق",
        unknown: "غير معروف",
    };
    return labels[reason];
}