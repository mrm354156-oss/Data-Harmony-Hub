// V2 AI — Training Pipeline
// Orchestrates the complete self-learning cycle:
// 1. Collect training data from V1 signal log + live trades
// 2. Extract features from historical klines
// 3. Train/update XGBoost model
// 4. Save model + update metrics
// 5. Schedule next training cycle

import type { TrainingSample, ModelMetrics } from "@/ai/types";
import { extractFeatures } from "@/ai/features/featureExtractor";
import { trainModel, loadModel, saveModel, createDefaultModel, type XGBoostModel } from "@/ai/core/xgboostPredictor";
import type { SniperKline, SniperFlow, SniperTimeframe, SniperDirection } from "@/lib/sniperEngine";
import { logDebug } from "@/lib/debugBus";
import type { DebugCategory } from "@/lib/debugBus";

// ─── Training Configuration ────────────────────────────────────────────────

const TRAINING_INTERVAL_MS = 300_000; // Retrain every 5 minutes
const MIN_SAMPLES_FOR_TRAINING = 10;
const MAX_TRAINING_SAMPLES = 1000;

const STORAGE_KEY = "ai_training_samples_v1";
const V1_LOG_KEY = "sniper_signal_log_v2";

// ─── Sample Management ─────────────────────────────────────────────────────

function loadSamples(): TrainingSample[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        return JSON.parse(raw) as TrainingSample[];
    } catch { return []; }
}

function saveSamples(samples: TrainingSample[]): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(samples.slice(-MAX_TRAINING_SAMPLES)));
    } catch { /* storage full */ }
}

// ─── V1 Data Migration ─────────────────────────────────────────────────────

function migrateV1Logs(): TrainingSample[] {
    const existing = loadSamples();
    if (existing.length >= MIN_SAMPLES_FOR_TRAINING) return existing;

    try {
        const raw = localStorage.getItem(V1_LOG_KEY);
        if (!raw) return existing;

        const logs = JSON.parse(raw);
        if (!Array.isArray(logs)) return existing;

        // V1 logs don't have features, but we can create pseudo-samples
        // with regime/pattern info for initial model bootstrapping
        const migrated: TrainingSample[] = [];

        for (const log of logs) {
            if (!log.outcome || log.outcome === "pending") continue;
            if (migrated.length >= MAX_TRAINING_SAMPLES) break;

            // Create a minimal sample (features will be filled during live scan)
            migrated.push({
                features: null as any, // Will be filled when we have live data
                outcome: log.outcome,
                rMultiple: log.rMultiple ?? 0,
                entryPrice: log.entryPrice ?? 0,
                exitPrice: log.exitPrice ?? 0,
                timestamp: log.resolvedAt ?? log.createdAt ?? Date.now(),
                symbol: log.symbol ?? "",
                timeframe: log.timeframe ?? "5m",
            });
        }

        if (migrated.length > 0) {
            const combined = [...migrated, ...existing].slice(-MAX_TRAINING_SAMPLES);
            saveSamples(combined);
            return combined;
        }
    } catch { /* ignore */ }

    return existing;
}

// ─── Add Live Trade ────────────────────────────────────────────────────────

export function addTrainingSample(sample: TrainingSample): void {
    const samples = loadSamples();
    samples.unshift(sample);
    saveSamples(samples);

    // Trigger training if we have enough samples
    if (samples.length >= MIN_SAMPLES_FOR_TRAINING && samples.length % 10 === 0) {
        void runTrainingCycle();
    }
}

// ─── Training Cycle ────────────────────────────────────────────────────────

let isTraining = false;
let lastTrainingAt = 0;
let trainingCount = 0;

export async function runTrainingCycle(): Promise<XGBoostModel | null> {
    if (isTraining) return null;
    if (Date.now() - lastTrainingAt < TRAINING_INTERVAL_MS) return null;

    isTraining = true;
    logDebug("info", "🧠 بدء دورة تدريب AI...");

    try {
        // Load samples (migrate V1 data if needed)
        const samples = migrateV1Logs();

        if (samples.length < MIN_SAMPLES_FOR_TRAINING) {
            logDebug("info", `⏳ بيانات غير كافية للتدريب: ${samples.length}/${MIN_SAMPLES_FOR_TRAINING}`);
            return loadModel();
        }

        // Filter out samples without features
        const validSamples = samples.filter(s => s.features !== null);
        if (validSamples.length < MIN_SAMPLES_FOR_TRAINING) {
            logDebug("info", `⏳ انتظار بيانات الميزات الكافية: ${validSamples.length}/${MIN_SAMPLES_FOR_TRAINING}`);
            return loadModel();
        }

        // Train model
        const model = trainModel(validSamples);
        lastTrainingAt = Date.now();
        trainingCount++;

        logDebug("info",
            `✅ اكتمل التدريب #${trainingCount}:` +
            ` ${validSamples.length} عينة` +
            ` • دقة ${(model.metrics.accuracy * 100).toFixed(1)}%` +
            ` • F1 ${(model.metrics.f1Score * 100).toFixed(1)}%` +
            ` • Sharpe ${model.metrics.sharpeRatio.toFixed(2)}`,
        );

        return model;
    } catch (error) {
        logDebug("info", `❌ فشل التدريب: ${error}`);
        return null;
    } finally {
        isTraining = false;
    }
}

// ─── Get Training Stats ────────────────────────────────────────────────────

export function getTrainingStats(): {
    totalSamples: number;
    validSamples: number;
    lastTrainingAt: number;
    trainingCount: number;
    modelLoaded: boolean;
    modelMetrics: ModelMetrics | null;
} {
    const samples = loadSamples();
    const validSamples = samples.filter(s => s.features !== null);
    const model = loadModel();

    return {
        totalSamples: samples.length,
        validSamples: validSamples.length,
        lastTrainingAt,
        trainingCount,
        modelLoaded: model.trees.length > 0,
        modelMetrics: model.trees.length > 0 ? model.metrics : null,
    };
}

// ─── Reset ─────────────────────────────────────────────────────────────────

export function resetTrainingData(): void {
    localStorage.removeItem(STORAGE_KEY);
    saveModel(createDefaultModel());
    lastTrainingAt = 0;
    trainingCount = 0;
    logDebug("info", "🗑️ تم مسح بيانات التدريب والنموذج");
}

// ─── Initialize Training System ────────────────────────────────────────────

export function initializeTrainingSystem(): void {
    // Migrate V1 data on startup
    migrateV1Logs();

    // Run initial training if data available
    void runTrainingCycle();

    // Schedule periodic training
    setInterval(() => {
        void runTrainingCycle();
    }, TRAINING_INTERVAL_MS);

    logDebug("info", "🚀 نظام التدريب AI جاهز");
}