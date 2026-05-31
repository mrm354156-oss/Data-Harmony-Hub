// V26 — Self-Learning Stats Panel
// يعرض إحصائيات التعلم الذاتي التي تُطبَّق على ثقة كل صفقة قبل إصدارها:
//   • المصدر (exact / regime-fallback)
//   • عدد العينات (الفعلي + المُرجَّح زمنياً)
//   • نسبة الفوز المُرجَّحة
//   • الـ adjustment المُطبَّق على الثقة (٪)
//   • سلسلة الخسائر الأخيرة (loss-streak)
import { useEffect, useMemo, useState } from "react";
import { forwardRef } from "react";
import { Brain, RefreshCw, TrendingUp, TrendingDown, Layers } from "lucide-react";
import {
  getAllLearningBuckets,
  getAllFallbackBuckets,
  refreshLearningCache,
  type BucketStats,
  type LearningSource,
} from "@/lib/learningFilter";

interface RowProps {
  bucket: BucketStats;
  source: LearningSource;
}

const sourceBadge = (s: LearningSource) =>
  s === "exact"
    ? { text: "exact", cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" }
    : { text: "regime-fallback", cls: "bg-sky-500/15 text-sky-300 border-sky-500/30" };

function Row({ bucket, source }: RowProps) {
  const adj = bucket.adjustment;
  const adjPositive = adj >= 0;
  const wr = Math.round(bucket.winRate * 100);
  const badge = sourceBadge(source);
  return (
    <div className="rounded-lg border border-border bg-card/40 px-3 py-2 text-xs space-y-1.5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`px-1.5 py-0.5 rounded border text-[10px] font-mono ${badge.cls}`}>
            {badge.text}
          </span>
          <span className="font-mono text-[11px] text-muted-foreground truncate">
            {bucket.timeframe} · {bucket.direction === "long" ? "🟢 long" : "🔴 short"} · {bucket.regimeLabel}
          </span>
        </div>
        <span
          className={`font-mono text-[11px] font-bold ${
            adjPositive ? "text-emerald-400" : "text-rose-400"
          }`}
        >
          {adjPositive ? "+" : ""}
          {adj.toFixed(1)}%
        </span>
      </div>
      <div className="flex items-center gap-3 text-[11px] text-muted-foreground flex-wrap">
        {source === "exact" && (
          <span>
            النموذج: <span className="text-foreground">{bucket.pattern}</span>
          </span>
        )}
        <span>
          العينات: <span className="text-foreground font-mono">{bucket.total}</span>
          <span className="text-muted-foreground/70"> (مرجَّح {bucket.weightedTotal.toFixed(1)})</span>
        </span>
        <span>
          فوز: <span className={`font-mono ${wr >= 60 ? "text-emerald-400" : wr >= 45 ? "text-amber-400" : "text-rose-400"}`}>{wr}%</span>
        </span>
        {bucket.lossStreak >= 2 && (
          <span className="flex items-center gap-1 text-rose-400">
            <TrendingDown className="w-3 h-3" />
            خسائر متتالية: <span className="font-mono">{bucket.lossStreak}</span>
          </span>
        )}
      </div>
    </div>
  );
}

const LearningStatsPanel = forwardRef<HTMLDivElement>((_props, _ref) => {
  const [, setTick] = useState(0);

  // إعادة قراءة الكاش كل 15ث لمواكبة الصفقات الجديدة المُحلولة
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 15_000);
    return () => clearInterval(id);
  }, []);

  const exactBuckets = useMemo(() => getAllLearningBuckets(), []);
  const fbBuckets = useMemo(() => getAllFallbackBuckets(), []);

  const refresh = () => {
    refreshLearningCache();
    setTick(t => t + 1);
  };

  const totalBuckets = exactBuckets.length + fbBuckets.length;
  const losersCount = [...exactBuckets, ...fbBuckets].filter(b => b.adjustment < 0).length;
  const winnersCount = [...exactBuckets, ...fbBuckets].filter(b => b.adjustment > 0).length;

  return (
    <div className="rounded-xl border border-border bg-card/60 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Brain className="w-4 h-4 text-violet-400" />
          <h3 className="text-sm font-bold">إحصائيات التعليم الذاتي</h3>
          <span className="text-[10px] text-muted-foreground">V26</span>
        </div>
        <button
          onClick={refresh}
          className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <RefreshCw className="w-3 h-3" />
          تحديث
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-2 text-[11px]">
        <div className="rounded-lg bg-muted/30 px-2 py-1.5 text-center">
          <div className="flex items-center justify-center gap-1 text-muted-foreground">
            <Layers className="w-3 h-3" />
            buckets
          </div>
          <div className="font-mono font-bold text-foreground">{totalBuckets}</div>
        </div>
        <div className="rounded-lg bg-emerald-500/10 px-2 py-1.5 text-center">
          <div className="flex items-center justify-center gap-1 text-emerald-300">
            <TrendingUp className="w-3 h-3" />
            داعمة
          </div>
          <div className="font-mono font-bold text-emerald-400">{winnersCount}</div>
        </div>
        <div className="rounded-lg bg-rose-500/10 px-2 py-1.5 text-center">
          <div className="flex items-center justify-center gap-1 text-rose-300">
            <TrendingDown className="w-3 h-3" />
            معاقبة
          </div>
          <div className="font-mono font-bold text-rose-400">{losersCount}</div>
        </div>
      </div>

      {totalBuckets === 0 && (
        <div className="text-[11px] text-muted-foreground text-center py-4">
          لا توجد بيانات كافية بعد. النظام يحتاج 5 صفقات محلولة لكل (TF + اتجاه + نظام + نموذج)
          أو 6 صفقات للـ regime-fallback قبل أن يبدأ التأثير على الثقة.
        </div>
      )}

      {/* Exact buckets */}
      {exactBuckets.length > 0 && (
        <div className="space-y-2">
          <div className="text-[11px] font-semibold text-emerald-300">
            🎯 مطابقة دقيقة ({exactBuckets.length})
          </div>
          <div className="space-y-1.5 max-h-64 overflow-y-auto">
            {exactBuckets.map(b => (
              <Row key={b.key} bucket={b} source="exact" />
            ))}
          </div>
        </div>
      )}

      {/* Fallback buckets */}
      {fbBuckets.length > 0 && (
        <div className="space-y-2">
          <div className="text-[11px] font-semibold text-sky-300">
            🌐 احتياطي حسب نظام السوق ({fbBuckets.length})
          </div>
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {fbBuckets.map(b => (
              <Row key={b.key} bucket={b} source="regime-fallback" />
            ))}
          </div>
        </div>
      )}

      <div className="text-[10px] text-muted-foreground/80 leading-relaxed pt-1 border-t border-border">
        💡 يُطبَّق <span className="text-foreground">exact</span> أولاً (5+ عينات)، وإلا يسقط
        النظام إلى <span className="text-foreground">regime-fallback</span> (6+ عينات). الترجيح
        الزمني نصف-عمر 30 صفقة. عقوبة إضافية −5% عند 3 خسائر متتالية. يُلغى التعلم تلقائياً عند
        ثقة نظام السوق &lt; 40.
      </div>
    </div>
  );
});
LearningStatsPanel.displayName = "LearningStatsPanel";

export default LearningStatsPanel;
