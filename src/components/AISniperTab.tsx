// V2 AI — AI Sniper Tab (Full V2 Implementation)
// Shows AI signals + LSTM predictions + XGBoost + Training metrics
// Integrated with Index.tsx via V1/V2 toggle
// Includes trade logging system (useSniperLog + useVirtualPortfolio)

import { useEffect, useState, useMemo } from "react";
import { Brain, Crosshair, TrendingUp, TrendingDown, RefreshCw, Award, Target, Gauge, Activity, Shield, DollarSign, Sparkles, BarChart3, Cpu, GraduationCap, Eye, EyeOff, TrendingUpDown, CandlestickChart, LineChart, ArrowUpDown } from "lucide-react";
import { useAISniperScan } from "@/hooks/useAISniperScan";
import { useSniperLog } from "@/hooks/useSniperLog";
import { useVirtualPortfolio } from "@/hooks/useVirtualPortfolio";
import { useTradeSync } from "@/hooks/useTradeSync";
import SniperLogPanel from "@/components/SniperLogPanel";
import VirtualPortfolioPanel from "@/components/VirtualPortfolioPanel";
import { formatPrice } from "@/lib/formatPrice";
import type { AISignal } from "@/ai/types";
import type { SniperTimeframe, SniperSignal, SniperFearGreed } from "@/lib/sniperEngine";
import { useTradeAlerts, useLogAlerts } from "@/hooks/useTradeAlerts";

const TIMEFRAMES: { id: SniperTimeframe; label: string }[] = [
    { id: "5m", label: "5م" },
    { id: "15m", label: "15م" },
    { id: "1h", label: "1س" },
    { id: "4h", label: "4س" },
    { id: "1d", label: "يوم" },
];

export default function AISniperTab() {
    const [tf, setTf] = useState<SniperTimeframe>("5m");
    const scanResult = useAISniperScan(tf);
    const { aiSignals, isLoading, isError, progress, trainingStats, fearGreed, totalScanned, usingMockData } = scanResult;
    const [showTraining, setShowTraining] = useState(false);
    const [showLSTM, setShowLSTM] = useState(true);

    const passedSignals = aiSignals.filter(s => s.finalConfidence >= 50);
    const strongSignals = aiSignals.filter(s => s.finalConfidence >= 70);

    // ─── Convert AISignal[] to SniperSignal[] for the log system ───
    const sniperSignals: SniperSignal[] = useMemo(() => {
        return aiSignals.map(ai => ({
            symbol: ai.symbol,
            baseAsset: ai.baseAsset,
            timeframe: ai.timeframe,
            price: ai.entry,
            direction: ai.direction,
            pattern: "none" as const,
            patternLabel: `AI ${ai.finalConfidence}%`,
            volumeRatio: ai.features.volumeRatio,
            volumeExplosion: ai.features.volumeSpike,
            netFlow: ai.features.whaleBuyVol - ai.features.whaleSellVol,
            netFlowPct: ai.features.whaleFlowPct,
            whalesBullish: Math.abs(ai.features.whaleFlowPct) > 20,
            rsi: ai.features.rsi,
            rsiOk: ai.features.rsi > 30 && ai.features.rsi < 70,
            fearGreed: null as SniperFearGreed | null,
            fngOk: true,
            supportBreakConfirmed: false,
            passed: ai.finalConfidence >= 50,
            passedCount: ai.finalConfidence >= 70 ? 5 : ai.finalConfidence >= 50 ? 4 : 2,
            confidence: ai.finalConfidence,
            scoreLine: `AI V2 • ${ai.modelVersion} • ${ai.finalConfidence}%`,
            entry: ai.entry,
            target1: ai.target1,
            target2: ai.target2,
            stopLoss: ai.stopLoss,
            hardStopLoss: ai.direction === "long" ? ai.entry * 0.97 : ai.entry * 1.03,
            initialStopLoss: ai.stopLoss,
            riskReward: ai.xgboostPrediction.expectedRR,
            trailingActive: false,
            profit100T1: +(((Math.abs(ai.target1 - ai.entry)) / ai.entry) * 100).toFixed(2),
            profit100T2: +(((Math.abs(ai.target2 - ai.entry)) / ai.entry) * 100).toFixed(2),
            estTimeToTargetMin: ai.xgboostPrediction.timeToTarget,
            estTimeLabel: ai.xgboostPrediction.timeToTarget > 60
                ? `~${(ai.xgboostPrediction.timeToTarget / 60).toFixed(1)} ساعة`
                : `~${ai.xgboostPrediction.timeToTarget} دقيقة`,
            emergencyExit: false,
            shieldActive: false,
            shieldRemainingSec: 0,
            supportBreak: false,
            suppressed: false,
            multiIndicator: {
                reading: {
                    rsi: ai.features.rsi,
                    rsiScore: ai.features.rsi > 30 && ai.features.rsi < 70 ? 75 : 30,
                    macdHist: ai.features.macdHist,
                    macdScore: Math.abs(ai.features.macdHist) > 0.001 ? 70 : 30,
                    bbPosition: ai.features.bbPosition,
                    bbScore: ai.features.bbPosition > 0.2 && ai.features.bbPosition < 0.8 ? 70 : 30,
                    emaCrossBull: ai.features.emaShort > ai.features.emaMedium,
                    emaScore: ai.features.emaShort > ai.features.emaMedium ? 80 : 25,
                    volumeRatio: ai.features.volumeRatio,
                    volumeScore: ai.features.volumeSpike ? 80 : 30,
                    whaleFlowPct: ai.features.whaleFlowPct,
                    whaleScore: Math.abs(ai.features.whaleFlowPct) > 20 ? 80 : 30,
                    stochK: 50,
                    stochScore: 50,
                    obvSlope: 0,
                    obvScore: 50,
                    vwapDistPct: 0,
                    vwapScore: 50,
                    atrPct: ai.features.spread,
                    atrScore: ai.features.volatility > 0 ? 60 : 30,
                },
                direction: ai.direction,
                confidence: ai.finalConfidence,
                agreeingIndicators: ai.finalConfidence >= 70 ? 7 : ai.finalConfidence >= 50 ? 5 : 2,
                reasonLine: `AI V2: XGBoost ${ai.xgboostPrediction.probability.toFixed(0)}% • LSTM نشط`,
            },
            regime: { regime: "range", label: "AI V2", atrPct: ai.features.spread, trendStrength: 50, adxLite: 0, stdDevPct: 0, confidenceInRegime: ai.features.regimeConfidence },
            quality: {
                total: ai.finalScore,
                grade: ai.finalConfidence >= 70 ? "A+" as const : ai.finalConfidence >= 50 ? "A" as const : "rejected" as const,
                components: { whale: 0, volume: 0, trend: 0, tech: 0, fng: 0 },
                weights: { whale: 30, volume: 25, trend: 15, tech: 15, fng: 5 },
                passed: ai.finalConfidence >= 50,
                targetProbability: ai.finalScore,
                trap: { detected: false, types: [], reason: "" },
            },
            learningAdjustment: 0,
            learningSamples: 0,
            learningWinRate: null,
            atrPct: ai.features.spread,
            lastCandle: { open: ai.features.open, high: ai.features.high, low: ai.features.low, close: ai.features.close },
            candleConfirmed: true,
            candleCloseTime: Date.now(),
        }));
    }, [aiSignals]);

    // ─── Trade log + portfolio ───
    const { log, clear: clearLog, wins, losses, winRate, resolvedCount, forceCloseAsLoss } = useSniperLog(sniperSignals, tf);
    const portfolio = useVirtualPortfolio(log, forceCloseAsLoss);
    const { isAuthed: isCloudAuthed } = useTradeSync(log);

    // ─── Trade alerts (after log is defined) ───
    useTradeAlerts(aiSignals);
    useLogAlerts(log);

    return (
        <div className="space-y-4">
            {/* Header + Model Status */}
            <div className="flex items-center gap-2">
                <Brain className="w-6 h-6 text-purple-400" />
                <h2 className="font-cairo font-bold text-lg text-foreground">🧠 AI Sniper V2</h2>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 font-bold">XGBoost+LSTM</span>
                {trainingStats.modelLoaded && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-stock-green/20 text-stock-green font-bold">
                        دقة {(trainingStats.modelMetrics?.accuracy ?? 0) * 100}%
                    </span>
                )}
                {usingMockData && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-gold/20 text-gold font-bold animate-pulse">
                        🧪 محاكاة
                    </span>
                )}
            </div>

            {/* Training Stats Bar */}
            <div className="p-2.5 rounded-lg bg-purple-500/5 border border-purple-500/20">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-[11px] flex-wrap">
                        <GraduationCap className="w-3.5 h-3.5 text-purple-400" />
                        <span className="text-muted-foreground">عينات:</span>
                        <span className="font-bold text-foreground">{trainingStats.totalSamples}</span>
                        <span className="text-muted-foreground">•</span>
                        <span className="text-muted-foreground">النموذج:</span>
                        <span className={`font-bold ${trainingStats.modelLoaded ? "text-stock-green" : "text-gold"}`}>
                            {trainingStats.modelLoaded ? "جاهز ✅" : "يتعلم 📚"}
                        </span>
                        {trainingStats.trainingCount > 0 && (
                            <>
                                <span className="text-muted-foreground">•</span>
                                <span className="text-muted-foreground">تدريب:</span>
                                <span className="font-bold text-foreground">#{trainingStats.trainingCount}</span>
                            </>
                        )}
                    </div>
                    <button
                        onClick={() => setShowTraining(!showTraining)}
                        className="text-[10px] px-2 py-1 rounded-md bg-purple-500/10 text-purple-300 border border-purple-500/30"
                    >
                        {showTraining ? "إخفاء" : "المقاييس"}
                    </button>
                </div>

                {/* Training Details + LSTM toggle */}
                {showTraining && trainingStats.modelMetrics && (
                    <div className="mt-2 space-y-2">
                        <div className="grid grid-cols-4 gap-2 text-[10px]">
                            <div className="p-1.5 rounded bg-purple-500/10 text-center">
                                <p className="text-muted-foreground">الدقة</p>
                                <p className="font-bold text-purple-300">{(trainingStats.modelMetrics.accuracy * 100).toFixed(1)}%</p>
                            </div>
                            <div className="p-1.5 rounded bg-purple-500/10 text-center">
                                <p className="text-muted-foreground">F1 Score</p>
                                <p className="font-bold text-purple-300">{(trainingStats.modelMetrics.f1Score * 100).toFixed(1)}%</p>
                            </div>
                            <div className="p-1.5 rounded bg-purple-500/10 text-center">
                                <p className="text-muted-foreground">Sharpe</p>
                                <p className={`font-bold ${trainingStats.modelMetrics.sharpeRatio >= 1 ? "text-stock-green" : "text-gold"}`}>
                                    {trainingStats.modelMetrics.sharpeRatio.toFixed(2)}
                                </p>
                            </div>
                            <div className="p-1.5 rounded bg-purple-500/10 text-center">
                                <p className="text-muted-foreground">Win Rate</p>
                                <p className={`font-bold ${trainingStats.modelMetrics.winRate >= 0.5 ? "text-stock-green" : "text-stock-red"}`}>
                                    {(trainingStats.modelMetrics.winRate * 100).toFixed(0)}%
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={() => setShowLSTM(!showLSTM)}
                            className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-md bg-cyan-500/10 text-cyan-300 border border-cyan-500/30"
                        >
                            {showLSTM ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                            {showLSTM ? "إخفاء تنبؤات LSTM" : "عرض تنبؤات LSTM"}
                        </button>
                    </div>
                )}
            </div>

            {/* Timeframe Selector */}
            <div className="flex gap-1.5 overflow-x-auto pb-1">
                {TIMEFRAMES.map(t => (
                    <button
                        key={t.id}
                        onClick={() => setTf(t.id)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap border transition-all ${tf === t.id
                            ? "bg-purple-500 text-white border-purple-500"
                            : "bg-secondary text-foreground border-border hover:border-purple-500/40"
                            }`}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            {/* Stats Summary */}
            <div className="grid grid-cols-4 gap-2 text-xs">
                <div className="p-2.5 rounded-lg bg-secondary/40 border border-border text-center">
                    <p className="text-muted-foreground text-[10px]">مسح</p>
                    <p className="font-bold text-foreground">{aiSignals.length}</p>
                </div>
                <div className="p-2.5 rounded-lg bg-stock-green/10 border border-stock-green/30 text-center">
                    <p className="text-muted-foreground text-[10px]">موصى به</p>
                    <p className="font-bold text-stock-green">{passedSignals.length}</p>
                </div>
                <div className="p-2.5 rounded-lg bg-purple-500/10 border border-purple-500/30 text-center">
                    <p className="text-muted-foreground text-[10px]">قوي</p>
                    <p className="font-bold text-purple-300">{strongSignals.length}</p>
                </div>
                <div className="p-2.5 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-center">
                    <p className="text-muted-foreground text-[10px]">LSTM</p>
                    <p className="font-bold text-cyan-300">{showLSTM ? "نشط 🟢" : "مخفي"}</p>
                </div>
            </div>

            {/* Loading */}
            {isLoading && (
                <div className="flex flex-col items-center py-12 gap-3">
                    <Brain className="w-8 h-8 text-purple-400 animate-pulse" />
                    <p className="text-xs text-muted-foreground">🧠 XGBoost + LSTM يحللان السوق...</p>
                    {progress.total > 0 && (
                        <div className="w-full max-w-xs">
                            <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                                <div className="h-full bg-purple-500 transition-all duration-300" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Error */}
            {isError && (
                <div className="text-center py-8 text-sm text-stock-red">
                    فشل المسح. يرجى المحاولة لاحقاً.
                </div>
            )}

            {/* Signals List */}
            {!isLoading && !isError && (
                <div className="space-y-3">
                    {aiSignals.length === 0 ? (
                        <div className="text-center py-12 rounded-xl gradient-card gold-border p-6">
                            <Cpu className="w-8 h-8 text-purple-400 mx-auto mb-2" />
                            <p className="text-purple-300 font-bold text-base mb-1">لا توجد إشارات AI حالياً</p>
                            <p className="text-muted-foreground text-xs">
                                جاري جمع البيانات لتدريب XGBoost + LSTM...
                            </p>
                        </div>
                    ) : (
                        aiSignals.map((signal, i) => (
                            <AISignalCard key={`${signal.symbol}-${i}`} signal={signal} index={i} showLSTM={showLSTM} />
                        ))
                    )}
                </div>
            )}

            {/* Virtual portfolio + Sniper Log */}
            {!isLoading && (
                <div className="pt-2 border-t border-border space-y-3">
                    <VirtualPortfolioPanel
                        balance={portfolio.balance}
                        equity={portfolio.equity}
                        floatingPnl={portfolio.floatingPnl}
                        initialBalance={portfolio.initialBalance}
                        totalPnl={portfolio.totalPnl}
                        totalPnlPct={portfolio.totalPnlPct}
                        trades={portfolio.trades}
                        openLog={log}
                        wins={portfolio.wins}
                        losses={portfolio.losses}
                        onReset={portfolio.reset}
                        onRemoveTrade={portfolio.removeTrade}
                    />
                    <SniperLogPanel
                        log={log}
                        wins={wins}
                        losses={losses}
                        winRate={winRate}
                        resolvedCount={resolvedCount}
                        onClear={clearLog}
                    />
                </div>
            )}

            <p className="text-[10px] text-muted-foreground text-center mt-4">
                🤖 AI V2 • XGBoost v{trainingStats.modelMetrics?.modelVersion ?? "1.0.0"} • {trainingStats.totalSamples} عينة • LSTM Phase 2
            </p>
        </div>
    );
}

// ─── AI Signal Card ─────────────────────────────────────────────────────────

function AISignalCard({ signal, index, showLSTM }: { signal: AISignal; index: number; showLSTM?: boolean }) {
    const isShort = signal.direction === "short";
    const passed = signal.finalConfidence >= 50;

    const confidenceColor = signal.finalConfidence >= 70 ? "text-stock-green" :
        signal.finalConfidence >= 50 ? "text-gold" : "text-muted-foreground";

    const riskColor: Record<string, string> = {
        low: "text-stock-green",
        medium: "text-gold",
        high: "text-stock-red",
        extreme: "text-stock-red font-bold animate-pulse",
    };

    const suggestionLabel: Record<string, string> = {
        strong_buy: "🟢 شراء قوي",
        buy: "🟢 شراء",
        neutral: "⚪ محايد",
        sell: "🔴 بيع",
        strong_sell: "🔴 بيع قوي",
    };

    return (
        <div
            className={`rounded-xl gradient-card border p-4 animate-fade-up ${passed ? "shadow-[0_0_16px_hsl(var(--purple-500)/0.3)] border-purple-500/50" : "border-border opacity-70"
                }`}
            style={{ animationDelay: `${index * 30}ms` }}
        >
            {/* Header */}
            <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span className={`text-[10px] px-2 py-0.5 rounded-md font-bold flex items-center gap-1 ${isShort ? "bg-stock-red text-background" : "bg-stock-green text-background"
                    }`}>
                    {isShort ? <TrendingDown className="w-3 h-3" /> : <TrendingUp className="w-3 h-3" />}
                    {isShort ? "Short" : "Long"}
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-md bg-purple-500/15 text-purple-300 font-bold">
                    AI {signal.finalConfidence}%
                </span>
                <span className={`text-[10px] px-2 py-0.5 rounded-md font-bold ${riskColor[signal.riskLevel] ?? "text-muted-foreground"} bg-foreground/5`}>
                    مخاطرة {signal.riskLevel === "low" ? "منخفضة" : signal.riskLevel === "medium" ? "متوسطة" : signal.riskLevel === "high" ? "عالية" : "شديدة"}
                </span>
                <span className="mr-auto text-xs font-bold text-foreground">{signal.baseAsset}/USDT</span>
            </div>

            {/* AI Predictions */}
            <div className="grid grid-cols-4 gap-1.5 mb-2">
                <div className="p-1.5 rounded-md bg-purple-500/10 border border-purple-500/30 text-center">
                    <p className="text-[9px] text-muted-foreground">XGBoost</p>
                    <p className="font-bold text-purple-300 text-[11px]">{signal.xgboostPrediction.probability.toFixed(0)}%</p>
                    <p className="text-[8px] text-purple-200/60">{suggestionLabel[signal.xgboostPrediction.suggestion]}</p>
                </div>
                <div className="p-1.5 rounded-md bg-gold/10 border border-gold/30 text-center">
                    <p className="text-[9px] text-muted-foreground">R:R متوقع</p>
                    <p className="font-bold text-gold text-[11px]">1:{signal.xgboostPrediction.expectedRR.toFixed(2)}</p>
                </div>
                <div className="p-1.5 rounded-md bg-cyan-500/10 border border-cyan-500/30 text-center">
                    <p className="text-[9px] text-muted-foreground">حجم المركز</p>
                    <p className="font-bold text-cyan-300 text-[11px]">{(signal.positionSize * 100).toFixed(0)}%</p>
                </div>
                <div className="p-1.5 rounded-md bg-secondary border border-border text-center">
                    <p className="text-[9px] text-muted-foreground">الوقت</p>
                    <p className="font-bold text-foreground text-[11px]">{signal.xgboostPrediction.timeToTarget > 60 ? `${(signal.xgboostPrediction.timeToTarget / 60).toFixed(1)}h` : `${signal.xgboostPrediction.timeToTarget}m`}</p>
                </div>
            </div>

            {/* Price */}
            <div className="flex items-end justify-between mb-2">
                <div>
                    <p className="text-[10px] text-muted-foreground">السعر</p>
                    <p className={`font-bold text-sm ${confidenceColor}`}>{formatPrice(signal.entry)}</p>
                </div>
                <div className="text-right">
                    <p className="text-[10px] text-muted-foreground">النتيجة النهائية</p>
                    <p className={`font-bold text-sm ${confidenceColor}`}>{signal.finalScore}/100</p>
                </div>
            </div>

            {/* Trade Plan */}
            <div className="grid grid-cols-3 gap-1.5 mb-2">
                <div className="p-2 rounded-md bg-stock-green/10 border border-stock-green/30 text-center">
                    <p className="text-[8px] text-muted-foreground">هدف 1</p>
                    <p className="text-[11px] font-bold text-stock-green">{formatPrice(signal.target1)}</p>
                </div>
                <div className="p-2 rounded-md bg-stock-green/15 border border-stock-green/40 text-center">
                    <p className="text-[8px] text-muted-foreground">هدف 2</p>
                    <p className="text-[11px] font-bold text-stock-green">{formatPrice(signal.target2)}</p>
                </div>
                <div className="p-2 rounded-md bg-stock-red/10 border border-stock-red/30 text-center">
                    <p className="text-[8px] text-muted-foreground">وقف خسارة</p>
                    <p className="text-[11px] font-bold text-stock-red">{formatPrice(signal.stopLoss)}</p>
                </div>
            </div>

            {/* AI Features Summary */}
            <div className="flex flex-wrap gap-1 mb-1">
                <FeatureBadge label="RSI" value={signal.features.rsi.toFixed(0)}
                    ok={signal.features.rsi > 30 && signal.features.rsi < 70} />
                <FeatureBadge label="فوليوم" value={`×${signal.features.volumeRatio.toFixed(1)}`}
                    ok={signal.features.volumeSpike} />
                <FeatureBadge label="حيتان" value={`${signal.features.whaleFlowPct >= 0 ? "+" : ""}${signal.features.whaleFlowPct.toFixed(0)}%`}
                    ok={Math.abs(signal.features.whaleFlowPct) > 20} />
                <FeatureBadge label="MACD" value={signal.features.macdHist > 0 ? "صاعد" : "هابط"}
                    ok={Math.abs(signal.features.macdHist) > 0.001} />
                <FeatureBadge label="BB" value={`${(signal.features.bbPosition * 100).toFixed(0)}%`}
                    ok={signal.features.bbPosition > 0.2 && signal.features.bbPosition < 0.8} />
                <FeatureBadge label="التقلب" value={signal.features.spread.toFixed(2)}
                    ok={signal.features.volatility > 0} />
            </div>

            {/* AI Decision */}
            <div className="p-2 rounded-md bg-purple-500/5 border border-purple-500/20 text-[10px]">
                <p className="text-purple-300 font-bold flex items-center gap-1">
                    <Sparkles className="w-3 h-3" /> قرار AI:
                    <span className="text-foreground font-normal mr-1">
                        {signal.finalConfidence >= 70 ? "فرصة ممتازة" :
                            signal.finalConfidence >= 50 ? "فرصة جيدة" : "يراقب"}
                        {" • "}ثقة {signal.finalConfidence}%
                        {" • "}النموذج: {signal.modelVersion}
                    </span>
                </p>
            </div>
        </div>
    );
}

// ─── Feature Badge ──────────────────────────────────────────────────────────

function FeatureBadge({ label, value, ok }: { label: string; value: string; ok: boolean }) {
    return (
        <span className={`text-[9px] px-1.5 py-0.5 rounded-md border font-bold ${ok
            ? "bg-stock-green/10 border-stock-green/30 text-stock-green"
            : "bg-stock-red/10 border-stock-red/30 text-stock-red/70"
            }`}>
            {label}: {value}
        </span>
    );
}