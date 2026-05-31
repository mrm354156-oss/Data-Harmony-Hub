// V5 — Trade Alerts Hook
// Provides real-time toast notifications for:
// 1. Strong AI signals (confidence >= 70%)
// 2. Trade targets hit (T1/T2)
// 3. Stop loss hits
// 4. Training milestones

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import type { AISignal } from "@/ai/types";
import type { SniperSignal } from "@/lib/sniperEngine";

// ─── Types ─────────────────────────────────────────────────────────────────

interface TradeAlertConfig {
    enabled: boolean;
    strongSignalThreshold: number; // default 70
    targetHitAlert: boolean;
    stopLossAlert: boolean;
    trainingAlert: boolean;
}

const DEFAULT_CONFIG: TradeAlertConfig = {
    enabled: true,
    strongSignalThreshold: 70,
    targetHitAlert: true,
    stopLossAlert: true,
    trainingAlert: true,
};

// ─── Signal Alert ─────────────────────────────────────────────────────────

function showSignalAlert(signal: AISignal): void {
    const isShort = signal.direction === "short";
    const emoji = isShort ? "🔴" : "🟢";
    const dirLabel = isShort ? "Short" : "Long";
    const confidence = signal.finalConfidence;

    toast(
        `${emoji} إشارة ${dirLabel} قوية`, {
        description: `${signal.baseAsset}/USDT • ثقة ${confidence}% • R:R 1:${signal.xgboostPrediction.expectedRR.toFixed(2)}`,
        duration: 5000,
        position: "top-center",
        className: confidence >= 80
            ? "border-2 border-purple-500/50 shadow-[0_0_16px_hsl(var(--purple-500)/0.3)]"
            : "",
    });
}

function showTargetAlert(symbol: string, target: "T1" | "T2", profit: number): void {
    const emoji = target === "T1" ? "🎯" : "🏆";
    toast.success(
        `${emoji} ${symbol} - حقق الهدف ${target === "T1" ? "الأول" : "الثاني"}!`, {
        description: `ربح ${profit >= 0 ? "+" : ""}${profit.toFixed(2)}%`,
        duration: 4000,
    });
}

function showStopLossAlert(symbol: string, loss: number): void {
    toast.error(
        `🛑 ${symbol} - إيقاف الخسارة`, {
        description: `خسارة ${loss.toFixed(2)}%`,
        duration: 4000,
    });
}

function showTrainingAlert(accuracy: number, samples: number): void {
    toast(
        "🧠 تم تحديث النموذج!", {
        description: `الدقة: ${(accuracy * 100).toFixed(1)}% • ${samples} عينة`,
        duration: 3000,
        position: "bottom-center",
    });
}

// ─── Main Hook ─────────────────────────────────────────────────────────────

export function useTradeAlerts(
    signals: AISignal[],
    config: Partial<TradeAlertConfig> = {},
): void {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    const prevSignalKeys = useRef<Set<string>>(new Set());

    // Alert on new strong signals
    useEffect(() => {
        if (!cfg.enabled || signals.length === 0) return;

        const currentKeys = new Set(signals.map(s => `${s.symbol}-${s.direction}-${s.finalConfidence}`));

        // Compare with previous keys to find NEW signals
        for (const signal of signals) {
            const key = `${signal.symbol}-${signal.direction}-${signal.finalConfidence}`;
            if (!prevSignalKeys.current.has(key) && signal.finalConfidence >= cfg.strongSignalThreshold) {
                showSignalAlert(signal);
            }
        }

        prevSignalKeys.current = currentKeys;
    }, [signals, cfg.enabled, cfg.strongSignalThreshold]);
}

// ─── V1 Signal Alert Hook ──────────────────────────────────────────────────

export function useV1TradeAlerts(
    signals: SniperSignal[],
    config: Partial<TradeAlertConfig> = {},
): void {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    const prevSignalKeys = useRef<Set<string>>(new Set());

    useEffect(() => {
        if (!cfg.enabled || signals.length === 0) return;

        const currentKeys = new Set(signals.map(s => `${s.symbol}-${s.direction}-${s.confidence}`));

        for (const signal of signals) {
            const key = `${signal.symbol}-${signal.direction}-${signal.confidence}`;
            if (!prevSignalKeys.current.has(key) && signal.passed && (signal.confidence ?? 0) >= cfg.strongSignalThreshold) {
                toast("🎯 إشارة V1 قوية", {
                    description: `${signal.symbol} • ثقة ${signal.confidence}%`,
                    duration: 4000,
                    position: "top-center",
                });
            }
        }

        prevSignalKeys.current = currentKeys;
    }, [signals, cfg.enabled, cfg.strongSignalThreshold]);
}

// ─── Log Alert Hook (for resolved trades) ──────────────────────────────────

interface LogEntry {
    symbol: string;
    result?: "win" | "loss";
    pnl?: number;
    pnlPct?: number;
    target1?: number;
    target2?: number;
    stopLoss?: number;
    exitPrice?: number;
}

export function useLogAlerts(
    log: LogEntry[],
    config: Partial<TradeAlertConfig> = {},
): void {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    const prevLogLength = useRef(0);

    useEffect(() => {
        if (!cfg.enabled || log.length <= prevLogLength.current) {
            prevLogLength.current = log.length;
            return;
        }

        const newEntries = log.slice(prevLogLength.current);
        prevLogLength.current = log.length;

        for (const entry of newEntries) {
            if (entry.result === "win" && cfg.targetHitAlert) {
                const profit = entry.pnlPct ?? 0;
                const target = profit >= 3 ? "T2" : "T1";
                showTargetAlert(entry.symbol, target, profit);
            }

            if (entry.result === "loss" && cfg.stopLossAlert) {
                const loss = entry.pnlPct ?? 0;
                showStopLossAlert(entry.symbol, loss);
            }
        }
    }, [log, cfg.enabled, cfg.targetHitAlert, cfg.stopLossAlert]);
}

export type { TradeAlertConfig };