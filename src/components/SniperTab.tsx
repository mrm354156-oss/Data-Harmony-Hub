/* eslint-disable react-hooks/rules-of-hooks */
import { useEffect, useState } from "react";
import { Crosshair, RefreshCw, Flame, Fish, Activity, Brain, Copy, Check, X, AlertTriangle, Shield, Clock, DollarSign, Lightbulb, Radio, TrendingDown, TrendingUp, Award, Target, Gauge, Wand2, FlaskConical, LogIn } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { isPaperMode, setPaperMode, subscribePaperMode } from "@/lib/paperMode";
import { useSniperScan } from "@/hooks/useSniperScan";
import { useBinanceLivePrice, ensureBinanceStream } from "@/hooks/useBinanceLivePrices";
import { logDebug } from "@/lib/debugBus";
import { runMemoryGC } from "@/lib/memoryGC";
import type { LoggedSniperSignal } from "@/hooks/useSniperLog";
import { useMetaPerformance, setEngineMetaPenalty } from "@/hooks/useMetaPerformance";
import { analyzeSniperScan, type SniperSignal, type SniperTimeframe } from "@/lib/sniperEngine";
import { useMarketIntelligence, enrichSignalWithIntel } from "@/hooks/useMarketIntelligence";
import { formatPrice } from "@/lib/formatPrice";
import { loadSniperSettings, saveSniperSettings, SCAN_LIMIT_MIN, SCAN_LIMIT_MAX } from "@/lib/sniperSettings";
import { hydratePersistentMemory } from "@/lib/persistentLearning";
import { useAutoFrameWatcher, useJumpCooldown, FRAME_JUMP_COOLDOWN_MS } from "@/hooks/useAutoFrameWatcher";
import { toast } from "sonner";

const TIMEFRAMES: { id: SniperTimeframe; label: string; type: "scalp" | "swing" }[] = [
  { id: "1m", label: "1m", type: "scalp" },
  { id: "3m", label: "3m", type: "scalp" },
  { id: "5m", label: "5m", type: "scalp" },
  { id: "15m", label: "15m", type: "scalp" },
  { id: "30m", label: "30m", type: "scalp" },
  { id: "1h", label: "1h", type: "swing" },
  { id: "2h", label: "2h", type: "swing" },
  { id: "4h", label: "4h", type: "swing" },
  { id: "6h", label: "6h", type: "swing" },
  { id: "8h", label: "8h", type: "swing" },
  { id: "12h", label: "12h", type: "swing" },
  { id: "1d", label: "1d", type: "swing" },
  { id: "3d", label: "3d", type: "swing" },
  { id: "1w", label: "1w", type: "swing" },
];

const STATUS_MESSAGES = [
  "جاري تحليل صفقات الحيتان (Aggregated Trades) لضمان الدقة الأقصى...",
  "مراقبة سيولة Binance المباشرة وكشف الانفجارات السعرية...",
  "حساب صافي التدفق المالي وتأكيد الشموع التأكيدية...",
  "تشغيل بروتوكول المراقب الصامت (120s Shield) على الإشارات...",
];

interface SniperTabProps {
  user: User | null;
  onLoginRequest: () => void;
  selectedFrame?: SniperTimeframe;
  onFrameChange?: (frame: SniperTimeframe) => void;
  sniperLog?: LoggedSniperSignal[];
  sniperLogState?: {
    wins: number;
    losses: number;
    winRate: number;
    resolvedCount: number;
    clear: () => void;
  };
}

const SniperTab = ({ user, onLoginRequest, selectedFrame: externalFrame, onFrameChange, sniperLog: propsLog, sniperLogState: propsLogState }: SniperTabProps) => {
  // Show login prompt if not authenticated
  if (!user) {
    return (
      <div className="text-center py-16 animate-fade-up">
        <Crosshair className="w-12 h-12 text-gold mx-auto mb-4" />
        <p className="text-foreground font-bold text-lg mb-2">🎯 وضع القناص</p>
        <p className="text-muted-foreground text-sm mb-6">سجل دخول عشان تحفظ الصفقات والإحصائيات في السحابة</p>
        <button
          onClick={onLoginRequest}
          className="flex items-center gap-2 mx-auto px-6 py-3 rounded-xl gradient-gold text-primary-foreground font-bold text-sm hover:scale-105 active:scale-95 transition-all"
        >
          <LogIn className="w-4 h-4" />
          سجل دخول
        </button>
      </div>
    );
  }

  // V43 — الفريم يُدار من Index.tsx عبر props (يبقى ثابتاً عند تبديل التابات)
  const [internalTf, setInternalTf] = useState<SniperTimeframe>(() => {
    // استخدم externalFrame إن وجد، أو اقرأ من localStorage
    if (externalFrame) return externalFrame;
    try {
      const saved = localStorage.getItem("sniper.selectedFrame");
      if (saved && ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "3d", "1w"].includes(saved)) {
        return saved as SniperTimeframe;
      }
    } catch {/* ignore */ }
    return "5m";
  });

  // Synchronise internalTf with externalFrame whenever it changes
  useEffect(() => {
    if (externalFrame && externalFrame !== internalTf) {
      setInternalTf(externalFrame);
    }
  }, [externalFrame]);

  // The actual timeframe — use external if provided, otherwise internal
  const tf = externalFrame ?? internalTf;

  const setTf = (frame: SniperTimeframe) => {
    if (onFrameChange) {
      onFrameChange(frame);
    } else {
      setInternalTf(frame);
    }
    try { localStorage.setItem("sniper.selectedFrame", frame); } catch {/* ignore */ }
  };
  const [showOnlyPassed, setShowOnlyPassed] = useState(true);
  const [statusIdx, setStatusIdx] = useState(0);
  const [, forceTick] = useState(0);
  const [scanLimit, setScanLimitState] = useState<number>(() => loadSniperSettings().scanLimit);
  const [paper, setPaperState] = useState<boolean>(() => isPaperMode());
  useEffect(() => subscribePaperMode((v) => setPaperState(v)), []);
  // V33 Supreme — autoFrameAllFrames أصبح ضمنياً مع Auto-Frame؛ لم يعد له زر مستقل.
  const [autoFrameMode, setAutoFrameMode] = useState<boolean>(() => {
    try { return localStorage.getItem("sniper.autoFrameMode") === "1"; } catch { return false; }
  });
  const [autoFrameBusy, setAutoFrameBusy] = useState(false);
  const [lastAutoFrameAt, setLastAutoFrameAt] = useState<number | null>(null);
  const { data, isLoading, isError, isRefetching, refetch, progress } = useSniperScan(tf);

  const updateScanLimit = (n: number) => {
    setScanLimitState(n);
    saveSniperSettings({ scanLimit: n });
  };

  // Open Binance live price WebSocket once + hydrate persistent learning memory
  useEffect(() => {
    ensureBinanceStream();
    void hydratePersistentMemory();
    const id = setInterval(() => { void hydratePersistentMemory(); }, 60_000);
    return () => clearInterval(id);
  }, []);

  // V33 Supreme — Garbage Collection: every 60s prune dormant per-symbol
  // memory + caches so the browser stays light with the 180-coin universe.
  useEffect(() => {
    const id = setInterval(() => { runMemoryGC(); }, 60_000);
    return () => clearInterval(id);
  }, []);

  // V34 — Shadow Learning resolver moved to Index.tsx so it runs
  // even when the user is viewing other tabs.

  // Rotate dynamic status text
  useEffect(() => {
    const id = setInterval(() => setStatusIdx(i => (i + 1) % STATUS_MESSAGES.length), 3500);
    return () => clearInterval(id);
  }, []);

  // V30 — Live tick every 500ms (was 1s) for smoother shield countdown + faster
  // re-evaluation of indicators against live WebSocket price ticks.
  useEffect(() => {
    const id = setInterval(() => forceTick(t => t + 1), 500);
    return () => clearInterval(id);
  }, []);

  // V31 — Auto-Frame Watcher: scans ALL frames in parallel; hops UI to the
  // first frame producing a strong PASSED signal. Disabled when toggle is OFF.
  const watcher = useAutoFrameWatcher(autoFrameMode);

  const toggleAutoFrameMode = () => {
    const next = !autoFrameMode;
    setAutoFrameMode(next);
    try { localStorage.setItem("sniper.autoFrameMode", next ? "1" : "0"); } catch { /* empty */ }
    // V33 Supreme — تفعيل ضمني لمسح كل الفريمات عند تشغيل Auto-Frame.
    saveSniperSettings({ autoFrameAllFrames: next });
  };

  // V33 — anti-jitter cooldown (5s) between automatic frame jumps
  const { canJump, markJump } = useJumpCooldown();

  // React-time hop with cooldown + notification + 24h summary (V33 Phase 3).
  useEffect(() => {
    if (!autoFrameMode) return;
    if (!watcher.bestFrame) return;
    if (watcher.bestFrame === tf) return;
    if (!canJump()) {
      logDebug("cooldown", `❄️ تبريد القفز نشط — رفض الانتقال إلى ${watcher.bestFrame}`, { frame: tf });
      return; // V33 — wait out the 5s cooldown
    }
    const target = watcher.bestFrame;
    const sig = watcher.bestSignal;
    setTf(target);
    markJump();
    setLastAutoFrameAt(Date.now());
    setAutoFrameBusy(true);
    // V33 — Passed Signal Notification (instant) + 24h Summary (async enrich)
    if (sig) {
      const toastId = toast(`🎯 قفزة تلقائية إلى ${target}`, {
        description: `${sig.baseAsset} • قوة ${sig.multiIndicator.confidence}% • جاري جلب ملخص 24س…`,
        duration: 6000,
      });
      // V33 Phase 3 — enrich the toast with 24h price action so the user sees
      // immediate market context for the symbol we just jumped into.
      import("@/lib/binanceDataLayer").then(({ fetchTicker24h }) =>
        fetchTicker24h(sig.symbol).then((tk) => {
          if (!tk) return;
          const arrow = tk.priceChangePercent >= 0 ? "🟢 +" : "🔴 ";
          toast(`📊 ${sig.baseAsset} — ملخص 24س`, {
            id: toastId,
            description:
              `${arrow}${tk.priceChangePercent.toFixed(2)}% • `
              + `سعر ${tk.lastPrice} • `
              + `أعلى ${tk.highPrice} / أدنى ${tk.lowPrice} • `
              + `سيولة ${(tk.quoteVolume / 1e6).toFixed(1)}M$`,
            duration: 7000,
          });
        }).catch(() => {/* keep original toast */ })
      );
    }
    const id = setTimeout(() => setAutoFrameBusy(false), 800);
    return () => clearTimeout(id);
  }, [autoFrameMode, watcher.bestFrame, watcher.bestSignal, tf, canJump, markJump]);


  const fng = data?.fearGreed ?? null;

  // V33 — قراءة تقييم الذكاء الفعلي من Supabase (جدول `تدفق_بيانات_السوق`)
  const { data: intel } = useMarketIntelligence(true);

  // Run analysis (uses current engine meta penalty) ثم نُحقن قرار الذكاء عليه
  const baseSignals = data ? analyzeSniperScan(data.symbols, tf, fng) : [];
  const signals = baseSignals.map(s => enrichSignalWithIntel(s, intel)) as SniperSignal[];
  const visible = showOnlyPassed ? signals.filter(s => s.passed) : signals;
  const passedCount = signals.filter(s => s.passed).length;

  // V44 — السجل والمحفظة الوهمية يُداران من Index.tsx عبر props
  const log = propsLog ?? [];
  const clearLog = propsLogState?.clear ?? (() => { });
  const wins = propsLogState?.wins ?? 0;
  const losses = propsLogState?.losses ?? 0;
  const winRate = propsLogState?.winRate ?? 0;
  const resolvedCount = propsLogState?.resolvedCount ?? 0;
  const portfolio = { balance: 0, equity: 0, floatingPnl: 0, initialBalance: 10000, totalPnl: 0, totalPnlPct: 0, trades: [] as never[], wins: 0, losses: 0, reset: () => { }, removeTrade: () => { } };

  // Meta-performance derived from the resolved log → feeds back into engine on next scan
  const meta = useMetaPerformance(log);
  useEffect(() => { setEngineMetaPenalty(meta.metaPenalty); }, [meta.metaPenalty]);

  const isExtremeGreed = fng ? fng.value >= 75 : false;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Crosshair className="w-5 h-5 text-gold" />
        <h2 className="font-cairo font-bold text-lg text-foreground">🎯 وضع القناص</h2>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-gold/15 text-gold font-bold">Binance Live</span>
        <button
          onClick={() => setPaperMode(!paper)}
          title={paper ? "إيقاف وضع المحاكاة (سيُستأنف الحفظ في Supabase)" : "تشغيل وضع المحاكاة (إشارات بدون حفظ في Supabase ولا أوامر فعلية)"}
          className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-bold border ${paper ? "bg-cyan-500/20 text-cyan-300 border-cyan-400/60" : "bg-secondary text-muted-foreground border-border hover:border-cyan-400/40"}`}
        >
          <FlaskConical className="w-3 h-3" />
          {paper ? "محاكاة • Paper" : "تنفيذ • Live"}
        </button>
        <button
          onClick={() => refetch()}
          className="mr-auto p-1.5 rounded-lg hover:bg-secondary"
          title="حدّث المسح"
        >
          <RefreshCw className={`w-4 h-4 text-muted-foreground ${isRefetching ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Fear & Greed bar + Short-hunt notice */}
      {fng && (
        <div className={`flex items-center gap-2 p-3 rounded-xl border ${isExtremeGreed ? "bg-stock-red/10 border-stock-red/40" : fng.value < 40 ? "bg-stock-red/10 border-stock-red/40" : fng.value <= 25 ? "bg-stock-green/10 border-stock-green/40" : "bg-secondary border-border"
          }`}>
          <Brain className="w-4 h-4 text-gold shrink-0" />
          <div className="text-xs flex-1">
            <span className="font-bold text-foreground">مؤشر الخوف والطمع: {fng.value}</span>
            <span className="text-muted-foreground"> • {fng.classification}</span>
            {isExtremeGreed && <span className="text-stock-red font-bold"> • معايير صارمة 99.9%</span>}
          </div>
          {fng.value < 40 && (
            <span className="text-[10px] px-2 py-0.5 rounded-md bg-stock-red text-background font-bold flex items-center gap-1">
              <TrendingDown className="w-3 h-3" /> صيد هبوط مفعّل
            </span>
          )}
        </div>
      )}

      {/* Meta-performance mood + dynamic status text */}
      <div className={`flex items-center gap-2 p-2.5 rounded-lg border ${meta.mood === "lockdown" ? "bg-stock-red/10 border-stock-red/40" :
        meta.mood === "defensive" ? "bg-gold/10 border-gold/30" :
          meta.mood === "boosting" ? "bg-stock-green/10 border-stock-green/30" :
            "bg-gold/5 border-gold/20"
        }`}>
        <Gauge className="w-3.5 h-3.5 text-gold shrink-0" />
        <p className="text-[11px] text-foreground/85 font-bold leading-relaxed">
          {meta.moodLabel}
          {meta.recentResolved >= 3 && (
            <span className="text-muted-foreground font-normal mr-1">
              • تعديل العتبة +{meta.metaPenalty}
            </span>
          )}
        </p>
      </div>

      {/* Dynamic status text — Sniper UI Part 2 */}
      <div className="flex items-center gap-2 p-2.5 rounded-lg bg-gold/5 border border-gold/20">
        <Activity className="w-3.5 h-3.5 text-gold shrink-0 animate-pulse" />
        <p className="text-[11px] text-foreground/80 font-medium leading-relaxed">
          {STATUS_MESSAGES[statusIdx]}
        </p>
      </div>

      {/* Timeframe selector + Auto-Frame */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-muted-foreground font-bold">اختر الفريم:</p>
          <button
            onClick={toggleAutoFrameMode}
            role="switch"
            aria-checked={autoFrameMode}
            title={autoFrameMode ? "إيقاف المراقبة المتوازية" : "تفعيل مسح كل الفريمات لحظياً والقفز للأقوى"}
            className={`flex items-center gap-2 px-2 py-1 rounded-md border text-[10px] font-bold transition-colors ${autoFrameMode
              ? "border-cyan-400/60 bg-cyan-500/15 text-cyan-200"
              : "border-border bg-secondary text-muted-foreground hover:border-cyan-500/40"
              }`}
          >
            <Wand2 className={`w-3 h-3 ${autoFrameBusy ? "animate-pulse" : ""}`} />
            <span>Auto-Frame</span>
            <span
              className={`relative inline-flex h-3.5 w-7 items-center rounded-full transition-colors ${autoFrameMode ? "bg-cyan-400" : "bg-muted"
                }`}
            >
              <span
                className={`inline-block h-2.5 w-2.5 transform rounded-full bg-background transition-transform ${autoFrameMode ? "translate-x-3.5" : "translate-x-0.5"
                  }`}
              />
            </span>
          </button>
        </div>
        {autoFrameMode && (
          <div className="space-y-1 p-2 rounded-md border border-cyan-500/30 bg-cyan-500/5">
            <p className="text-[10px] text-cyan-300 leading-tight font-bold">
              ⚡ المراقبة المتوازية مفعَّلة — مسح كل الفريمات لحظياً (1m · 5m · 15m · 1h · 4h)
            </p>
            <div className="flex flex-wrap gap-1 text-[9px]">
              {watcher.candidates.map(c => (
                <span
                  key={c.frame}
                  className={`px-1.5 py-0.5 rounded border font-bold ${c.frame === tf
                    ? "bg-cyan-400/20 border-cyan-400 text-cyan-100"
                    : c.passedCount > 0
                      ? "bg-stock-green/15 border-stock-green/40 text-stock-green"
                      : c.loading
                        ? "bg-muted/30 border-border text-muted-foreground animate-pulse"
                        : "bg-secondary border-border text-muted-foreground/70"
                    }`}
                  title={c.topSignal ? `${c.topSignal.baseAsset} • ${c.topSignal.multiIndicator.confidence}%` : "لا توجد إشارة"}
                >
                  {c.frame} {c.passedCount > 0 ? `· ${c.passedCount}✓` : c.loading ? "…" : "—"}
                </span>
              ))}
            </div>
            {watcher.bestSignal && (
              <p className="text-[9px] text-cyan-200/90 leading-tight">
                🎯 أفضل فرصة الآن: <b>{watcher.bestSignal.baseAsset}</b> على {watcher.bestFrame} ({watcher.bestSignal.multiIndicator.confidence}%)
              </p>
            )}
            {lastAutoFrameAt && (
              <p className="text-[9px] text-muted-foreground">
                آخر قفزة تلقائية: {new Date(lastAutoFrameAt).toLocaleTimeString("ar-EG")}
              </p>
            )}
          </div>
        )}
        <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
          {TIMEFRAMES.map(t => (
            <button
              key={t.id}
              onClick={() => { if (!autoFrameMode) setTf(t.id); }}
              disabled={autoFrameMode}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap border transition-all ${tf === t.id
                ? "bg-gold text-background border-gold"
                : "bg-secondary text-foreground border-border hover:border-gold/40"
                } ${autoFrameMode && tf !== t.id ? "opacity-40 cursor-not-allowed" : ""}`}
            >
              {t.label} <span className="text-[9px] opacity-70">{t.type === "scalp" ? "سكالب" : "سوينج"}</span>
            </button>

          ))}
        </div>
      </div>

      {/* V33 — Scan Limit Slider */}
      <div className="p-2.5 rounded-lg bg-secondary/40 border border-border space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-bold text-foreground flex items-center gap-1.5">
            <Crosshair className="w-3.5 h-3.5 text-gold" />
            عدد العملات في المسح
          </p>
          <span className="text-[10px] font-bold text-gold tabular-nums">{scanLimit} عملة</span>
        </div>
        <input
          type="range"
          min={SCAN_LIMIT_MIN}
          max={SCAN_LIMIT_MAX}
          step={10}
          value={scanLimit}
          onChange={e => updateScanLimit(Number(e.target.value))}
          className="w-full h-1.5 rounded-full bg-secondary accent-gold cursor-pointer"
        />
        <p className="text-[9px] text-muted-foreground leading-tight">
          من {SCAN_LIMIT_MIN} إلى {SCAN_LIMIT_MAX} عملة (أعلى سيولة) — ارفعها لو جهازك يسمح بمسح السوق كله.
        </p>
      </div>

      {/* تم نقل: درع المطبخ + المدة الديناميكية + حساسية كشف الفخاخ إلى تاب "الدروع". */}

      <div className="flex items-center justify-between gap-2 text-xs">
        <div className="text-muted-foreground">
          مسح <span className="font-bold text-foreground">{signals.length}</span> عملة •
          <span className="font-bold text-stock-green"> {passedCount}</span> اجتازت كل الفلاتر
        </div>
        <button
          onClick={() => setShowOnlyPassed(p => !p)}
          className={`px-2 py-1 rounded-md border text-[10px] font-bold ${showOnlyPassed ? "bg-stock-green/15 text-stock-green border-stock-green/40" : "bg-secondary text-muted-foreground border-border"
            }`}
        >
          {showOnlyPassed ? "✓ القناص فقط" : "كل العملات"}
        </button>
      </div>

      {/* Loading / error */}
      {isLoading && (
        <div className="flex flex-col items-center py-12 gap-3">
          <RefreshCw className="w-7 h-7 text-gold animate-spin" />
          <p className="text-xs text-muted-foreground">القناص بيمسح السوق...</p>
          {progress.total > 0 && (
            <div className="w-full max-w-xs space-y-1.5">
              <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                <div
                  className="h-full bg-gold transition-all duration-300"
                  style={{ width: `${(progress.done / progress.total) * 100}%` }}
                />
              </div>
              <p className="text-[10px] text-center text-gold font-bold">
                جاري مسح {progress.done} من {progress.total} عملة
              </p>
            </div>
          )}
        </div>
      )}
      {isError && (
        <div className="text-center py-8 text-sm text-stock-red">
          فشل المسح. اضغط تحديث.
        </div>
      )}

      {/* Signals list */}
      {!isLoading && !isError && (
        <div className="space-y-3">
          {visible.length === 0 ? (
            <div className="text-center py-12 rounded-xl gradient-card gold-border p-6">
              <Crosshair className="w-8 h-8 text-gold mx-auto mb-2" />
              <p className="text-gold font-bold text-base mb-1">القناص ماشاف هدف دلوقتي</p>
              <p className="text-muted-foreground text-xs">
                {showOnlyPassed ? "مفيش عملة محققة كل الفلاتر الـ5. جرب فريم تاني أو شيل الفلتر." : "مفيش بيانات."}
              </p>
            </div>
          ) : (
            visible.map((s, i) => <SniperCard key={s.symbol} signal={s} index={i} />)
          )}
        </div>
      )}

      {/* محفظة القناص الوهمية وسجل التوصيات — انتقلت إلى تبويب المحفظة */}
      {!isLoading && (
        <div className="pt-2 border-t border-border">
          <p className="text-center text-[10px] text-muted-foreground py-2">
            📊 المحفظة الوهمية وسجل التوصيات انتقلوا إلى <span className="text-gold font-bold">💼 المحفظة</span>
          </p>
        </div>
      )}

      <p className="text-[10px] text-muted-foreground text-center mt-4">
        ⚠️ بيانات لحظية من Binance • القناص بيقفل على شموع/فوليوم/حيتان/RSI/F&G • مش نصيحة استثمارية
      </p>
    </div>
  );
};

const SniperCard = ({ signal: s, index }: { signal: SniperSignal; index: number }) => {
  const livePrice = useBinanceLivePrice(s.symbol);
  const displayPrice = livePrice ?? s.price;
  const liveDelta = livePrice != null ? ((livePrice - s.price) / s.price) * 100 : 0;
  const liveColor = liveDelta > 0.05 ? "text-stock-green" : liveDelta < -0.05 ? "text-stock-red" : "text-foreground";

  const isShort = s.direction === "short";
  const glow = s.passed
    ? (isShort
      ? "shadow-[0_0_24px_hsl(var(--stock-red)/0.45)] border-stock-red animate-pulse"
      : "shadow-[0_0_24px_hsl(var(--stock-green)/0.45)] border-stock-green animate-pulse-green")
    : "border-border";
  return (
    <div
      className={`rounded-xl gradient-card border p-4 animate-fade-up ${glow}`}
      style={{ animationDelay: `${index * 40}ms` }}
    >
      {/* Trap detection banner (V18) */}
      {s.quality.trap.detected && (
        <div className="flex items-center gap-2 mb-2 p-2 rounded-lg bg-stock-red/10 border border-stock-red/40">
          <AlertTriangle className="w-4 h-4 text-stock-red shrink-0" />
          <p className="text-[11px] font-bold text-stock-red leading-tight">
            🪤 فخ مكتشف: {s.quality.trap.reason} — الإشارة مرفوضة
          </p>
        </div>
      )}

      {/* Emergency exit banner — Part 2 */}
      {s.emergencyExit && (
        <div className="flex items-center gap-2 mb-2 p-2 rounded-lg bg-stock-red/15 border border-stock-red/50 animate-pulse">
          <AlertTriangle className="w-4 h-4 text-stock-red shrink-0" />
          <p className="text-[11px] font-bold text-stock-red leading-tight">
            ⚠️ أمر خروج اضطراري: تدفق الحيتان انقلب من إيجابي إلى سالب
          </p>
        </div>
      )}

      {/* 120s Silent Shield countdown — Part 2 */}
      {s.shieldActive && (
        <div className="flex items-center gap-2 mb-2 p-1.5 rounded-md bg-gold/10 border border-gold/30">
          <Shield className="w-3 h-3 text-gold shrink-0" />
          <p className="text-[10px] text-gold font-bold">
            المراقب الصامت نشط: {s.shieldRemainingSec}ث متبقية
          </p>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span className={`text-[10px] px-2 py-0.5 rounded-md font-bold flex items-center gap-1 ${isShort ? "bg-stock-red text-background" : "bg-stock-green text-background"
          }`}>
          {isShort ? <TrendingDown className="w-3 h-3" /> : <TrendingUp className="w-3 h-3" />}
          {isShort ? "Short / بيع" : "Long / شراء"}
        </span>
        <span className="text-[10px] px-2 py-0.5 rounded-md bg-gold/15 text-gold font-bold">فريم {s.timeframe}</span>
        {s.passed && (
          <span className={`text-[10px] px-2 py-0.5 rounded-md font-bold flex items-center gap-1 ${s.quality.grade === "A+" ? "bg-stock-green text-background" :
            s.quality.grade === "A" ? "bg-gold text-background" :
              "bg-foreground text-background"
            }`}>
            <Award className="w-3 h-3" /> {s.quality.grade}
          </span>
        )}
        <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-secondary text-foreground/80 font-bold">{s.regime.label}</span>
        <span className="mr-auto text-xs font-bold text-foreground">{s.baseAsset}/USDT</span>
      </div>

      {/* Quality breakdown row */}
      {s.passed && (
        <div className="grid grid-cols-3 gap-1.5 mb-2 text-[10px]">
          <div className="p-1.5 rounded-md bg-gold/10 border border-gold/30 text-center">
            <p className="text-[9px] text-muted-foreground">Quality Score</p>
            <p className="font-bold text-gold">{s.quality.total}/100</p>
          </div>
          <div className="p-1.5 rounded-md bg-stock-green/10 border border-stock-green/30 text-center">
            <p className="text-[9px] text-muted-foreground flex items-center justify-center gap-0.5"><Target className="w-2.5 h-2.5" /> احتمال T1</p>
            <p className="font-bold text-stock-green">{s.quality.targetProbability}%</p>
          </div>
          <div className="p-1.5 rounded-md bg-secondary border border-border text-center">
            <p className="text-[9px] text-muted-foreground">Risk/Reward</p>
            <p className="font-bold text-foreground">1:{s.riskReward.toFixed(2)}</p>
          </div>
        </div>
      )}

      {/* Price + live + confidence */}
      <div className="flex items-end justify-between mb-2 gap-2">
        <div>
          <p className="text-[10px] text-muted-foreground">السعر عند الإشارة</p>
          <p className="font-bold text-sm text-foreground">{formatPrice(s.price)}</p>
        </div>
        <div className="text-center">
          <p className="text-[10px] text-muted-foreground flex items-center gap-1 justify-center">
            <Radio className={`w-2.5 h-2.5 ${livePrice != null ? "text-stock-green animate-pulse" : "text-muted-foreground"}`} />
            مباشر
          </p>
          <p className={`font-bold text-sm ${liveColor}`}>{formatPrice(displayPrice)}</p>
          {livePrice != null && Math.abs(liveDelta) >= 0.01 && (
            <p className={`text-[9px] ${liveColor}`}>
              {liveDelta >= 0 ? "+" : ""}{liveDelta.toFixed(2)}%
            </p>
          )}
        </div>
        <div className="text-left">
          <p className="text-[10px] text-muted-foreground">ثقة</p>
          <p className={`font-bold text-sm ${s.passed ? "text-stock-green" : s.passedCount >= 3 ? "text-gold" : "text-muted-foreground"}`}>
            {s.confidence}%
          </p>
        </div>
      </div>

      {/* Filters row */}
      <div className="grid grid-cols-5 gap-1 mb-3 text-[9px]">
        <FilterPill ok={s.pattern !== "none"} icon={<Activity className="w-3 h-3" />} label={s.patternLabel} />
        <FilterPill ok={s.volumeExplosion} icon={<Flame className="w-3 h-3" />} label={`×${s.volumeRatio.toFixed(1)}`} />
        <FilterPill ok={s.whalesBullish} icon={<Fish className="w-3 h-3" />} label={`${s.netFlowPct >= 0 ? "+" : ""}${s.netFlowPct.toFixed(0)}%`} />
        <FilterPill ok={s.rsiOk} label={`RSI ${s.rsi.toFixed(0)}`} />
        <FilterPill ok={s.fngOk} icon={<Brain className="w-3 h-3" />} label={s.fearGreed ? `${s.fearGreed.value}` : "—"} />
      </div>

      {/* Profit calculator + ETA — Part 2 */}
      <div className="grid grid-cols-3 gap-1.5 mb-3">
        <div className="p-2 rounded-md bg-stock-green/10 border border-stock-green/30 text-center">
          <div className="flex items-center justify-center gap-0.5 text-[9px] text-muted-foreground mb-0.5">
            <DollarSign className="w-2.5 h-2.5" /> $100→T1
          </div>
          <p className="text-[11px] font-bold text-stock-green">+${s.profit100T1.toFixed(2)}</p>
        </div>
        <div className="p-2 rounded-md bg-stock-green/15 border border-stock-green/40 text-center">
          <div className="flex items-center justify-center gap-0.5 text-[9px] text-muted-foreground mb-0.5">
            <DollarSign className="w-2.5 h-2.5" /> $100→T2
          </div>
          <p className="text-[11px] font-bold text-stock-green">+${s.profit100T2.toFixed(2)}</p>
        </div>
        <div className="p-2 rounded-md bg-gold/10 border border-gold/30 text-center">
          <div className="flex items-center justify-center gap-0.5 text-[9px] text-muted-foreground mb-0.5">
            <Clock className="w-2.5 h-2.5" /> زمن الهدف
          </div>
          <p className="text-[11px] font-bold text-gold">{s.estTimeLabel}</p>
        </div>
      </div>

      {/* V17 Multi-Indicator panel — autonomous analyst */}
      <div className="mb-2 p-2 rounded-md bg-foreground/5 border border-foreground/10">
        <p className="text-[10px] font-bold text-foreground/80 mb-1 flex items-center gap-1">
          <Brain className="w-3 h-3 text-gold" /> المحلل المستقل V20 — توافق {s.multiIndicator.agreeingIndicators}/10 مؤشرات
          <span className={`mr-auto text-[10px] font-bold ${s.multiIndicator.confidence >= 80 ? "text-stock-green" : s.multiIndicator.confidence >= 65 ? "text-gold" : "text-muted-foreground"}`}>
            {s.multiIndicator.confidence}%
          </span>
        </p>
        <div className="grid grid-cols-3 gap-1 text-[9px]">
          <IndicatorChip label="RSI" score={s.multiIndicator.reading.rsiScore} value={s.multiIndicator.reading.rsi.toFixed(0)} />
          <IndicatorChip label="MACD" score={s.multiIndicator.reading.macdScore} value={s.multiIndicator.reading.macdHist > 0 ? "صاعد" : "هابط"} />
          <IndicatorChip label="BB" score={s.multiIndicator.reading.bbScore} value={`${(s.multiIndicator.reading.bbPosition * 100).toFixed(0)}%`} />
          <IndicatorChip label="EMA" score={s.multiIndicator.reading.emaScore} value={s.multiIndicator.reading.emaCrossBull ? "ذهبي" : "موت"} />
          <IndicatorChip label="فوليوم" score={s.multiIndicator.reading.volumeScore} value={`×${s.multiIndicator.reading.volumeRatio.toFixed(1)}`} />
          <IndicatorChip label="حيتان" score={s.multiIndicator.reading.whaleScore} value={`${s.multiIndicator.reading.whaleFlowPct >= 0 ? "+" : ""}${s.multiIndicator.reading.whaleFlowPct.toFixed(0)}%`} />
        </div>
      </div>

      {/* "Why this signal?" explanation */}
      {s.passed && (
        <div className="mb-2 p-2 rounded-md bg-gold/5 border border-gold/20">
          <p className="text-[10px] font-bold text-gold mb-1 flex items-center gap-1">
            <Lightbulb className="w-3 h-3" /> ليه التوصية دي؟
          </p>
          <ul className="space-y-0.5 text-[10px] text-foreground/85 leading-relaxed">
            <li>• {s.patternLabel} ظهر على فريم {s.timeframe}</li>
            <li>• فوليوم انفجر ×{s.volumeRatio.toFixed(2)} فوق المتوسط = اهتمام مفاجئ</li>
            <li>• حيتان {s.whalesBullish ? "بتشتري بقوة" : "متوازنة"} ({s.netFlowPct >= 0 ? "+" : ""}{s.netFlowPct.toFixed(1)}%)</li>
            <li>• RSI {s.rsi.toFixed(0)} في منطقة دخول صحية مش مشبعة</li>
            {s.fearGreed && <li>• الخوف والطمع {s.fearGreed.value} — السوق {s.fearGreed.classification}</li>}
            {s.shieldActive && <li>• 🛡️ المراقب الصامت مفعّل ({s.shieldRemainingSec}ث) للتأكد من ثبات الدعم</li>}
            <li>• 🤖 {s.multiIndicator.reasonLine}</li>
          </ul>
        </div>
      )}

      {/* Score line */}
      <p className="text-[10px] text-muted-foreground leading-relaxed border-t border-border pt-2 mb-3">
        {s.scoreLine}
      </p>

      {/* Trade plan */}
      <div className="space-y-1">
        <PlanRow label="دخول" value={s.entry} color="text-foreground" />
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-muted-foreground flex items-center gap-1">
            <Radio className={`w-2.5 h-2.5 ${livePrice != null ? "text-stock-green animate-pulse" : "text-muted-foreground"}`} />
            السعر المباشر
          </span>
          <span className={`font-bold ${liveColor}`}>
            {formatPrice(displayPrice)}
            {livePrice != null && Math.abs(liveDelta) >= 0.01 && (
              <span className="text-[9px] mr-1 opacity-80">({liveDelta >= 0 ? "+" : ""}{liveDelta.toFixed(2)}%)</span>
            )}
          </span>
        </div>
        <PlanRow label="هدف 1" value={s.target1} color="text-stock-green" />
        <PlanRow label="هدف 2" value={s.target2} color="text-stock-green" />
        <PlanRow label="وقف خسارة" value={s.stopLoss} color="text-stock-red" />
        <div className="flex justify-between text-[10px] pt-1">
          <span className="text-muted-foreground">R/R</span>
          <span className="font-bold text-gold">{s.riskReward}</span>
        </div>
      </div>
    </div>
  );
};

const FilterPill = ({ ok, icon, label }: { ok: boolean; icon?: React.ReactNode; label: string }) => (
  <div className={`flex items-center justify-center gap-0.5 px-1.5 py-1 rounded-md border ${ok ? "bg-stock-green/10 border-stock-green/40 text-stock-green" : "bg-stock-red/10 border-stock-red/30 text-stock-red/70"
    }`}>
    {ok ? <Check className="w-2.5 h-2.5 shrink-0" /> : <X className="w-2.5 h-2.5 shrink-0" />}
    {icon}
    <span className="font-bold truncate">{label}</span>
  </div>
);

const IndicatorChip = ({ label, score, value }: { label: string; score: number; value: string }) => {
  const color = score >= 80 ? "bg-stock-green/15 border-stock-green/40 text-stock-green"
    : score >= 60 ? "bg-gold/15 border-gold/40 text-gold"
      : "bg-stock-red/10 border-stock-red/30 text-stock-red/80";
  return (
    <div className={`flex flex-col items-center px-1 py-1 rounded border ${color}`}>
      <span className="font-bold text-[9px] opacity-80">{label}</span>
      <span className="font-bold">{value}</span>
      <span className="text-[8px] opacity-70">{score}%</span>
    </div>
  );
};

const PlanRow = ({ label, value, color }: { label: string; value: number; color: string }) => {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(String(value));
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1.5">
        <span className={`font-bold ${color}`}>{formatPrice(value)}</span>
        <button onClick={copy} className="p-0.5 rounded hover:bg-secondary" title="نسخ">
          {copied ? <Check className="w-3 h-3 text-stock-green" /> : <Copy className="w-3 h-3 text-muted-foreground" />}
        </button>
      </div>
    </div>
  );
};

export default SniperTab;
