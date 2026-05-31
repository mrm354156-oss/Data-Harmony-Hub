// V28+V33 — Backtesting Panel with CSV export + Cache Dashboard + auto-extend
import { useEffect, useState } from "react";
import { Play, Loader2, TrendingUp, TrendingDown, BarChart3, Target, AlertCircle, Download, Database } from "lucide-react";
import {
  runBacktest,
  DEFAULT_BACKTEST_CONFIG,
  type BacktestConfig,
  type BacktestResult,
  type BacktestTrade,
} from "@/lib/backtestEngine";
import type { SniperTimeframe } from "@/lib/sniperEngine";
import { dataCacheStats } from "@/lib/binanceDataLayer";

const PRESET_SYMBOLS = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT",
  "ADAUSDT", "DOGEUSDT", "AVAXUSDT", "LINKUSDT", "DOTUSDT",
];

const TF_OPTIONS: SniperTimeframe[] = ["5m", "15m", "1h", "4h"];

const BacktestPanel = () => {
  const [tf, setTf] = useState<SniperTimeframe>("15m");
  const [lookback, setLookback] = useState(500);
  const [feePct, setFeePct] = useState(0.1);
  const [slippagePct, setSlippagePct] = useState(0.05);
  const [riskPct, setRiskPct] = useState(1.0);
  const [selectedSymbols, setSelectedSymbols] = useState<string[]>(["BTCUSDT", "ETHUSDT", "SOLUSDT"]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, status: "" });
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggleSymbol = (s: string) => {
    setSelectedSymbols(curr =>
      curr.includes(s) ? curr.filter(x => x !== s) : [...curr, s]
    );
  };

  const run = async () => {
    if (selectedSymbols.length === 0) {
      setError("اختر عملة واحدة على الأقل");
      return;
    }
    setError(null);
    setRunning(true);
    setResult(null);
    setProgress({ done: 0, total: selectedSymbols.length, status: "بدء التشغيل..." });

    const cfg: BacktestConfig = {
      ...DEFAULT_BACKTEST_CONFIG,
      timeframe: tf,
      symbols: selectedSymbols,
      lookbackCandles: lookback,
      feePct,
      slippagePct,
      riskPerTradePct: riskPct,
    };
    try {
      const res = await runBacktest(cfg, (d, t, s) => setProgress({ done: d, total: t, status: s }));
      setResult(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "فشل الاختبار");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card/60 p-3 space-y-3">
      <div className="flex items-center gap-2">
        <BarChart3 className="w-4 h-4 text-cyan-400" />
        <h3 className="text-sm font-bold">Backtest — اختبار الاستراتيجية</h3>
        <span className="text-[10px] text-muted-foreground">V28</span>
      </div>

      {/* Config */}
      <div className="space-y-2">
        {/* Timeframe */}
        <div className="flex items-center gap-2 text-[11px]">
          <span className="text-muted-foreground w-20">الفريم:</span>
          <div className="flex gap-1 flex-wrap">
            {TF_OPTIONS.map(t => (
              <button
                key={t}
                onClick={() => setTf(t)}
                className={`px-2 py-0.5 rounded font-mono text-[11px] border ${tf === t
                    ? "bg-primary/20 border-primary text-primary"
                    : "bg-muted/30 border-border text-muted-foreground"
                  }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* Symbols */}
        <div className="flex items-start gap-2 text-[11px]">
          <span className="text-muted-foreground w-20 pt-0.5">العملات:</span>
          <div className="flex gap-1 flex-wrap flex-1">
            {PRESET_SYMBOLS.map(s => (
              <button
                key={s}
                onClick={() => toggleSymbol(s)}
                className={`px-1.5 py-0.5 rounded font-mono text-[10px] border ${selectedSymbols.includes(s)
                    ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300"
                    : "bg-muted/30 border-border text-muted-foreground"
                  }`}
              >
                {s.replace("USDT", "")}
              </button>
            ))}
          </div>
        </div>

        {/* Numeric config */}
        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <NumField label="شموع تاريخية" value={lookback} onChange={setLookback} step={100} min={100} max={10000} />
          <NumField label="رسوم (%/side)" value={feePct} onChange={setFeePct} step={0.01} min={0} max={1} />
          <NumField label="slippage (%)" value={slippagePct} onChange={setSlippagePct} step={0.01} min={0} max={1} />
          <NumField label="مخاطرة/صفقة (%)" value={riskPct} onChange={setRiskPct} step={0.25} min={0.25} max={5} />
        </div>
        <p className="text-[9px] text-muted-foreground leading-tight">
          💡 السيستم يوسّع المدى تلقائياً لو الصفقات أقل من 10 (حتى 10,000 شمعة).
        </p>
      </div>

      {/* Run button */}
      <button
        onClick={run}
        disabled={running || selectedSymbols.length === 0}
        className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-primary/20 border border-primary/40 text-primary font-semibold text-sm hover:bg-primary/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {running ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            {progress.status} ({progress.done}/{progress.total})
          </>
        ) : (
          <>
            <Play className="w-4 h-4" />
            تشغيل Backtest
          </>
        )}
      </button>

      {error && (
        <div className="flex items-center gap-2 text-[11px] text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2">
          <AlertCircle className="w-3 h-3" />
          {error}
        </div>
      )}

      {/* Results */}
      {result && <ResultView result={result} />}

      {/* V33 — Cache Dashboard */}
      <CacheDashboard />

      <div className="text-[10px] text-muted-foreground/80 leading-relaxed border-t border-border pt-2">
        💡 الاختبار يستخدم نفس محرك القناص على بيانات Binance التاريخية. يحاكي T1/T2/SL
        مع رسوم و slippage واقعية. السيستم يوسّع المدى تلقائياً لو الصفقات قليلة.
      </div>
    </div>
  );
};

function ResultView({ result }: { result: BacktestResult }) {
  const m = result.metrics;
  const rating = getRating(m);

  return (
    <div className="space-y-3 border-t border-border pt-3">
      {/* Headline rating + CSV export */}
      <div className={`rounded-lg border px-3 py-2 ${rating.cls}`}>
        <div className="flex items-center justify-between gap-2">
          <div className="font-bold text-sm">{rating.label}</div>
          <div className={`font-mono font-bold ${m.totalReturnPct >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
            {m.totalReturnPct >= 0 ? "+" : ""}{m.totalReturnPct.toFixed(2)}%
          </div>
        </div>
        <div className="text-[11px] opacity-90 mt-0.5">{rating.hint}</div>
        {result.trades.length > 0 && (
          <button
            onClick={() => exportTradesToCsv(result.trades)}
            className="mt-2 w-full flex items-center justify-center gap-1.5 px-2 py-1 rounded-md bg-background/60 border border-current/40 text-[11px] font-bold hover:bg-background/80"
          >
            <Download className="w-3 h-3" />
            تحميل CSV ({result.trades.length} صفقة)
          </button>
        )}
      </div>

      {/* Key metrics grid */}
      <div className="grid grid-cols-3 gap-2 text-[11px]">
        <Metric label="الصفقات" value={String(m.trades)} />
        <Metric label="معدل الفوز" value={`${(m.winRate * 100).toFixed(1)}%`}
          color={m.winRate >= 0.55 ? "text-emerald-400" : m.winRate >= 0.45 ? "text-amber-400" : "text-rose-400"} />
        <Metric label="Profit Factor" value={m.profitFactor.toFixed(2)}
          color={m.profitFactor >= 1.5 ? "text-emerald-400" : m.profitFactor >= 1.0 ? "text-amber-400" : "text-rose-400"} />
        <Metric label="Sharpe (ann.)" value={m.sharpe.toFixed(2)}
          color={m.sharpe >= 1 ? "text-emerald-400" : m.sharpe >= 0 ? "text-amber-400" : "text-rose-400"} />
        <Metric label="Max DD" value={`${m.maxDrawdownPct.toFixed(1)}%`}
          color={m.maxDrawdownPct < 10 ? "text-emerald-400" : m.maxDrawdownPct < 20 ? "text-amber-400" : "text-rose-400"} />
        <Metric label="Expectancy" value={`${m.expectancy.toFixed(2)}%`} />
        <Metric label="Avg R" value={m.avgR.toFixed(2)}
          color={m.avgR >= 0.3 ? "text-emerald-400" : m.avgR >= 0 ? "text-amber-400" : "text-rose-400"} />
        <Metric label="Avg Win R" value={`+${m.avgWinR.toFixed(2)}`} color="text-emerald-400" />
        <Metric label="Avg Loss R" value={m.avgLossR.toFixed(2)} color="text-rose-400" />
      </div>

      {/* Longs vs Shorts */}
      <div className="flex items-center gap-2 text-[11px]">
        <div className="flex-1 rounded-lg bg-emerald-500/10 px-2 py-1 flex items-center gap-1">
          <TrendingUp className="w-3 h-3 text-emerald-400" />
          <span>Longs: <span className="font-mono font-bold">{m.longs}</span></span>
        </div>
        <div className="flex-1 rounded-lg bg-rose-500/10 px-2 py-1 flex items-center gap-1">
          <TrendingDown className="w-3 h-3 text-rose-400" />
          <span>Shorts: <span className="font-mono font-bold">{m.shorts}</span></span>
        </div>
      </div>

      {/* Equity curve (mini sparkline) */}
      {m.equityCurve.length > 1 && <Sparkline curve={m.equityCurve} />}

      {/* Per-symbol breakdown */}
      <div className="space-y-1">
        <div className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1">
          <Target className="w-3 h-3" /> حسب العملة
        </div>
        {Object.entries(result.perSymbol).map(([sym, s]) => (
          <div key={sym} className="flex items-center justify-between text-[11px] px-2 py-1 rounded bg-muted/20">
            <span className="font-mono">{sym.replace("USDT", "")}</span>
            <span className="text-muted-foreground">
              {s.trades} صفقة · فوز {(s.winRate * 100).toFixed(0)}%
            </span>
            <span className={`font-mono font-bold ${s.pnlPct >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
              {s.pnlPct >= 0 ? "+" : ""}{s.pnlPct.toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Sparkline({ curve }: { curve: { t: number; balance: number; drawdown: number }[] }) {
  const balances = curve.map(c => c.balance);
  const min = Math.min(...balances);
  const max = Math.max(...balances);
  const range = max - min || 1;
  const W = 280, H = 60;
  const pts = balances.map((b, i) => {
    const x = (i / (balances.length - 1)) * W;
    const y = H - ((b - min) / range) * H;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const last = balances[balances.length - 1];
  const first = balances[0];
  const up = last >= first;
  return (
    <div className="rounded-lg border border-border bg-card/40 p-2">
      <div className="text-[10px] text-muted-foreground mb-1">منحنى الرصيد</div>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <polyline
          fill="none"
          stroke={up ? "rgb(52, 211, 153)" : "rgb(251, 113, 133)"}
          strokeWidth="1.5"
          points={pts}
        />
      </svg>
      <div className="flex justify-between text-[10px] text-muted-foreground font-mono mt-1">
        <span>${first.toFixed(0)}</span>
        <span className={up ? "text-emerald-400" : "text-rose-400"}>${last.toFixed(0)}</span>
      </div>
    </div>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-lg bg-muted/20 px-2 py-1.5">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={`font-mono font-bold ${color ?? "text-foreground"}`}>{value}</div>
    </div>
  );
}

function NumField({
  label, value, onChange, step = 1, min = 0, max = 1000,
}: { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number }) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-muted-foreground flex-1 text-[10px]">{label}</label>
      <input
        type="number"
        value={value}
        step={step}
        min={min}
        max={max}
        onChange={e => {
          const v = parseFloat(e.target.value);
          if (!isNaN(v)) onChange(v);
        }}
        className="w-20 bg-muted/40 border border-border rounded px-1.5 py-0.5 font-mono text-right text-[11px] focus:outline-none focus:border-primary"
      />
    </div>
  );
}

function getRating(m: { trades: number; winRate: number; profitFactor: number; sharpe: number; maxDrawdownPct: number; totalReturnPct: number }) {
  if (m.trades < 10) {
    return { label: "⚠️ عينة صغيرة", hint: "زد الشموع التاريخية أو العملات", cls: "border-amber-500/30 bg-amber-500/10 text-amber-300" };
  }
  const score =
    (m.winRate >= 0.55 ? 2 : m.winRate >= 0.5 ? 1 : 0) +
    (m.profitFactor >= 1.5 ? 2 : m.profitFactor >= 1 ? 1 : 0) +
    (m.sharpe >= 1 ? 2 : m.sharpe >= 0.5 ? 1 : 0) +
    (m.maxDrawdownPct < 15 ? 1 : 0) +
    (m.totalReturnPct > 0 ? 1 : 0);
  if (score >= 6) return { label: "✅ ممتاز — جاهز للاختبار الحقيقي على testnet", hint: "مقاييس قوية عبر معظم المعايير", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" };
  if (score >= 4) return { label: "🟡 جيد — يحتاج تحسينات قبل الإنتاج", hint: "بعض المقاييس تحت الممتاز", cls: "border-amber-500/40 bg-amber-500/10 text-amber-300" };
  return { label: "🔴 ضعيف — الاستراتيجية تحتاج مراجعة جوهرية", hint: "لا ننصح بربط رأس مال حقيقي بهذه الأرقام", cls: "border-rose-500/40 bg-rose-500/10 text-rose-300" };
}

// ─── V33 — CSV Export ────────────────────────────────────────────────────────
function exportTradesToCsv(trades: BacktestTrade[]) {
  const headers = [
    "Symbol", "Direction", "EntryTime", "EntryPrice", "ExitTime", "ExitPrice",
    "Outcome", "NetPnL%", "RawPnL%", "R", "Confidence", "Grade", "Pattern", "JudgeReason",
  ];
  const judgeReasonOf = (t: BacktestTrade): string => {
    switch (t.outcome) {
      case "target2": return "وصول الهدف الثاني — اتجاه قوي";
      case "target1": return "تأمين الهدف الأول + كسر BE";
      case "stopLoss": return "ضرب وقف الخسارة الديناميكي";
      case "expired": return "انتهاء مدة الصفقة (TTL Guard)";
      default: return "—";
    }
  };
  const rows = trades.map(t => [
    t.symbol, t.direction,
    new Date(t.entryTime).toISOString(), t.entryPrice.toFixed(6),
    new Date(t.exitTime).toISOString(), t.exitPrice.toFixed(6),
    t.outcome, t.netPnlPct.toFixed(3), t.rawPnlPct.toFixed(3),
    t.rMultiple.toFixed(3), String(t.confidence), t.grade ?? "—",
    t.pattern, judgeReasonOf(t),
  ]);
  const csv = [headers, ...rows]
    .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `backtest_${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── V33 — Cache Dashboard ───────────────────────────────────────────────────
function CacheDashboard() {
  const [stats, setStats] = useState(() => dataCacheStats());
  useEffect(() => {
    const id = setInterval(() => setStats(dataCacheStats()), 1500);
    return () => clearInterval(id);
  }, []);
  const ageMin = stats.symbolListAgeMs != null ? Math.round(stats.symbolListAgeMs / 60000) : null;
  return (
    <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/5 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Database className="w-3.5 h-3.5 text-cyan-300" />
        <h4 className="text-xs font-bold text-cyan-100">لوحة مراقبة الكاش</h4>
        <span className="text-[9px] text-muted-foreground mr-auto">V33 Supreme</span>
      </div>
      <div className="grid grid-cols-3 gap-1.5 text-[10px]">
        <CacheStat label="Klines (lite)" value={String(stats.klines)} />
        <CacheStat label="تاريخ 10K" value={String(stats.historical)} />
        <CacheStat label="Ticker 24س" value={String(stats.ticker24h)} />
      </div>
      <p className="text-[9px] text-cyan-200/80 leading-tight">
        قائمة العملات: {ageMin == null ? "لم تُحمّل بعد" : `محدثة قبل ${ageMin}د`} •
        الكاش يخفّض ضغط API ويحفظ 10,000 شمعة في الذاكرة لعدة دقائق.
      </p>
    </div>
  );
}
function CacheStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-cyan-500/10 border border-cyan-500/20 px-2 py-1 text-center">
      <div className="text-[9px] text-cyan-200/70">{label}</div>
      <div className="font-mono font-bold text-cyan-100">{value}</div>
    </div>
  );
}

export default BacktestPanel;
