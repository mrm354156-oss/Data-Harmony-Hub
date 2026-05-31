import { useState, useMemo, useCallback, useEffect, lazy, Suspense } from "react";
import { LogOut, Brain, Crosshair } from "lucide-react";
import LiveClock from "@/components/LiveClock";
import InstallAppPrompt from "@/components/InstallAppPrompt";

// V2 — Code Splitting: lazy-load heavy tab components
const PortfolioTab = lazy(() => import("@/components/PortfolioTab"));
const SniperTab = lazy(() => import("@/components/SniperTab"));
const AISniperTab = lazy(() => import("@/components/AISniperTab"));
const ShieldsTab = lazy(() => import("@/components/ShieldsTab"));
const AlertsTab = lazy(() => import("@/components/AlertsTab"));
const LogsTab = lazy(() => import("@/components/LogsTab"));
const AdminDashboard = lazy(() => import("@/pages/AdminDashboard"));

// Lightweight tab loader
const TabLoader = () => (
  <div className="flex items-center justify-center py-12">
    <div className="w-6 h-6 border-2 border-gold border-t-transparent rounded-full animate-spin" />
  </div>
);
import { useAISniperScan } from "@/hooks/useAISniperScan";
import AuthModal from "@/components/AuthModal";
import BottomNav, { type TabType } from "@/components/BottomNav";
import { useEgxStocks } from "@/hooks/useEgxStocks";
import { useAuth } from "@/hooks/useAuth";
import { useSniperScan } from "@/hooks/useSniperScan";
import { useSniperLog } from "@/hooks/useSniperLog";
import { useTradeSync } from "@/hooks/useTradeSync";
import { useVirtualPortfolio } from "@/hooks/useVirtualPortfolio";
import { analyzeSniperScan, type SniperSignal, type SniperTimeframe } from "@/lib/sniperEngine";
import { useMarketIntelligence, enrichSignalWithIntel } from "@/hooks/useMarketIntelligence";
import { tickShadowResolver } from "@/lib/shadowLearning";
import { startLearningBackupRoutine, restoreLearningFromBackup, flushRetryQueue } from "@/lib/learningEngine";
import { loadSniperSettings, isKitchenShieldEnabled, getLastTradeWasLoss } from "@/lib/sniperSettings";
import { updateScannerState, updateAnalysisState, updateDecisionState, updateTradeAdmission, updateRiskState, resetDiagnostics, printDiagnosticReport } from "@/lib/systemDiagnostics";
import { logDebug } from "@/lib/debugBus";

const Index = () => {
  const [activeTab, setActiveTab] = useState<TabType>("sniper");
  const [showAuth, setShowAuth] = useState(false);
  const [aiMode, setAiMode] = useState<"v1" | "v2">(() => {
    try { return localStorage.getItem("sniper.aiMode") === "v2" ? "v2" : "v1"; } catch { return "v1"; }
  });
  // V43 — رفع الفريم المختار إلى المستوى الأعلى حتى لا يتأثر بتبديل التابات
  const [selectedFrame, setSelectedFrame] = useState<SniperTimeframe>(() => {
    try {
      const saved = localStorage.getItem("sniper.selectedFrame");
      if (saved && ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "3d", "1w"].includes(saved)) {
        return saved as SniperTimeframe;
      }
    } catch {/* ignore */ }
    return "5m";
  });
  // حفظ الفريم فور تغييره
  const handleFrameChange = useCallback((frame: SniperTimeframe) => {
    setSelectedFrame(frame);
    try { localStorage.setItem("sniper.selectedFrame", frame); } catch {/* ignore */ }
  }, []);
  const { user, signOut } = useAuth();

  // Stocks needed for portfolio + alerts tabs
  const { data } = useEgxStocks();
  const stocks = data?.stocks || [];

  // Signals + FNG needed for logs tab
  const { data: scanData, isLoading: isScanLoading } = useSniperScan(selectedFrame);
  const { data: intel } = useMarketIntelligence(true);
  const signals = useMemo(() => {
    if (!scanData) return [];
    const base = analyzeSniperScan(scanData.symbols, selectedFrame, scanData.fearGreed);
    return base.map(s => enrichSignalWithIntel(s, intel));
  }, [scanData, intel, selectedFrame]);
  const fng = scanData?.fearGreed ?? null;

  // V43 — تمرير الفريم المختار إلى SniperTab
  // V34 — Shadow Learning resolver: runs globally every 5s so it continues
  // working even when the user switches away from the Sniper tab.
  useEffect(() => {
    const id = setInterval(() => { tickShadowResolver(); }, 5_000);
    return () => clearInterval(id);
  }, []);

  // V41+ — Self-Learning enhancements: backup, restore, retry
  useEffect(() => {
    // Restore learning data from backup if localStorage was wiped
    restoreLearningFromBackup();
    // Start periodic backup routine
    startLearningBackupRoutine();
    // Flush retry queue every 60s
    const retryId = setInterval(() => { flushRetryQueue(); }, 60_000);
    return () => clearInterval(retryId);
  }, []);

  // AI scan data for admin dashboard (ربط مباشر مع AI signals الحية)
  const aiScanResult = useAISniperScan(selectedFrame);

  // Convert AI signals to V1-style signals for trade log (cast to partial for portfolio tracking)
  const aiSniperSignals = useMemo(() => {
    return aiScanResult.aiSignals.map(ai => ({
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
      fearGreed: null,
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
      riskReward: ai.xgboostPrediction.expectedRR,
      // Required SniperSignal fields (with defaults)
      hardStopLoss: ai.direction === "long" ? ai.entry * 0.97 : ai.entry * 1.03,
      initialStopLoss: ai.stopLoss,
      trailingActive: false,
      profit100T1: +(((Math.abs(ai.target1 - ai.entry)) / ai.entry) * 100).toFixed(2),
      profit100T2: +(((Math.abs(ai.target2 - ai.entry)) / ai.entry) * 100).toFixed(2),
      estTimeToTargetMin: ai.xgboostPrediction.timeToTarget,
      estTimeLabel: `~${ai.xgboostPrediction.timeToTarget}د`,
      emergencyExit: false,
      shieldActive: false,
      shieldRemainingSec: 0,
      supportBreak: false,
      suppressed: false,
      multiIndicator: {
        reading: {
          rsi: ai.features.rsi, rsiScore: 50,
          macdHist: ai.features.macdHist, macdScore: 50,
          bbPosition: ai.features.bbPosition, bbScore: 50,
          emaCrossBull: ai.features.emaShort > ai.features.emaMedium, emaScore: 50,
          volumeRatio: ai.features.volumeRatio, volumeScore: 50,
          whaleFlowPct: ai.features.whaleFlowPct, whaleScore: 50,
          stochK: 50, stochScore: 50, obvSlope: 0, obvScore: 50,
          vwapDistPct: 0, vwapScore: 50,
          atrPct: ai.features.spread, atrScore: 50,
        },
        direction: ai.direction,
        confidence: ai.finalConfidence,
        agreeingIndicators: ai.finalConfidence >= 70 ? 7 : 5,
        reasonLine: `AI V2 ${ai.finalConfidence}%`,
      },
      regime: { regime: "range" as const, label: "AI V2", atrPct: ai.features.spread, trendStrength: 50, adxLite: 0, stdDevPct: 0, confidenceInRegime: ai.features.regimeConfidence },
      quality: {
        total: ai.finalScore,
        grade: ai.finalConfidence >= 70 ? "A+" as const : ai.finalConfidence >= 50 ? "A" as const : "rejected" as const,
        components: { whale: 0, volume: 0, trend: 0, tech: 0, fng: 0 },
        weights: { whale: 30, volume: 25, trend: 15, tech: 15, fng: 5 },
        passed: ai.finalConfidence >= 50,
        targetProbability: ai.finalScore,
        trap: { detected: false, types: [], reason: "" },
      },
      learningAdjustment: 0, learningSamples: 0, learningWinRate: null,
      atrPct: ai.features.spread,
      lastCandle: {
        open: ai.features.open, high: ai.features.high,
        low: ai.features.low, close: ai.features.close,
      },
      candleConfirmed: true,
      candleCloseTime: Date.now(),
    })) as SniperSignal[];
  }, [aiScanResult.aiSignals]);

  // V44 — Admin Dashboard أصبح Read-Only: لا ينشئ hooks خاصة به.
  // يستخدم sniperLogState و sniperPortfolio من النظام الرئيسي مباشرة.
  // adminLog = useSniperLog(aiSniperSignals, selectedFrame) ← أُزيل
  // adminPortfolio = useVirtualPortfolio(adminLog, () => { }) ← أُزيل

  // Log + tradeSync needed for LogsTab (RiskPanel + ShadowLog)
  const sniperLogState = useSniperLog(signals, selectedFrame);
  const { isAuthed: isCloudAuthed } = useTradeSync(sniperLogState.log);

  // Virtual portfolio from sniper signals — shared between SniperTab & PortfolioTab
  const sniperPortfolio = useVirtualPortfolio(sniperLogState.log, sniperLogState.forceCloseAsLoss);

  // V44 — نظام التشخيص: يسجل حالة كل مكون في كل دورة مسح
  useEffect(() => {
    const settings = loadSniperSettings();
    // 1. Scanner State
    updateScannerState({
      enabled: !isScanLoading && !!scanData,
      scanLimit: settings.scanLimit,
      timeframe: selectedFrame,
    });

    // 2. Analysis + Decision + Risk (only if we have data)
    if (scanData && signals.length > 0) {
      const passedSignals = signals.filter(s => s.passed);
      updateAnalysisState({
        signalsGenerated: signals.length,
        signalsPassed: passedSignals.length,
        shieldEnabled: isKitchenShieldEnabled(),
        sweepSensitivity: settings.sweepSensitivity,
      });

      const pendingCount = sniperLogState.log.filter(l => l.outcome === "pending").length;
      updateDecisionState({
        signalsSentToLog: pendingCount,
      });

      updateRiskState({
        blockActive: getLastTradeWasLoss(),
        lastTradeWasLoss: getLastTradeWasLoss(),
        metaPenalty: 0, // سيتم قراءة القيمة الفعلية من MetaPerformance
        mood: sniperLogState.winRate < 40 ? "lockdown" :
          sniperLogState.winRate < 50 ? "defensive" : "normal",
      });

      // سجل كل إشارة تم حجبها بواسطة Trade Admission
      const admittedCount = sniperLogState.log.length;
      const blockedByJudge = passedSignals.length - admittedCount;
      if (blockedByJudge > 0) {
        updateTradeAdmission({ judgeBlocked: blockedByJudge });
      }

      printDiagnosticReport(`فريم ${selectedFrame}`);
    }
  }, [scanData, signals, selectedFrame, isScanLoading, sniperLogState.log, sniperLogState.winRate]);

  return (
    <div className="min-h-screen pb-20 font-cairo relative">
      {/* خلفية اللوجو */}
      <div className="fixed inset-0 z-0 flex items-center justify-center pointer-events-none opacity-[0.04]">
        <img src="/logo.jpeg" alt="" className="w-full h-full object-contain max-w-[600px]" />
      </div>

      <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-xl border-b border-border">
        <div className="max-w-lg mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <img src="/logo.jpeg" alt="حلاوة" className="h-8 w-auto rounded-lg" />
              <div>
                <h1 className="font-bold text-sm text-foreground">حلاوة</h1>
                <p className="text-[10px] text-gold">المفتش الذكي يراقب</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              {/* V1 ↔ V2 Toggle */}
              <button
                onClick={() => {
                  const next = aiMode === "v1" ? "v2" : "v1";
                  setAiMode(next);
                  try { localStorage.setItem("sniper.aiMode", next); } catch { /* ignore */ }
                }}
                className={`flex items-center gap-1 px-2 py-1 rounded-lg border text-[10px] font-bold transition-all ${aiMode === "v2"
                  ? "bg-purple-500/20 text-purple-300 border-purple-500/50 shadow-[0_0_8px_hsl(var(--purple-500)/0.3)]"
                  : "bg-gold/15 text-gold border-gold/30"
                  }`}
                title={aiMode === "v2" ? "🧠 AI V2 — نشط" : "🎯 V1 — وضع القناص الكلاسيكي"}
              >
                {aiMode === "v2" ? (
                  <><Brain className="w-3 h-3" /><span>AI V2</span></>
                ) : (
                  <><Crosshair className="w-3 h-3" /><span>V1</span></>
                )}
              </button>
              {user && (
                <button onClick={signOut} className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground" title="اخرج">
                  <LogOut className="w-4 h-4" />
                </button>
              )}
              <LiveClock />
            </div>
          </div>
        </div>
      </header>

      <main className="relative z-10 max-w-lg mx-auto px-4 py-4">
        <Suspense fallback={<TabLoader />}>
          {activeTab === "sniper" && (
            aiMode === "v2"
              ? <AISniperTab />
              : <SniperTab
                user={user}
                onLoginRequest={() => setShowAuth(true)}
                selectedFrame={selectedFrame}
                onFrameChange={handleFrameChange}
                sniperLog={sniperLogState.log}
                sniperLogState={{
                  wins: sniperLogState.wins,
                  losses: sniperLogState.losses,
                  winRate: sniperLogState.winRate,
                  resolvedCount: sniperLogState.resolvedCount,
                  clear: sniperLogState.clear,
                }}
              />
          )}

          {activeTab === "shields" && <ShieldsTab />}

          {activeTab === "portfolio" && (
            <PortfolioTab
              stocks={stocks}
              user={user}
              onLoginRequest={() => setShowAuth(true)}
              sniperLog={sniperLogState.log}
              sniperPortfolio={sniperPortfolio}
              sniperLogState={{
                wins: sniperLogState.wins,
                losses: sniperLogState.losses,
                winRate: sniperLogState.winRate,
                resolvedCount: sniperLogState.resolvedCount,
                clear: sniperLogState.clear,
              }}
            />
          )}

          {activeTab === "alerts" && (
            <AlertsTab stocks={stocks} user={user} onLoginRequest={() => setShowAuth(true)} />
          )}

          {activeTab === "logs" && (
            <LogsTab signals={signals} fng={fng} log={sniperLogState.log} isCloudAuthed={isCloudAuthed} />
          )}

          {activeTab === "admin" && user?.email === "mmr136835@gmail.com" && (
            <AdminDashboard
              aiStats={{
                totalSignals: aiScanResult.aiSignals.length,
                passedSignals: aiScanResult.passedCount,
                trainingStats: aiScanResult.trainingStats,
                usingMockData: aiScanResult.usingMockData,
                isLoading: aiScanResult.isLoading,
              }}
              portfolioStats={{
                balance: sniperPortfolio.balance,
                equity: sniperPortfolio.equity,
                totalPnl: sniperPortfolio.totalPnl,
                totalPnlPct: sniperPortfolio.totalPnlPct,
                wins: sniperLogState.wins || sniperPortfolio.wins,
                losses: sniperLogState.losses || sniperPortfolio.losses,
                winRate: sniperLogState.winRate > 0 ? sniperLogState.winRate / 100 : (sniperPortfolio.wins + sniperPortfolio.losses > 0
                  ? sniperPortfolio.wins / (sniperPortfolio.wins + sniperPortfolio.losses)
                  : 0),
              }}
            />
          )}
        </Suspense>
      </main>

      <BottomNav activeTab={activeTab} onTabChange={setActiveTab} userEmail={user?.email} />

      <InstallAppPrompt />

      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
    </div>
  );
};

export default Index;
