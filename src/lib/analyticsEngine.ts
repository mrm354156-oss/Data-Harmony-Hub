// Analytics Engine — V2
// Professional analytics dashboard for trading performance:
// - Win Rate, RR Average, Profit Factor
// - Drawdown Analysis
// - Best/Worst Timeframe
// - Best/Worst Market Regime
// - Most Failed Setup
// - TP Hit Ratio, SL Hit Ratio
// - Fake Breakout Frequency

import type { SniperTimeframe, SniperDirection } from "./sniperEngine";
import type { MarketRegime } from "./qualityEngine";
import type { LearningOutcome, FailureReason } from "./learningIntegration";

export interface AnalyticsData {
    // Overview
    totalTrades: number;
    wins: number;
    losses: number;
    breakevens: number;
    winRate: number;
    avgRMultiple: number;
    totalPnlPct: number;

    // Risk Metrics
    profitFactor: number;
    expectancy: number;
    maxDrawdownPct: number;
    sharpeRatio: number;
    calmarRatio: number;

    // Trade Distribution
    avgWinPct: number;
    avgLossPct: number;
    largestWinPct: number;
    largestLossPct: number;
    avgHoldTime: number;

    // TP/SL Analysis
    tp1HitRatio: number;
    tp2HitRatio: number;
    tp3HitRatio: number;
    slHitRatio: number;
    runnerHitRatio: number;

    // Regime Analysis
    regimeBreakdown: Record<MarketRegime, {
        trades: number;
        wins: number;
        winRate: number;
        avgPnl: number;
    }>;

    // Timeframe Analysis
    timeframeBreakdown: Record<SniperTimeframe, {
        trades: number;
        wins: number;
        winRate: number;
        avgPnl: number;
    }>;

    // Failure Analysis
    failureBreakdown: Record<FailureReason, {
        count: number;
        percentage: number;
    }>;
    mostFailedSetup: FailureReason | null;

    // Direction Analysis
    longTrades: number;
    shortTrades: number;
    longWinRate: number;
    shortWinRate: number;

    // Confidence Analysis
    confidenceBuckets: Array<{
        range: string;
        trades: number;
        winRate: number;
    }>;

    // Streak Analysis
    maxWinStreak: number;
    maxLossStreak: number;
    currentStreak: number;
    currentStreakType: "win" | "loss" | "none";

    // Fake Breakout Frequency
    fakeBreakoutFrequency: number;

    // Performance by Smart Money Score
    smartMoneyBuckets: Array<{
        range: string;
        trades: number;
        winRate: number;
    }>;
}

// Calculate comprehensive analytics
export function calculateAnalytics(outcomes: LearningOutcome[]): AnalyticsData {
    if (outcomes.length === 0) {
        return getEmptyAnalytics();
    }

    // Overview
    const wins = outcomes.filter(o => o.outcome === "win");
    const losses = outcomes.filter(o => o.outcome === "loss");
    const breakevens = outcomes.filter(o => o.outcome === "breakeven");
    const winRate = wins.length / outcomes.length;
    const avgRMultiple = outcomes.reduce((a, o) => a + o.rMultiple, 0) / outcomes.length;
    const totalPnlPct = outcomes.reduce((a, o) => a + o.pnlPct, 0);

    // Risk Metrics
    const grossWins = wins.reduce((a, o) => a + o.pnlPct, 0);
    const grossLosses = Math.abs(losses.reduce((a, o) => a + o.pnlPct, 0));
    const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? 999 : 0;
    const expectancy = totalPnlPct / outcomes.length;

    // Drawdown
    let peak = 0;
    let maxDrawdown = 0;
    let running = 0;
    for (const o of outcomes) {
        running += o.pnlPct;
        peak = Math.max(peak, running);
        const dd = peak - running;
        maxDrawdown = Math.max(maxDrawdown, dd);
    }
    const maxDrawdownPct = maxDrawdown;

    // Sharpe (simplified)
    const returns = outcomes.map(o => o.pnlPct);
    const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, b) => a + (b - meanReturn) ** 2, 0) / returns.length;
    const stdDev = Math.sqrt(variance);
    const sharpeRatio = stdDev > 0 ? meanReturn / stdDev : 0;

    // Calmar
    const calmarRatio = maxDrawdownPct > 0 ? (totalPnlPct / maxDrawdownPct) : 0;

    // Win/Loss stats
    const avgWinPct = wins.length > 0 ? wins.reduce((a, o) => a + o.pnlPct, 0) / wins.length : 0;
    const avgLossPct = losses.length > 0 ? losses.reduce((a, o) => a + o.pnlPct, 0) / losses.length : 0;
    const largestWinPct = wins.length > 0 ? Math.max(...wins.map(o => o.pnlPct)) : 0;
    const largestLossPct = losses.length > 0 ? Math.min(...losses.map(o => o.pnlPct)) : 0;

    // TP/SL ratios (simulated from outcomes)
    const tp1HitRatio = wins.length / outcomes.length;
    const tp2HitRatio = wins.filter(o => o.pnlPct > 1).length / outcomes.length;
    const tp3HitRatio = wins.filter(o => o.pnlPct > 2).length / outcomes.length;
    const slHitRatio = losses.length / outcomes.length;
    const runnerHitRatio = wins.filter(o => o.pnlPct > 3).length / outcomes.length;

    // Regime breakdown
    const regimeBreakdown: AnalyticsData["regimeBreakdown"] = {} as any;
    for (const o of outcomes) {
        if (!regimeBreakdown[o.marketRegime]) {
            regimeBreakdown[o.marketRegime] = { trades: 0, wins: 0, winRate: 0, avgPnl: 0 };
        }
        regimeBreakdown[o.marketRegime].trades++;
        if (o.outcome === "win") regimeBreakdown[o.marketRegime].wins++;
        regimeBreakdown[o.marketRegime].avgPnl += o.pnlPct;
    }
    for (const [regime, data] of Object.entries(regimeBreakdown)) {
        data.winRate = data.trades > 0 ? data.wins / data.trades : 0;
        data.avgPnl = data.trades > 0 ? data.avgPnl / data.trades : 0;
    }

    // Timeframe breakdown
    const timeframeBreakdown: AnalyticsData["timeframeBreakdown"] = {} as any;
    for (const o of outcomes) {
        if (!timeframeBreakdown[o.timeframe]) {
            timeframeBreakdown[o.timeframe] = { trades: 0, wins: 0, winRate: 0, avgPnl: 0 };
        }
        timeframeBreakdown[o.timeframe].trades++;
        if (o.outcome === "win") timeframeBreakdown[o.timeframe].wins++;
        timeframeBreakdown[o.timeframe].avgPnl += o.pnlPct;
    }
    for (const [tf, data] of Object.entries(timeframeBreakdown)) {
        data.winRate = data.trades > 0 ? data.wins / data.trades : 0;
        data.avgPnl = data.trades > 0 ? data.avgPnl / data.trades : 0;
    }

    // Failure breakdown
    const failureBreakdown: AnalyticsData["failureBreakdown"] = {} as any;
    for (const o of outcomes) {
        for (const reason of o.failureReasons) {
            if (!failureBreakdown[reason]) {
                failureBreakdown[reason] = { count: 0, percentage: 0 };
            }
            failureBreakdown[reason].count++;
        }
    }
    const totalFailures = Object.values(failureBreakdown).reduce((a, b) => a + b.count, 0);
    for (const data of Object.values(failureBreakdown)) {
        data.percentage = totalFailures > 0 ? data.count / totalFailures : 0;
    }

    // Most failed setup
    let mostFailedSetup: FailureReason | null = null;
    let maxFailures = 0;
    for (const [reason, data] of Object.entries(failureBreakdown)) {
        if (data.count > maxFailures) {
            maxFailures = data.count;
            mostFailedSetup = reason as FailureReason;
        }
    }

    // Direction analysis
    const longTrades = outcomes.filter(o => o.direction === "long").length;
    const shortTrades = outcomes.filter(o => o.direction === "short").length;
    const longWins = outcomes.filter(o => o.direction === "long" && o.outcome === "win").length;
    const shortWins = outcomes.filter(o => o.direction === "short" && o.outcome === "win").length;
    const longWinRate = longTrades > 0 ? longWins / longTrades : 0;
    const shortWinRate = shortTrades > 0 ? shortWins / shortTrades : 0;

    // Confidence buckets
    const confidenceBuckets = calculateConfidenceBuckets(outcomes);

    // Streak analysis
    const { maxWinStreak, maxLossStreak, currentStreak, currentStreakType } = calculateStreaks(outcomes);

    // Fake breakout frequency
    const fakeBreakoutCount = outcomes.filter(o =>
        o.failureReasons.includes("fake_breakout")
    ).length;
    const fakeBreakoutFrequency = outcomes.length > 0 ? fakeBreakoutCount / outcomes.length : 0;

    // Smart money buckets
    const smartMoneyBuckets = calculateSmartMoneyBuckets(outcomes);

    return {
        totalTrades: outcomes.length,
        wins: wins.length,
        losses: losses.length,
        breakevens: breakevens.length,
        winRate,
        avgRMultiple,
        totalPnlPct,
        profitFactor,
        expectancy,
        maxDrawdownPct,
        sharpeRatio,
        calmarRatio,
        avgWinPct,
        avgLossPct,
        largestWinPct,
        largestLossPct,
        avgHoldTime: 0,
        tp1HitRatio,
        tp2HitRatio,
        tp3HitRatio,
        slHitRatio,
        runnerHitRatio,
        regimeBreakdown,
        timeframeBreakdown,
        failureBreakdown,
        mostFailedSetup,
        longTrades,
        shortTrades,
        longWinRate,
        shortWinRate,
        confidenceBuckets,
        maxWinStreak,
        maxLossStreak,
        currentStreak,
        currentStreakType,
        fakeBreakoutFrequency,
        smartMoneyBuckets,
    };
}

// Calculate confidence buckets
function calculateConfidenceBuckets(outcomes: LearningOutcome[]): AnalyticsData["confidenceBuckets"] {
    const buckets = [
        { min: 0, max: 30, range: "0-30%" },
        { min: 30, max: 50, range: "30-50%" },
        { min: 50, max: 70, range: "50-70%" },
        { min: 70, max: 85, range: "70-85%" },
        { min: 85, max: 100, range: "85-100%" },
    ];

    return buckets.map(bucket => {
        const bucketOutcomes = outcomes.filter(o =>
            o.confidenceScore >= bucket.min && o.confidenceScore < bucket.max
        );
        const wins = bucketOutcomes.filter(o => o.outcome === "win").length;
        return {
            range: bucket.range,
            trades: bucketOutcomes.length,
            winRate: bucketOutcomes.length > 0 ? wins / bucketOutcomes.length : 0,
        };
    });
}

// Calculate streaks
function calculateStreaks(outcomes: LearningOutcome[]): {
    maxWinStreak: number;
    maxLossStreak: number;
    currentStreak: number;
    currentStreakType: "win" | "loss" | "none";
} {
    if (outcomes.length === 0) {
        return { maxWinStreak: 0, maxLossStreak: 0, currentStreak: 0, currentStreakType: "none" };
    }

    let maxWinStreak = 0;
    let maxLossStreak = 0;
    let currentWinStreak = 0;
    let currentLossStreak = 0;

    for (const o of outcomes) {
        if (o.outcome === "win") {
            currentWinStreak++;
            currentLossStreak = 0;
            maxWinStreak = Math.max(maxWinStreak, currentWinStreak);
        } else if (o.outcome === "loss") {
            currentLossStreak++;
            currentWinStreak = 0;
            maxLossStreak = Math.max(maxLossStreak, currentLossStreak);
        } else {
            currentWinStreak = 0;
            currentLossStreak = 0;
        }
    }

    // Current streak (from end)
    let currentStreak = 0;
    let currentStreakType: "win" | "loss" | "none" = "none";
    for (let i = outcomes.length - 1; i >= 0; i--) {
        const o = outcomes[i];
        if (o.outcome === "win") {
            if (currentStreakType === "win" || currentStreakType === "none") {
                currentStreak++;
                currentStreakType = "win";
            } else break;
        } else if (o.outcome === "loss") {
            if (currentStreakType === "loss" || currentStreakType === "none") {
                currentStreak++;
                currentStreakType = "loss";
            } else break;
        } else break;
    }

    return { maxWinStreak, maxLossStreak, currentStreak, currentStreakType };
}

// Calculate smart money buckets
function calculateSmartMoneyBuckets(outcomes: LearningOutcome[]): AnalyticsData["smartMoneyBuckets"] {
    const buckets = [
        { min: 0, max: 30, range: "0-30" },
        { min: 30, max: 50, range: "30-50" },
        { min: 50, max: 70, range: "50-70" },
        { min: 70, max: 85, range: "70-85" },
        { min: 85, max: 100, range: "85-100" },
    ];

    return buckets.map(bucket => {
        const bucketOutcomes = outcomes.filter(o =>
            o.smartMoneyScore >= bucket.min && o.smartMoneyScore < bucket.max
        );
        const wins = bucketOutcomes.filter(o => o.outcome === "win").length;
        return {
            range: bucket.range,
            trades: bucketOutcomes.length,
            winRate: bucketOutcomes.length > 0 ? wins / bucketOutcomes.length : 0,
        };
    });
}

// Empty analytics
function getEmptyAnalytics(): AnalyticsData {
    return {
        totalTrades: 0,
        wins: 0,
        losses: 0,
        breakevens: 0,
        winRate: 0,
        avgRMultiple: 0,
        totalPnlPct: 0,
        profitFactor: 0,
        expectancy: 0,
        maxDrawdownPct: 0,
        sharpeRatio: 0,
        calmarRatio: 0,
        avgWinPct: 0,
        avgLossPct: 0,
        largestWinPct: 0,
        largestLossPct: 0,
        avgHoldTime: 0,
        tp1HitRatio: 0,
        tp2HitRatio: 0,
        tp3HitRatio: 0,
        slHitRatio: 0,
        runnerHitRatio: 0,
        regimeBreakdown: {} as any,
        timeframeBreakdown: {} as any,
        failureBreakdown: {} as any,
        mostFailedSetup: null,
        longTrades: 0,
        shortTrades: 0,
        longWinRate: 0,
        shortWinRate: 0,
        confidenceBuckets: [],
        maxWinStreak: 0,
        maxLossStreak: 0,
        currentStreak: 0,
        currentStreakType: "none",
        fakeBreakoutFrequency: 0,
        smartMoneyBuckets: [],
    };
}

// Get analytics summary in Arabic
export function getAnalyticsSummary(data: AnalyticsData): string[] {
    const summary: string[] = [];

    summary.push(`📊 إجمالي الصفقات: ${data.totalTrades}`);
    summary.push(`✅ صفقات رابحة: ${data.wins} (${(data.winRate * 100).toFixed(1)}%)`);
    summary.push(`❌ صفقات خاسرة: ${data.losses}`);
    summary.push(`📈 متوسط R:R: ${data.avgRMultiple.toFixed(2)}`);
    summary.push(`💰 إجمالي الربح: ${data.totalPnlPct.toFixed(2)}%`);
    summary.push(`📉 أقصى تراجع: ${data.maxDrawdownPct.toFixed(2)}%`);
    summary.push(`📊 عامل الربح: ${data.profitFactor.toFixed(2)}`);

    if (data.mostFailedSetup) {
        summary.push(`⚠️ أكثر إخفاق: ${data.mostFailedSetup}`);
    }

    // Find best timeframe from breakdown
    const bestTf = Object.entries(data.timeframeBreakdown)
        .filter(([_, d]) => d.trades >= 3)
        .sort((a, b) => b[1].winRate - a[1].winRate)[0];
    if (bestTf) {
        summary.push(`⏰ أفضل فريم: ${bestTf[0]} (${(bestTf[1].winRate * 100).toFixed(1)}%)`);
    }

    return summary;
}

// Get performance grade
export function getPerformanceGrade(data: AnalyticsData): {
    grade: "A+" | "A" | "B+" | "B" | "C" | "D";
    label: string;
    color: string;
} {
    if (data.winRate >= 0.65 && data.profitFactor >= 2.0 && data.maxDrawdownPct < 10) {
        return { grade: "A+", label: "ممتاز", color: "text-green-400" };
    }
    if (data.winRate >= 0.55 && data.profitFactor >= 1.5 && data.maxDrawdownPct < 15) {
        return { grade: "A", label: "جيد جداً", color: "text-green-300" };
    }
    if (data.winRate >= 0.50 && data.profitFactor >= 1.2 && data.maxDrawdownPct < 20) {
        return { grade: "B+", label: "جيد", color: "text-yellow-400" };
    }
    if (data.winRate >= 0.45 && data.profitFactor >= 1.0) {
        return { grade: "B", label: "مقبول", color: "text-yellow-300" };
    }
    if (data.winRate >= 0.40) {
        return { grade: "C", label: "ضعيف", color: "text-orange-400" };
    }
    return { grade: "D", label: "ضعيف جداً", color: "text-red-400" };
}