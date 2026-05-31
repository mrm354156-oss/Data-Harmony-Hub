// Trade Manager — V1
// Advanced trade management: trailing stops, partial exits, early exits
// Integrates with existing useSniperLog system

import type { SniperKline, SniperTimeframe, SniperDirection } from "./sniperEngine";
import type { MarketRegime } from "./qualityEngine";

export interface TradeState {
    id: string;
    symbol: string;
    direction: SniperDirection;
    timeframe: SniperTimeframe;
    entry: number;
    stopLoss: number;
    hardStopLoss: number;
    target1: number;
    target2: number;
    target3: number;
    runnerTarget: number;
    currentPrice: number;
    highestPnl: number;
    lowestPnl: number;
    phase: "entry" | "t1_hit" | "t2_hit" | "trailing" | "runner" | "exit";
    trailingStop: number;
    partialExitDone: boolean;
    candlesInTrade: number;
    maxCandlesAllowed: number;
    regime: MarketRegime;
    // V2 — enhanced fields
    volumeAtEntry: number;
    volumeNow: number;
    momentumScore: number;       // 0-100, current momentum
    SmartMoneyScore: number;      // 0-100, smart money alignment
    confidenceScore: number;     // 0-100, overall confidence
    trailingActivated: boolean;
    breakEvenHit: boolean;
    runnerActive: boolean;
    partialExitCount: number;    // how many partial exits done
}

export interface TradeAction {
    type: "hold" | "partial_exit" | "full_exit" | "move_sl" | "trailing_update" | "runner_exit" | "early_exit" | "momentum_exit";
    reason: string;
    newStopLoss?: number;
    exitPercent?: number;
    urgency: "low" | "medium" | "high";
    // V2 — enhanced fields
    partialPercent?: number;     // for partial exits
    trailingStep?: number;       // trailing stop step size
    exitType?: "tp1" | "tp2" | "tp3" | "runner" | "breakeven" | "trailing" | "momentum" | "reversal" | "time";
}

// Calculate dynamic TP levels based on regime + ATR
export function calculateDynamicTPs(
    entry: number,
    direction: SniperDirection,
    atr: number,
    regime: MarketRegime,
    smartMoneyScore: number,
): { tp1: number; tp2: number; tp3: number; runner: number } {
    const regimeMultiplier: Record<MarketRegime, number> = {
        trend_up: 1.3,
        trend_down: 1.2,
        strong_trend_up: 1.5,
        strong_trend_down: 1.4,
        range: 0.8,
        volatile: 1.4,
        choppy: 0.7,
        squeeze: 1.1,
        low_liquidity: 0.6,
    };

    const mult = regimeMultiplier[regime] || 1.0;
    const smBonus = smartMoneyScore >= 50 ? 1.1 : 1.0;

    if (direction === "long") {
        return {
            tp1: entry + atr * 0.8 * mult * smBonus,
            tp2: entry + atr * 1.5 * mult * smBonus,
            tp3: entry + atr * 2.5 * mult * smBonus,
            runner: entry + atr * 4.0 * mult * smBonus,
        };
    } else {
        return {
            tp1: entry - atr * 0.8 * mult * smBonus,
            tp2: entry - atr * 1.5 * mult * smBonus,
            tp3: entry - atr * 2.5 * mult * smBonus,
            runner: entry - atr * 4.0 * mult * smBonus,
        };
    }
}

// Calculate dynamic SL based on regime + structure
export function calculateDynamicSL(
    entry: number,
    direction: SniperDirection,
    atr: number,
    regime: MarketRegime,
    recentSwingHigh: number,
    recentSwingLow: number,
): { stopLoss: number; hardStop: number } {
    if (direction === "long") {
        // SL below recent swing low, but at least 1.2× ATR
        const swingSL = recentSwingLow - atr * 0.2;
        const atrSL = entry - atr * 1.2;
        const stopLoss = Math.max(swingSL, atrSL);
        const hardStop = entry - atr * 2.0;
        return { stopLoss, hardStop };
    } else {
        // SL above recent swing high, but at least 1.2× ATR
        const swingSL = recentSwingHigh + atr * 0.2;
        const atrSL = entry + atr * 1.2;
        const stopLoss = Math.min(swingSL, atrSL);
        const hardStop = entry + atr * 2.0;
        return { stopLoss, hardStop };
    }
}

// V2 — Dynamic momentum score calculation
function calculateMomentum(klines: SniperKline[], direction: SniperDirection): number {
    if (klines.length < 5) return 50;

    const recent = klines.slice(-5);
    let score = 50;

    // Price momentum
    const priceChange = direction === "long"
        ? (recent[4].close - recent[0].open) / recent[0].open * 100
        : (recent[0].open - recent[4].close) / recent[0].open * 100;

    if (priceChange > 0.5) score += 20;
    else if (priceChange > 0.2) score += 10;
    else if (priceChange < -0.2) score -= 15;

    // Volume momentum
    const avgVol = recent.reduce((a, k) => a + k.volume, 0) / recent.length;
    const lastVol = recent[4].volume;
    if (lastVol > avgVol * 1.5) score += 15;
    else if (lastVol < avgVol * 0.7) score -= 10;

    // Candle strength
    const last = recent[4];
    const bodyPct = (last.high - last.low) > 0
        ? Math.abs(last.close - last.open) / (last.high - last.low) : 0;
    if (bodyPct > 0.7) score += 15;

    return Math.max(0, Math.min(100, score));
}

// V2 — Smart trailing stop with dynamic step
function calculateTrailingStop(
    trade: TradeState,
    currentPrice: number,
    regime: MarketRegime,
): number {
    const atrStep = regime === "volatile" ? 0.02 : regime === "choppy" ? 0.008 : 0.012;

    if (trade.direction === "long") {
        const trailLevel = currentPrice * (1 - atrStep);
        return Math.max(trade.trailingStop, trailLevel);
    } else {
        const trailLevel = currentPrice * (1 + atrStep);
        return Math.min(trade.trailingStop, trailLevel);
    }
}

// V2 — Detect momentum exhaustion
function detectMomentumExhaustion(klines: SniperKline[], direction: SniperDirection): boolean {
    if (klines.length < 3) return false;

    const last3 = klines.slice(-3);
    const bodies = last3.map(k => Math.abs(k.close - k.open));
    const ranges = last3.map(k => k.high - k.low);

    // Shrinking bodies + expanding ranges = exhaustion
    const shrinkingBodies = bodies[2] < bodies[1] && bodies[1] < bodies[0];
    const expandingRanges = ranges[2] > ranges[1] && ranges[1] > ranges[0];

    return shrinkingBodies && expandingRanges;
}

// Main trade management function — V2 Enhanced
export function manageTrade(
    trade: TradeState,
    currentCandles: SniperKline[],
    regime: MarketRegime,
): TradeAction {
    const last = currentCandles[currentCandles.length - 1];
    if (!last) return { type: "hold", reason: "لا توجد بيانات", urgency: "low" };

    const pnlPct = trade.direction === "long"
        ? ((last.close - trade.entry) / trade.entry) * 100
        : ((trade.entry - last.close) / trade.entry) * 100;

    // Update trade state
    trade.highestPnl = Math.max(trade.highestPnl, pnlPct);
    trade.lowestPnl = Math.min(trade.lowestPnl, pnlPct);
    trade.currentPrice = last.close;
    trade.candlesInTrade++;
    trade.momentumScore = calculateMomentum(currentCandles, trade.direction);

    // 1. T1 HIT — partial exit + move SL to break-even
    if (trade.phase === "entry" && !trade.partialExitDone) {
        const t1Hit = trade.direction === "long"
            ? last.high >= trade.target1
            : last.low <= trade.target1;

        if (t1Hit) {
            trade.phase = "t1_hit";
            trade.partialExitDone = true;
            trade.breakEvenHit = true;
            trade.trailingStop = trade.entry; // Move SL to break-even
            trade.partialExitCount++;
            return {
                type: "partial_exit",
                reason: `T1 وصل — خروج جزئي 50% ونقل SL إلى Break-Even`,
                exitPercent: 50,
                partialPercent: 50,
                newStopLoss: trade.entry,
                urgency: "high",
                exitType: "tp1",
            };
        }
    }

    // 2. T2 HIT — another partial exit
    if (trade.phase === "t1_hit" || trade.phase === "trailing") {
        const t2Hit = trade.direction === "long"
            ? last.high >= trade.target2
            : last.low <= trade.target2;

        if (t2Hit && trade.partialExitCount < 2) {
            trade.phase = "t2_hit";
            trade.partialExitCount++;
            return {
                type: "partial_exit",
                reason: `T2 وصل — خروج جزئي إضافي 25%`,
                exitPercent: 25,
                partialPercent: 25,
                urgency: "high",
                exitType: "tp2",
            };
        }

        // Full exit at T2 if no runner
        if (t2Hit && !trade.runnerActive) {
            return {
                type: "full_exit",
                reason: `T2 وصل — خروج كامل`,
                urgency: "high",
                exitType: "tp2",
            };
        }
    }

    // 3. T3 HIT — exit remaining
    if (trade.phase === "t2_hit" || trade.phase === "trailing" || trade.phase === "runner") {
        const t3Hit = trade.direction === "long"
            ? last.high >= trade.target3
            : last.low <= trade.target3;

        if (t3Hit) {
            return {
                type: "full_exit",
                reason: `T3 وصل — خروج كامل`,
                urgency: "high",
                exitType: "tp3",
            };
        }
    }

    // 4. RUNNER — if regime allows, let position run with tight trail
    if (trade.runnerActive && (trade.phase === "t2_hit" || trade.phase === "trailing")) {
        const runnerHit = trade.direction === "long"
            ? last.high >= trade.runnerTarget
            : last.low <= trade.runnerTarget;

        if (runnerHit) {
            return {
                type: "full_exit",
                reason: `Runner وصل — خروج كامل`,
                urgency: "high",
                exitType: "runner",
            };
        }
    }

    // 5. TRAILING STOP — after T1 hit, trail SL dynamically
    if (trade.phase === "t1_hit" || trade.phase === "trailing") {
        const newTrail = calculateTrailingStop(trade, last.close, regime);
        if (newTrail !== trade.trailingStop) {
            trade.trailingStop = newTrail;
            trade.phase = "trailing";
            trade.trailingActivated = true;
            return {
                type: "trailing_update",
                reason: `رفع SL إلى ${trade.trailingStop.toFixed(2)} (متحرك ديناميكي)`,
                newStopLoss: trade.trailingStop,
                urgency: "medium",
                exitType: "trailing",
            };
        }
    }

    // 6. MOMENTUM EXIT — if momentum fading significantly
    if (trade.phase === "trailing" && trade.candlesInTrade >= 3) {
        const exhaustion = detectMomentumExhaustion(currentCandles, trade.direction);
        if (exhaustion && trade.momentumScore < 40 && pnlPct > 0) {
            return {
                type: "momentum_exit",
                reason: `الزخم ضعف — خروج مبكر (${trade.momentumScore}%)`,
                urgency: "medium",
                exitType: "momentum",
            };
        }
    }

    // 7. REVERSAL DETECTION — exit if momentum reverses strongly
    if (trade.phase === "trailing" && trade.candlesInTrade >= 3) {
        const recentCandles = currentCandles.slice(-3);
        const bearishCount = recentCandles.filter(k => k.close < k.open).length;
        const bullishCount = recentCandles.filter(k => k.close > k.open).length;

        if (trade.direction === "long" && bearishCount === 3 && pnlPct > 0) {
            return {
                type: "early_exit",
                reason: "3 شموع هابطة متتالية — احتمال انعكاس",
                urgency: "high",
                exitType: "reversal",
            };
        }
        if (trade.direction === "short" && bullishCount === 3 && pnlPct > 0) {
            return {
                type: "early_exit",
                reason: "3 شموع صاعدة متتالية — احتمال انعكاس",
                urgency: "high",
                exitType: "reversal",
            };
        }
    }

    // 8. STAGNATION — too many candles without progress
    const maxCandles = getMaxCandles(trade.regime, trade.timeframe);
    if (trade.candlesInTrade > maxCandles && pnlPct < 0.5) {
        return {
            type: "early_exit",
            reason: `太久 (${trade.candlesInTrade} شمعة) بدون تقدم كافٍ`,
            urgency: "medium",
            exitType: "time",
        };
    }

    // 9. EXHAUSTION — momentum fading after big move
    if (trade.highestPnl > 1.5 && pnlPct < trade.highestPnl * 0.4) {
        return {
            type: "momentum_exit",
            reason: `الزخم ضعف — الربح انخفض من ${trade.highestPnl.toFixed(1)}% إلى ${pnlPct.toFixed(1)}%`,
            urgency: "medium",
            exitType: "momentum",
        };
    }

    // 10. HARD STOP hit
    const hardStopHit = trade.direction === "long"
        ? last.low <= trade.hardStopLoss
        : last.high >= trade.hardStopLoss;

    if (hardStopHit) {
        return {
            type: "full_exit",
            reason: "تم كسر الوقف الصعب",
            urgency: "high",
            exitType: "trailing",
        };
    }

    // 11. Dynamic SL hit
    const slHit = trade.direction === "long"
        ? last.low <= trade.trailingStop
        : last.high >= trade.trailingStop;

    if (slHit && trade.trailingStop !== trade.entry) {
        return {
            type: "full_exit",
            reason: `تم الوصول للوقف المتحرك (${trade.trailingStop.toFixed(2)})`,
            urgency: "high",
            exitType: "trailing",
        };
    }

    return { type: "hold", reason: "متابعة الصفقة", urgency: "low" };
}

function getMaxCandles(regime: MarketRegime, timeframe: string): number {
    const base: Record<string, number> = {
        "1m": 30, "3m": 25, "5m": 20, "15m": 16, "30m": 12,
        "1h": 10, "2h": 8, "4h": 6, "6h": 5, "8h": 4,
        "12h": 4, "1d": 3, "3d": 3, "1w": 2,
    };
    const baseCount = base[timeframe] || 10;

    // Regime adjustment
    if (regime === "trend_up" || regime === "trend_down") return baseCount * 2;
    if (regime === "choppy") return Math.floor(baseCount * 0.7);
    return baseCount;
}