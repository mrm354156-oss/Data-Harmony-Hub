// Smart Money Concepts Engine — V2 (Enhanced)
// BOS, MSS, Order Blocks, Liquidity Zones, Supply/Demand, FVG, Structure Bias
// Used as additional confirmation layer for signal quality

import type { SniperKline } from "./sniperEngine";

export interface SwingPoint {
    index: number;
    price: number;
    type: "high" | "low";
    confirmed: boolean;
}

export interface OrderBlock {
    index: number;
    high: number;
    low: number;
    type: "bullish" | "bearish";
    strength: number; // 0-100
    mitigated: boolean;
}

export interface LiquidityZone {
    level: number;
    type: "buy-side" | "sell-side";
    strength: number; // number of touches
}

export interface BOS {
    index: number;
    direction: "bullish" | "bearish";
    brokenLevel: number;
    confirmationCandle: number;
}

// V2 — Market Structure Shift (MSS): change in swing structure pattern
export interface MSS {
    index: number;
    direction: "bullish" | "bearish";
    fromStructure: "HH-HL" | "LH-LL" | "mixed";
    toStructure: "HH-HL" | "LH-LL" | "mixed";
    confidence: number; // 0-100
}

// V2 — Fair Value Gap: price imbalance between 3 candles
export interface FairValueGap {
    index: number;        // index of the middle candle
    high: number;         // gap top
    low: number;          // gap bottom
    type: "bullish" | "bearish";
    filled: boolean;      // has price returned to fill the gap?
    size: number;         // gap size as % of price
}

export interface SmartMoneyVerdict {
    hasBOS: boolean;
    bosDirection: "bullish" | "bearish" | null;
    hasMSS: boolean;
    mssDirection: "bullish" | "bearish" | null;
    mssConfidence: number;
    orderBlocks: OrderBlock[];
    nearestOB: OrderBlock | null;
    liquidityZones: LiquidityZone[];
    demandZone: { high: number; low: number } | null;
    supplyZone: { high: number; low: number } | null;
    fvg: FairValueGap[];
    nearestFVG: FairValueGap | null;
    structureBias: "bullish" | "bearish" | "neutral";
    score: number; // 0-100
    breakdown: {
        bosPoints: number;
        mssPoints: number;
        structurePoints: number;
        obPoints: number;
        zonePoints: number;
        fvgPoints: number;
    };
}

// Detect swing highs and lows (pivot points)
function detectSwingPoints(klines: SniperKline[], lookback = 5): SwingPoint[] {
    const points: SwingPoint[] = [];
    for (let i = lookback; i < klines.length - lookback; i++) {
        const k = klines[i];
        const leftHighs = klines.slice(i - lookback, i).map(c => c.high);
        const rightHighs = klines.slice(i + 1, i + 1 + lookback).map(c => c.high);
        const leftLows = klines.slice(i - lookback, i).map(c => c.low);
        const rightLows = klines.slice(i + 1, i + 1 + lookback).map(c => c.low);

        if (k.high >= Math.max(...leftHighs) && k.high >= Math.max(...rightHighs)) {
            points.push({ index: i, price: k.high, type: "high", confirmed: true });
        }
        if (k.low <= Math.min(...leftLows) && k.low <= Math.min(...rightLows)) {
            points.push({ index: i, price: k.low, type: "low", confirmed: true });
        }
    }
    return points;
}

// Detect Break of Structure (BOS)
function detectBOS(klines: SniperKline[], swings: SwingPoint[]): BOS | null {
    if (swings.length < 2) return null;

    const last = klines[klines.length - 1];
    const recentHighs = swings.filter(s => s.type === "high").slice(-3);
    const recentLows = swings.filter(s => s.type === "low").slice(-3);

    for (const sh of recentHighs) {
        if (last.close > sh.price && klines[sh.index].close < sh.price) {
            return {
                index: klines.length - 1,
                direction: "bullish",
                brokenLevel: sh.price,
                confirmationCandle: klines.length - 1,
            };
        }
    }

    for (const sl of recentLows) {
        if (last.close < sl.price && klines[sl.index].close > sl.price) {
            return {
                index: klines.length - 1,
                direction: "bearish",
                brokenLevel: sl.price,
                confirmationCandle: klines.length - 1,
            };
        }
    }

    return null;
}

// V2 — Detect Market Structure Shift (MSS)
// MSS occurs when the pattern of swing highs/lows changes direction
function detectMSS(klines: SniperKline[], swings: SwingPoint[]): MSS | null {
    const highs = swings.filter(s => s.type === "high").slice(-5);
    const lows = swings.filter(s => s.type === "low").slice(-5);

    if (highs.length < 3 || lows.length < 3) return null;

    // Determine previous structure
    const prevHH = highs[highs.length - 3].price < highs[highs.length - 2].price;
    const prevHL = lows[lows.length - 3].price < lows[lows.length - 2].price;
    const prevLH = highs[highs.length - 3].price > highs[highs.length - 2].price;
    const prevLL = lows[lows.length - 3].price > lows[lows.length - 2].price;

    let prevStructure: "HH-HL" | "LH-LL" | "mixed" = "mixed";
    if (prevHH && prevHL) prevStructure = "HH-HL";
    else if (prevLH && prevLL) prevStructure = "LH-LL";

    // Current structure (most recent swings)
    const currHH = highs[highs.length - 2].price < highs[highs.length - 1].price;
    const currHL = lows[lows.length - 2].price < lows[lows.length - 1].price;
    const currLH = highs[highs.length - 2].price > highs[highs.length - 1].price;
    const currLL = lows[lows.length - 2].price > lows[lows.length - 1].price;

    let currStructure: "HH-HL" | "LH-LL" | "mixed" = "mixed";
    if (currHH && currHL) currStructure = "HH-HL";
    else if (currLH && currLL) currStructure = "LH-LL";

    // MSS detected when structure changes
    if (prevStructure === currStructure || currStructure === "mixed" || prevStructure === "mixed") {
        return null;
    }

    const direction = currStructure === "HH-HL" ? "bullish" : "bearish";
    const confidence = Math.min(100, 60 + (prevStructure !== "mixed" ? 20 : 0) + 20);

    return {
        index: klines.length - 1,
        direction,
        fromStructure: prevStructure,
        toStructure: currStructure,
        confidence,
    };
}

// V2 — Detect Fair Value Gaps (FVG)
// FVG exists when there's a gap between candle 1's high and candle 3's low (bullish)
// or candle 1's low and candle 3's high (bearish)
function detectFVG(klines: SniperKline[], currentPrice: number): FairValueGap[] {
    const fvgs: FairValueGap[] = [];

    for (let i = 2; i < klines.length; i++) {
        const c1 = klines[i - 2]; // first candle
        const c2 = klines[i - 1]; // middle candle (the big one)
        const c3 = klines[i];     // third candle

        // Bullish FVG: gap between c1.high and c3.low
        if (c3.low > c1.high) {
            const gapSize = ((c3.low - c1.high) / c2.close) * 100;
            if (gapSize > 0.1 && gapSize < 5) { // reasonable gap size
                const filled = currentPrice <= c3.low && currentPrice >= c1.high;
                fvgs.push({
                    index: i - 1,
                    high: c3.low,
                    low: c1.high,
                    type: "bullish",
                    filled,
                    size: +gapSize.toFixed(3),
                });
            }
        }

        // Bearish FVG: gap between c1.low and c3.high
        if (c3.high < c1.low) {
            const gapSize = ((c1.low - c3.high) / c2.close) * 100;
            if (gapSize > 0.1 && gapSize < 5) {
                const filled = currentPrice >= c3.high && currentPrice <= c1.low;
                fvgs.push({
                    index: i - 1,
                    high: c1.low,
                    low: c3.high,
                    type: "bearish",
                    filled,
                    size: +gapSize.toFixed(3),
                });
            }
        }
    }

    // Return recent unfilled FVGs (last 10)
    return fvgs.filter(f => !f.filled).slice(-10);
}

// Detect Order Blocks (last opposing candle before strong move)
function detectOrderBlocks(klines: SniperKline[], swings: SwingPoint[]): OrderBlock[] {
    const blocks: OrderBlock[] = [];
    const threshold = 0.005;

    for (let i = 5; i < klines.length - 1; i++) {
        const k = klines[i];
        const next = klines[i + 1];

        if (k.close < k.open && next.close > next.open) {
            const movePct = (next.close - k.open) / k.open;
            if (movePct > threshold) {
                const bodyRange = Math.abs(next.close - next.open);
                const isStrong = bodyRange > (k.high - k.low) * 1.5;
                blocks.push({
                    index: i,
                    high: k.high,
                    low: k.low,
                    type: "bullish",
                    strength: Math.min(100, Math.round(movePct * 500 + (isStrong ? 20 : 0))),
                    mitigated: false,
                });
            }
        }

        if (k.close > k.open && next.close < next.open) {
            const movePct = (k.open - next.close) / k.open;
            if (movePct > threshold) {
                const bodyRange = Math.abs(next.close - next.open);
                const isStrong = bodyRange > (k.high - k.low) * 1.5;
                blocks.push({
                    index: i,
                    high: k.high,
                    low: k.low,
                    type: "bearish",
                    strength: Math.min(100, Math.round(movePct * 500 + (isStrong ? 20 : 0))),
                    mitigated: false,
                });
            }
        }
    }

    const lastIdx = klines.length - 1;
    for (const ob of blocks) {
        if (lastIdx > ob.index + 2) {
            const futureCandles = klines.slice(ob.index + 2);
            for (const fk of futureCandles) {
                if (ob.type === "bullish" && fk.low <= ob.low) {
                    ob.mitigated = true;
                    break;
                }
                if (ob.type === "bearish" && fk.high >= ob.high) {
                    ob.mitigated = true;
                    break;
                }
            }
        }
    }

    return blocks.filter(b => !b.mitigated).slice(-5);
}

// Detect liquidity zones
function detectLiquidityZones(klines: SniperKline[], swings: SwingPoint[]): LiquidityZone[] {
    const zones: LiquidityZone[] = [];
    const tolerance = 0.002;

    const highs = swings.filter(s => s.type === "high");
    for (const h of highs) {
        const existing = zones.find(z => Math.abs(z.level - h.price) / h.price < tolerance);
        if (existing) {
            existing.strength++;
        } else {
            zones.push({ level: h.price, type: "buy-side", strength: 1 });
        }
    }

    const lows = swings.filter(s => s.type === "low");
    for (const l of lows) {
        const existing = zones.find(z => Math.abs(z.level - l.price) / l.price < tolerance);
        if (existing) {
            existing.strength++;
        } else {
            zones.push({ level: l.price, type: "sell-side", strength: 1 });
        }
    }

    return zones.filter(z => z.strength >= 2);
}

// Detect supply and demand zones
function detectSupplyDemand(klines: SniperKline[]): {
    demand: { high: number; low: number } | null;
    supply: { high: number; low: number } | null;
} {
    let demandZone: { high: number; low: number } | null = null;
    for (let i = klines.length - 10; i < klines.length - 2; i++) {
        const k = klines[i];
        const next = klines[i + 1];
        if (k.close < k.open && next.close > next.open) {
            const body = next.close - next.open;
            const range = next.high - next.low;
            if (range > 0 && body / range > 0.6) {
                demandZone = { high: next.high, low: next.low };
                break;
            }
        }
    }

    let supplyZone: { high: number; low: number } | null = null;
    for (let i = klines.length - 10; i < klines.length - 2; i++) {
        const k = klines[i];
        const next = klines[i + 1];
        if (k.close > k.open && next.close < next.open) {
            const body = next.open - next.close;
            const range = next.high - next.low;
            if (range > 0 && body / range > 0.6) {
                supplyZone = { high: next.high, low: next.low };
                break;
            }
        }
    }

    return { demand: demandZone, supply: supplyZone };
}

// V2 — Enhanced structure bias with MSS confirmation
function determineStructureBias(
    swings: SwingPoint[],
    mss: MSS | null,
    direction: "long" | "short",
): { bias: "bullish" | "bearish" | "neutral"; confidence: number } {
    const recentSwings = swings.slice(-6);
    const highs = recentSwings.filter(s => s.type === "high");
    const lows = recentSwings.filter(s => s.type === "low");

    let bias: "bullish" | "bearish" | "neutral" = "neutral";
    let confidence = 50;

    if (highs.length >= 2 && lows.length >= 2) {
        const higherHighs = highs[highs.length - 1].price > highs[highs.length - 2].price;
        const higherLows = lows[lows.length - 1].price > lows[lows.length - 2].price;
        const lowerHighs = highs[highs.length - 1].price < highs[highs.length - 2].price;
        const lowerLows = lows[lows.length - 1].price < lows[lows.length - 2].price;

        if (higherHighs && higherLows) {
            bias = "bullish";
            confidence = 70 + (higherHighs && higherLows ? 15 : 0);
        } else if (lowerHighs && lowerLows) {
            bias = "bearish";
            confidence = 70 + (lowerHighs && lowerLows ? 15 : 0);
        } else if (higherHighs || higherLows) {
            bias = "bullish";
            confidence = 55;
        } else if (lowerHighs || lowerLows) {
            bias = "bearish";
            confidence = 55;
        }
    }

    // MSS boosts confidence significantly
    if (mss) {
        if (mss.direction === "bullish" && bias === "bullish") {
            confidence = Math.min(100, confidence + 15);
        } else if (mss.direction === "bearish" && bias === "bearish") {
            confidence = Math.min(100, confidence + 15);
        } else if (mss.direction !== bias && bias !== "neutral") {
            // MSS contradicts current bias — reduce confidence
            confidence = Math.max(20, confidence - 20);
        }
    }

    return { bias, confidence };
}

// Main analysis function — V2 Enhanced
export function analyzeSmartMoney(
    klines: SniperKline[],
    direction: "long" | "short",
): SmartMoneyVerdict {
    if (klines.length < 20) {
        return {
            hasBOS: false, bosDirection: null,
            hasMSS: false, mssDirection: null, mssConfidence: 0,
            orderBlocks: [], nearestOB: null,
            liquidityZones: [], demandZone: null, supplyZone: null,
            fvg: [], nearestFVG: null,
            structureBias: "neutral", score: 0,
            breakdown: { bosPoints: 0, mssPoints: 0, structurePoints: 0, obPoints: 0, zonePoints: 0, fvgPoints: 0 },
        };
    }

    const swings = detectSwingPoints(klines, 3);
    const bos = detectBOS(klines, swings);
    const mss = detectMSS(klines, swings);
    const orderBlocks = detectOrderBlocks(klines, swings);
    const liquidityZones = detectLiquidityZones(klines, swings);
    const { demand, supply } = detectSupplyDemand(klines);
    const fvgs = detectFVG(klines, klines[klines.length - 1].close);

    const last = klines[klines.length - 1];
    const { bias: structureBias, confidence: structConfidence } = determineStructureBias(swings, mss, direction);

    // Find nearest unmitigated OB
    const relevantOBs = orderBlocks.filter(ob =>
        ob.type === (direction === "long" ? "bullish" : "bearish")
    );
    const nearestOB = relevantOBs.length > 0 ? relevantOBs[relevantOBs.length - 1] : null;

    // Find nearest unfilled FVG aligned with direction
    const relevantFVG = fvgs.filter(f =>
        f.type === (direction === "long" ? "bullish" : "bearish")
    );
    const nearestFVG = relevantFVG.length > 0 ? relevantFVG[relevantFVG.length - 1] : null;

    // Score calculation (0-100) — Enhanced V2
    const breakdown = {
        bosPoints: 0,
        mssPoints: 0,
        structurePoints: 0,
        obPoints: 0,
        zonePoints: 0,
        fvgPoints: 0,
    };

    // BOS aligned: +25
    if (bos && bos.direction === (direction === "long" ? "bullish" : "bearish")) {
        breakdown.bosPoints = 25;
    }

    // MSS aligned: +20 (strong confirmation)
    if (mss && mss.direction === (direction === "long" ? "bullish" : "bearish")) {
        breakdown.mssPoints = 20;
    }

    // Structure bias aligned: +20 (scaled by confidence)
    if (structureBias === (direction === "long" ? "bullish" : "bearish")) {
        breakdown.structurePoints = Math.round(20 * (structConfidence / 100));
    }

    // Nearest OB: +15
    if (nearestOB) {
        breakdown.obPoints = 15;
    }

    // Price in demand/supply zone: +10
    if (demand && direction === "long" && last.low <= demand.high && last.low >= demand.low) {
        breakdown.zonePoints = 10;
    }
    if (supply && direction === "short" && last.high >= supply.low && last.high <= supply.high) {
        breakdown.zonePoints = 10;
    }

    // FVG aligned: +10 (bonus for imbalance confirmation)
    if (nearestFVG) {
        breakdown.fvgPoints = 10;
    }

    const score = Math.min(100,
        breakdown.bosPoints + breakdown.mssPoints + breakdown.structurePoints +
        breakdown.obPoints + breakdown.zonePoints + breakdown.fvgPoints
    );

    return {
        hasBOS: !!bos,
        bosDirection: bos?.direction ?? null,
        hasMSS: !!mss,
        mssDirection: mss?.direction ?? null,
        mssConfidence: mss?.confidence ?? 0,
        orderBlocks,
        nearestOB,
        liquidityZones,
        demandZone: demand,
        supplyZone: supply,
        fvg: fvgs,
        nearestFVG,
        structureBias,
        score,
        breakdown,
    };
}

// V2 — Utility: get all liquidity targets for TP calculation
export function getLiquidityTargets(
    klines: SniperKline[],
    direction: "long" | "short",
): { near: number | null; medium: number | null; far: number | null } {
    const swings = detectSwingPoints(klines, 3);
    const zones = detectLiquidityZones(klines, swings);

    if (direction === "long") {
        const buySide = zones.filter(z => z.type === "buy-side").map(z => z.level).sort((a, b) => a - b);
        const currentPrice = klines[klines.length - 1].close;
        const above = buySide.filter(l => l > currentPrice);
        return {
            near: above[0] ?? null,
            medium: above[1] ?? null,
            far: above[2] ?? null,
        };
    } else {
        const sellSide = zones.filter(z => z.type === "sell-side").map(z => z.level).sort((a, b) => b - a);
        const currentPrice = klines[klines.length - 1].close;
        const below = sellSide.filter(l => l < currentPrice);
        return {
            near: below[0] ?? null,
            medium: below[1] ?? null,
            far: below[2] ?? null,
        };
    }
}