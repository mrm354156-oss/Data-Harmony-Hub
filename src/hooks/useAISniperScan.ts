// V4 AI — AI Sniper Scan Hook (Auto Fallback)
// Uses V1 data layer but AI analysis engine
// Falls back to realistic mock data when Binance Proxy is unreachable
// This ensures AI models work even without Supabase deployment

import { useEffect, useState, useCallback } from "react";
import { useSniperScan } from "./useSniperScan";
import type { SniperTimeframe, SniperFearGreed } from "@/lib/sniperEngine";
import type { AISignal } from "@/ai/types";
import { analyzeAISymbol } from "@/lib/aiSniperEngine";
import { initializeTrainingSystem, getTrainingStats } from "@/ai/training/trainingPipeline";
import { generateMockScan, isBinanceProxyAvailable } from "@/lib/mockMarketData";

export interface AIScanResponse {
    aiSignals: AISignal[];
    timeframe: SniperTimeframe;
    fearGreed: SniperFearGreed | null;
    totalScanned: number;
    passedCount: number;
    trainingStats: ReturnType<typeof getTrainingStats>;
    isLoading: boolean;
    isError: boolean;
    progress: { done: number; total: number };
    usingMockData: boolean; // V4: show when mock data is active
}

export function useAISniperScan(timeframe: SniperTimeframe): AIScanResponse {
    const [aiSignals, setAiSignals] = useState<AISignal[]>([]);
    const [initialized, setInitialized] = useState(false);
    const [usingMockData, setUsingMockData] = useState(false);
    const [isMockLoading, setIsMockLoading] = useState(true);

    // Initialize training system on mount
    useEffect(() => {
        if (!initialized) {
            initializeTrainingSystem();
            setInitialized(true);

            // Check if Binance Proxy is available
            isBinanceProxyAvailable().then(available => {
                if (!available) {
                    console.log("🧪 Binance Proxy غير متاح. استخدام بيانات محاكاة V4...");
                    setUsingMockData(true);
                } else {
                    console.log("✅ Binance Proxy متصل. استخدام البيانات الحية...");
                    setUsingMockData(false);
                }
                setIsMockLoading(false);
            });
        }
    }, [initialized]);

    // Use V1 scan for data fetching (returns empty if proxy down)
    const { data, isLoading: realLoading, isError: realError, progress } = useSniperScan(timeframe);

    // Run AI analysis on data
    useEffect(() => {
        const hasRealData = data && data.symbols && data.symbols.length > 0;
        const hasMockData = !usingMockData || isMockLoading;

        if (hasRealData && !usingMockData) {
            // Use real data from Binance Proxy
            const fng = data.fearGreed;
            const signals = data.symbols.map(symbol => {
                try {
                    return analyzeAISymbol(symbol, timeframe, fng);
                } catch {
                    return null;
                }
            }).filter(Boolean) as AISignal[];

            signals.sort((a, b) => b.finalConfidence - a.finalConfidence);
            setAiSignals(signals);
            setIsMockLoading(false);
        } else if (usingMockData && !isMockLoading) {
            // Use mock data when proxy is unavailable
            const mockData = generateMockScan(timeframe, 12, "high_quality");
            const fng = mockData.fearGreed;
            const signals = mockData.symbols.map(symbol => {
                try {
                    return analyzeAISymbol(symbol, timeframe, fng);
                } catch {
                    return null;
                }
            }).filter(Boolean) as AISignal[];

            signals.sort((a, b) => b.finalConfidence - a.finalConfidence);
            setAiSignals(signals);
        } else if (!usingMockData && isMockLoading) {
            // Still checking proxy, don't set signals
            // (keep previous state)
        } else {
            // No data available at all
            // Try mock data as last resort
            const mockData = generateMockScan(timeframe, 8, "all");
            const signals = mockData.symbols.map(symbol => {
                try {
                    return analyzeAISymbol(symbol, timeframe, mockData.fearGreed);
                } catch {
                    return null;
                }
            }).filter(Boolean) as AISignal[];
            signals.sort((a, b) => b.finalConfidence - a.finalConfidence);
            if (signals.length > 0) {
                setAiSignals(signals);
                setUsingMockData(true);
            }
        }
    }, [data, timeframe, usingMockData, isMockLoading]);

    const passedCount = aiSignals.filter(s => s.finalConfidence >= 60).length;
    const trainingStats = getTrainingStats();

    // Refresh mock data periodically (every 30s instead of 90s)
    useEffect(() => {
        if (!usingMockData) return;
        const interval = setInterval(() => {
            const mockData = generateMockScan(timeframe, 12, "high_quality");
            const signals = mockData.symbols.map(symbol => {
                try {
                    return analyzeAISymbol(symbol, timeframe, mockData.fearGreed);
                } catch {
                    return null;
                }
            }).filter(Boolean) as AISignal[];
            signals.sort((a, b) => b.finalConfidence - a.finalConfidence);
            if (signals.length > 0) {
                setAiSignals(signals);
            }
        }, 30000);
        return () => clearInterval(interval);
    }, [timeframe, usingMockData]);

    const isLoading = realLoading || isMockLoading;
    const isError = realError && !usingMockData && aiSignals.length === 0;

    return {
        aiSignals,
        timeframe,
        fearGreed: data?.fearGreed ?? null,
        totalScanned: aiSignals.length,
        passedCount,
        trainingStats,
        isLoading,
        isError,
        progress,
        usingMockData,
    };
}