// V3 AI — Core Types (Supremacy Edition)
// Self-evolving AI trading system with Ensemble + Transformer + Monte Carlo

import type { SniperKline, SniperDirection, SniperTimeframe, SniperFearGreed } from "@/lib/sniperEngine";

// ─── Feature Types ──────────────────────────────────────────────────────────

export interface ExtractedFeatures {
    // Raw price action
    price: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;

    // Technical indicators
    rsi: number;
    macdHist: number;
    macdSignal: number;
    bbPosition: number;
    bbWidth: number;
    emaShort: number;
    emaMedium: number;
    emaLong: number;

    // Volume analysis
    volumeRatio: number;
    volumeMA: number;
    volumeSpike: boolean;

    // Market regime
    regime: string;
    regimeConfidence: number;

    // Whale flow
    whaleFlowPct: number;
    whaleBuyVol: number;
    whaleSellVol: number;
    largeTrades: number;

    // Time features
    hourOfDay: number;
    dayOfWeek: number;
    minutesSinceOpen: number;

    // Composite
    volatility: number;
    spread: number;
    bodyRatio: number;
    candleDirection: number; // 1 = bullish, -1 = bearish
}

// ─── AI Model Types ─────────────────────────────────────────────────────────

export interface AIPrediction {
    probability: number;       // 0-100% chance of success
    expectedRR: number;        // Expected Risk/Reward
    confidence: number;        // Model confidence
    timeToTarget: number;      // Estimated minutes to target
    direction: SniperDirection;
    suggestion: "strong_buy" | "buy" | "neutral" | "sell" | "strong_sell";
}

export interface LSTMPrediction {
    predictedPrices: number[];  // Next N candles predicted
    support: number;
    resistance: number;
    trend: "up" | "down" | "sideways";
    volatility: "low" | "medium" | "high";
}

// V3 — Transformer Prediction
export interface TransformerPrediction {
    predictedPrices: number[];  // Next 10-20 candles predicted via attention
    attentionWeights: number[]; // Attention distribution over input sequence
    support: number;
    resistance: number;
    trend: "up" | "down" | "sideways";
    signalStrength: number;     // 0-100
}

// V3 — Monte Carlo Simulation
export interface MonteCarloResult {
    scenarios: MonteCarloScenario[];
    winProbability: number;     // % of profitable scenarios
    avgReturn: number;
    medianReturn: number;
    worstCase: number;          // 95th percentile loss
    bestCase: number;           // 95th percentile gain
    var95: number;              // Value at Risk 95%
    sharpeExpected: number;
}

export interface MonteCarloScenario {
    entry: number;
    exit: number;
    target1Hit: boolean;
    target2Hit: boolean;
    stopLossHit: boolean;
    rMultiple: number;
    maxDrawdown: number;
    timeToExit: number; // minutes
}

// V3 — Ensemble Model
export type ModelType = "xgboost" | "lstm" | "transformer" | "randomForest";

export interface ModelWeight {
    model: ModelType;
    weight: number;       // 0-1, dynamic based on recent performance
    accuracy: number;
    recentTrades: number;
}

export interface EnsemblePrediction {
    models: ModelWeight[];
    consensusProbability: number;  // Weighted average
    agreementLevel: number;        // 0-100% how much models agree
    finalSuggestion: "strong_buy" | "buy" | "neutral" | "sell" | "strong_sell";
    modelBreakdown: Record<ModelType, AIPrediction>;
}

// V3 — Kelly Position Sizer
export interface KellyResult {
    fraction: number;       // % of capital to risk
    kellyFraction: number;  // Full Kelly %
    edge: number;           // Expected edge
    suggestedSize: number;  // Position size as % of capital
}

export interface BayesianParams {
    rsiThreshold: number;
    volumeThreshold: number;
    whaleThreshold: number;
    confidenceThreshold: number;
    slMultiplier: number;
    t1Multiplier: number;
    t2Multiplier: number;
}

// ─── Training Types ─────────────────────────────────────────────────────────

export interface TrainingSample {
    features: ExtractedFeatures;
    outcome: "target1" | "target2" | "stopLoss" | "expired";
    rMultiple: number;
    entryPrice: number;
    exitPrice: number;
    timestamp: number;
    symbol: string;
    timeframe: SniperTimeframe;
}

export interface ModelMetrics {
    accuracy: number;
    precision: number;
    recall: number;
    f1Score: number;
    sharpeRatio: number;
    winRate: number;
    avgReturn: number;
    totalTrades: number;
    trainingDate: number;
    modelVersion: string;
}

// ─── RL Agent Types ─────────────────────────────────────────────────────────

export interface RLState {
    features: ExtractedFeatures;
    regime: string;
    consecutiveWins: number;
    consecutiveLosses: number;
    currentDrawdown: number;
    balance: number;
    openPositions: number;
}

export interface RLAction {
    type: "enter_long" | "enter_short" | "exit" | "skip" | "wait";
    confidence: number;
    size: number; // 0-1 fraction of capital
}

// ─── Portfolio Types ────────────────────────────────────────────────────────

export interface KellyInput {
    winRate: number;
    avgWin: number;
    avgLoss: number;
}

export interface PortfolioState {
    balance: number;
    equity: number;
    openPositions: number;
    dailyPnL: number;
    weeklyPnL: number;
    monthlyPnL: number;
    maxDrawdown: number;
    sharpeRatio: number;
    trades: number;
    wins: number;
    losses: number;
}

// ─── AISignal (output to the UI) ────────────────────────────────────────────

export interface AISignal {
    symbol: string;
    baseAsset: string;
    timeframe: SniperTimeframe;
    direction: SniperDirection;
    entry: number;
    target1: number;
    target2: number;
    stopLoss: number;

    // AI outputs
    xgboostPrediction: AIPrediction;
    lstmPrediction: LSTMPrediction | null;
    transformerPrediction: TransformerPrediction | null;
    monteCarlo: MonteCarloResult | null;
    ensemble: EnsemblePrediction | null;
    kellyResult: KellyResult | null;
    bayesianParams: BayesianParams;
    rlDecision: RLAction;

    // Aggregate
    finalConfidence: number;      // Weighted average of all models
    finalScore: number;           // 0-100 final score
    riskLevel: "low" | "medium" | "high" | "extreme";
    positionSize: number;         // % of capital

    // Metadata
    features: ExtractedFeatures;
    modelVersion: string;
    generatedAt: number;
    expiresAt: number;
}