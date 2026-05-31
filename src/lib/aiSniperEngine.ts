// V3 AI — AI Sniper Engine (Supremacy Edition)
// Combines: XGBoost + LSTM + Transformer + Monte Carlo + Ensemble + Kelly
// Uses V1 backend (binanceProxy + binanceDataLayer) for data fetching
// Integrates with V1 training pipeline for continuous learning

import { extractFeatures, featuresToArray } from "@/ai/features/featureExtractor";
import { predictSignal, loadModel } from "@/ai/core/xgboostPredictor";
import { predictLSTM, loadLSTMModel, generateLSTMSignal } from "@/ai/core/lstmPredictor";
import { predictTransformer, loadTransformerModel, generateTransformerSignal } from "@/ai/core/transformerPredictor";
import { runMonteCarlo, assessWithMonteCarlo } from "@/ai/core/monteCarloSimulator";
import { runEnsemble, calculateKelly, updateEnsembleWeights } from "@/ai/core/ensembleEngine";
import { addTrainingSample, runTrainingCycle } from "@/ai/training/trainingPipeline";
import type { ExtractedFeatures, AISignal, AIPrediction, TrainingSample, BayesianParams, MonteCarloResult } from "@/ai/types";
import type { SniperRawSymbol, SniperSignal, SniperTimeframe, SniperDirection, SniperKline } from "@/lib/sniperEngine";
import { analyzeSniperSymbol, computeRSI } from "@/lib/sniperEngine";
import { detectMarketRegime } from "@/lib/qualityEngine";
import { logDebug } from "@/lib/debugBus";

// ─── Bayesian Defaults ─────────────────────────────────────────────────────

const DEFAULT_BAYESIAN: BayesianParams = {
    rsiThreshold: 45,
    volumeThreshold: 1.5,
    whaleThreshold: 20,
    confidenceThreshold: 60,
    slMultiplier: 1.0,
    t1Multiplier: 0.6,
    t2Multiplier: 2.0,
};

// ─── Direction Detection ───────────────────────────────────────────────────

function detectDirection(features: ExtractedFeatures): SniperDirection {
    if (features.rsi < 40 && features.candleDirection === 1) return "long";
    if (features.rsi > 60 && features.candleDirection === -1) return "short";
    if (features.macdHist > 0 && features.whaleFlowPct > 0) return "long";
    if (features.macdHist < 0 && features.whaleFlowPct < 0) return "short";
    return features.emaShort > features.emaMedium ? "long" : "short";
}

// ─── Dynamic Parameters ────────────────────────────────────────────────────

function getDynamicParams(features: ExtractedFeatures): BayesianParams {
    const params = { ...DEFAULT_BAYESIAN };
    if (features.volatility > features.price * 0.02) params.rsiThreshold = 40;
    if (features.regime === "trend_up" || features.regime === "trend_down") params.volumeThreshold = 1.3;
    if (Math.abs(features.whaleFlowPct) > 40) params.whaleThreshold = 10;
    if (features.spread > 2) { params.slMultiplier = 1.5; params.t2Multiplier = 3.0; }
    return params;
}

// ─── Trade Plan Generator ──────────────────────────────────────────────────

function generateTradePlan(
    features: ExtractedFeatures,
    direction: SniperDirection,
    params: BayesianParams,
): { entry: number; target1: number; target2: number; stopLoss: number } {
    const entry = features.price;
    const atr = features.volatility;
    const move = Math.max(atr * params.t1Multiplier, entry * 0.004);

    let target1: number, target2: number, stopLoss: number;
    if (direction === "long") {
        target1 = entry + move * 1.0;
        target2 = entry + move * params.t2Multiplier;
        stopLoss = Math.max(entry - move * params.slMultiplier, entry * 0.97);
    } else {
        target1 = entry - move * 1.0;
        target2 = entry - move * params.t2Multiplier;
        stopLoss = Math.min(entry + move * params.slMultiplier, entry * 1.03);
    }
    return { entry, target1, target2, stopLoss };
}

// ─── Risk Assessment ──────────────────────────────────────────────────────

function assessRisk(features: ExtractedFeatures, prediction: AIPrediction, mcResult: MonteCarloResult | null): AISignal["riskLevel"] {
    if (mcResult) {
        if (mcResult.winProbability < 40 || mcResult.var95 > 3) return "extreme";
        if (mcResult.winProbability < 55 || mcResult.var95 > 2) return "high";
        if (mcResult.winProbability >= 70 && mcResult.var95 < 1) return "low";
    }
    if (features.spread > 3 || prediction.probability < 30) return "extreme";
    if (features.spread > 2 || prediction.probability < 50) return "high";
    if (features.volumeSpike && features.bodyRatio > 0.5) return "low";
    return "medium";
}

// ─── Main AI Analysis (V3 Supremacy) ──────────────────────────────────────

export function analyzeAISymbol(
    raw: SniperRawSymbol,
    timeframe: SniperTimeframe,
    fng: any,
): AISignal | null {
    const { symbol, klines, flow } = raw;
    const regime = detectMarketRegime(klines);
    const features = extractFeatures(klines, flow, regime.label, regime.confidenceInRegime);
    if (!features) return null;

    const direction = detectDirection(features);
    const bayesianParams = getDynamicParams(features);
    const model = loadModel();
    const xgboostPrediction = predictSignal(features, model, timeframe, direction);
    const { entry, target1, target2, stopLoss } = generateTradePlan(features, direction, bayesianParams);

    // ─── V3 Models ───
    // LSTM
    const lstmModel = loadLSTMModel();
    const lstmPrediction = predictLSTM(features, klines, lstmModel, direction);
    const lstmSignal = generateLSTMSignal(lstmPrediction, direction);

    // Transformer (V3)
    const transformerModel = loadTransformerModel();
    const transformerPrediction = predictTransformer(features, klines, transformerModel, direction);
    const transformerSignal = generateTransformerSignal(transformerPrediction, direction);

    // Monte Carlo (V3)
    const monteCarlo = runMonteCarlo(entry, stopLoss, target1, target2, direction, features);

    // Ensemble (V3)
    const ensemble = runEnsemble(features, timeframe, direction, lstmPrediction, transformerPrediction);

    // Kelly Position Sizing (V3)
    const monteCarloWinRate = monteCarlo?.winProbability ?? 50;
    const avgWin = monteCarlo?.avgReturn ?? 1;
    const avgLoss = Math.abs(monteCarlo?.worstCase ?? 1);
    const kellyResult = calculateKelly(monteCarloWinRate, avgWin, avgLoss, ensemble.consensusProbability);

    // ─── Final Decision (Weighted: 60% Ensemble + 30% Monte Carlo + 10% Kelly) ───
    const mcScore = monteCarlo ? Math.min(100, monteCarlo.winProbability + monteCarlo.sharpeExpected * 20) : 40;
    const finalConfidence = Math.round(
        ensemble.consensusProbability * 0.60 +
        mcScore * 0.30 +
        kellyResult.suggestedSize * 100 * 0.10
    );

    const finalScore = Math.round(
        finalConfidence * 0.50 +
        ensemble.consensusProbability * 0.20 +
        (kellyResult.suggestedSize * 100) * 0.10 +
        (monteCarlo ? monteCarlo.sharpeExpected * 10 : 0) * 0.20
    );

    const riskLevel = assessRisk(features, xgboostPrediction, monteCarlo);
    const positionSize = kellyResult.suggestedSize;

    const baseAsset = symbol.replace(/USDT$/, "");
    const now = Date.now();
    const tfMinutes: Record<string, number> = {
        "1m": 1, "5m": 5, "15m": 15, "30m": 30, "1h": 60,
        "4h": 240, "1d": 1440, "1w": 10080,
    };
    const ttl = (tfMinutes[timeframe] ?? 5) * 60 * 1000;

    logDebug("info",
        `🧠 V3: ${symbol} ${direction} • Ensemble ${ensemble.consensusProbability.toFixed(0)}% • MC ${monteCarlo?.winProbability.toFixed(0) ?? "?"}% • ثقة ${finalConfidence}% • كيلي ${(kellyResult.suggestedSize * 100).toFixed(0)}%`,
        { frame: timeframe, symbol }
    );

    return {
        symbol,
        baseAsset,
        timeframe,
        direction,
        entry,
        target1,
        target2,
        stopLoss,
        xgboostPrediction,
        lstmPrediction,
        transformerPrediction,
        monteCarlo,
        ensemble,
        kellyResult,
        bayesianParams,
        rlDecision: {
            type: finalConfidence >= 50 ? (direction === "long" ? "enter_long" : "enter_short") as any : "wait" as any,
            confidence: finalConfidence / 100,
            size: positionSize,
        },
        finalConfidence,
        finalScore,
        riskLevel,
        positionSize,
        features,
        modelVersion: `v3.${ensemble.models.length}m.${model.version}`,
        generatedAt: now,
        expiresAt: now + ttl,
    };
}

// ─── Position Sizing ──────────────────────────────────────────────────────

function calculatePositionSize(confidence: number, risk: AISignal["riskLevel"]): number {
    const baseSize = confidence / 100;
    const riskMultiplier: Record<AISignal["riskLevel"], number> = {
        low: 1.0, medium: 0.7, high: 0.4, extreme: 0.1,
    };
    return Math.round(baseSize * riskMultiplier[risk] * 100) / 100;
}

// ─── Record Trade Outcome ─────────────────────────────────────────────────

export function recordAITradeOutcome(
    signal: AISignal,
    outcome: "target1" | "target2" | "stopLoss" | "expired",
    rMultiple: number,
    exitPrice: number,
): void {
    const sample: TrainingSample = {
        features: signal.features,
        outcome,
        rMultiple,
        entryPrice: signal.entry,
        exitPrice,
        timestamp: Date.now(),
        symbol: signal.symbol,
        timeframe: signal.timeframe,
    };
    addTrainingSample(sample);

    // Update ensemble weights based on outcome
    if (signal.ensemble) {
        updateEnsembleWeights(
            outcome === "target1" || outcome === "target2" ? "win" : "loss",
            Object.fromEntries(
                signal.ensemble.models.map(m => [
                    m.model,
                    { probability: signal.ensemble.modelBreakdown[m.model]?.probability ?? 50 },
                ])
            ) as any,
        );
    }

    logDebug("info", `🎯 V3: ${signal.symbol} ${outcome} • R:${rMultiple.toFixed(2)} • وزن الفرق محدث`);
}

// ─── Merge AI with V1 Signal ──────────────────────────────────────────────

export function mergeWithV1(
    v1Signal: SniperSignal,
    aiSignal: AISignal | null,
): SniperSignal {
    if (!aiSignal) return v1Signal;
    const mergedDecision = aiSignal.finalConfidence >= 50 && (aiSignal.ensemble?.consensusProbability ?? 0) >= 50;
    return {
        ...v1Signal,
        passed: mergedDecision,
        confidence: aiSignal.finalConfidence,
        entry: aiSignal.entry,
        target1: aiSignal.target1,
        target2: aiSignal.target2,
        stopLoss: aiSignal.stopLoss,
        riskReward: aiSignal.xgboostPrediction.expectedRR,
    };
}