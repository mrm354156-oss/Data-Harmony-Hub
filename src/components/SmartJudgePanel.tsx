// V30 — Smart Judge Panel
// Replaces the old manual Backtest panel. For each currently passing signal,
// auto-runs a 24-hour replay of the same engine and shows match results +
// execution timing — total transparency.

import { forwardRef, useEffect, useState } from "react";
import { Scale, Loader2, CheckCircle2, XCircle, AlertCircle, Clock, TrendingUp, Gavel } from "lucide-react";
import { judgeSignal, type JudgeVerdict } from "@/lib/smartJudge";
import { publishJudgeVerdict, JUDGE_MIN_WIN_RATE } from "@/lib/judgeAuthority";
import type { SniperSignal, SniperFearGreed } from "@/lib/sniperEngine";

interface Props {
  signals: SniperSignal[];
  fng: SniperFearGreed | null;
}

const SmartJudgePanel = forwardRef<HTMLDivElement, Props>(({ signals, fng }, _ref) => {
  const passing = signals.filter(s => s.passed).slice(0, 6); // top 6 to save bandwidth
  const [verdicts, setVerdicts] = useState<Record<string, JudgeVerdict | "loading">>({});

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      for (const s of passing) {
        const key = `${s.symbol}|${s.timeframe}|${s.direction}`;
        // Re-run if not yet computed (allow upgrade from preliminary → final)
        const existing = verdicts[key];
        const isFinalExisting = existing && existing !== "loading" && typeof existing === "object" && existing !== null && "__final" in existing
          ? (existing as JudgeVerdict & { __final?: boolean }).__final
          : false;
        if (isFinalExisting) continue;
        if (cancelled) return;
        setVerdicts(v => ({ ...v, [key]: "loading" }));
        const verdict = await judgeSignal(
          s.symbol, s.timeframe, fng, s.direction,
          (preliminary) => {
            if (cancelled) return;
            // Tag as preliminary so we know to upgrade later
            setVerdicts(v => ({ ...v, [key]: { ...preliminary } }));
            publishJudgeVerdict(s.symbol, s.timeframe, s.direction, preliminary);
          },
        );
        if (cancelled) return;
        // Mark final so we don't redo
        const finalTagged = { ...verdict, __final: true } as JudgeVerdict & { __final: true };
        setVerdicts(v => ({ ...v, [key]: finalTagged }));
        publishJudgeVerdict(s.symbol, s.timeframe, s.direction, verdict);
      }
    };
    run();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passing.map(s => `${s.symbol}|${s.timeframe}|${s.direction}`).join(",")]);

  return (
    <div className="rounded-xl border border-border bg-card/60 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Gavel className="w-4 h-4 text-cyan-400" />
        <h3 className="text-sm font-bold">⚖️ القاضي V35 — تقرير استشاري</h3>
        <span className="text-[10px] text-muted-foreground mr-auto">سريع 2k → عميق 10k</span>
      </div>
      <div className="text-[10px] text-cyan-300/90 bg-cyan-500/5 border border-cyan-500/20 rounded-md px-2 py-1.5 leading-relaxed">
        📊 القاضي يُقدّم تقرير Win Rate فقط (لا سلطة حجب). 🛡️ <b>درع المطبخ</b> يقرر بناءً على
        التقرير + ذاكرة التعلّم (R:R ≥ 1.2، WR &gt; 50% = إشارة قوية، رفض عند تاريخ خسائر موثّق).
      </div>

      {passing.length === 0 ? (
        <p className="text-[11px] text-muted-foreground py-3 text-center">
          لا توجد إشارات نشطة ليُحكم عليها — القاضي في وضع الانتظار.
        </p>
      ) : (
        <div className="space-y-2">
          {passing.map(s => {
            const key = `${s.symbol}|${s.timeframe}|${s.direction}`;
            const v = verdicts[key];
            return <JudgeRow key={key} signal={s} verdict={v} />;
          })}
        </div>
      )}

      <p className="text-[9px] text-muted-foreground/80 leading-relaxed border-t border-border pt-1.5">
        💡 يعيد المحرك تشغيل نفس منطقه على آخر 10,000 شمعة من الكاش لكل إشارة فور ظهورها — بدون تدخل يدوي.
      </p>
    </div>
  );
});
SmartJudgePanel.displayName = "SmartJudgePanel";

function JudgeRow({ signal, verdict }: { signal: SniperSignal; verdict: JudgeVerdict | "loading" | undefined }) {
  if (!verdict) {
    return (
      <div className="rounded-lg bg-muted/20 px-2.5 py-1.5 text-[11px] flex items-center gap-2">
        <span className="font-mono">{signal.baseAsset}</span>
        <span className="text-muted-foreground mr-auto">في الطابور…</span>
      </div>
    );
  }
  if (verdict === "loading") {
    return (
      <div className="rounded-lg bg-muted/20 px-2.5 py-1.5 text-[11px] flex items-center gap-2">
        <Loader2 className="w-3 h-3 animate-spin text-cyan-400" />
        <span className="font-mono">{signal.baseAsset}</span>
        <span className="text-muted-foreground mr-auto">يحكم على آخر 24 ساعة…</span>
      </div>
    );
  }
  const cfg = {
    strong: { icon: CheckCircle2, cls: "bg-emerald-500/10 border-emerald-500/40 text-emerald-300", label: "قوي ✅" },
    ok: { icon: TrendingUp, cls: "bg-amber-500/10 border-amber-500/40 text-amber-300", label: "مقبول 🟡" },
    weak: { icon: XCircle, cls: "bg-rose-500/10 border-rose-500/40 text-rose-300", label: "ضعيف 🔴" },
    insufficient: { icon: AlertCircle, cls: "bg-muted/30 border-border text-muted-foreground", label: "بيانات قليلة" },
  }[verdict.verdict];
  const Icon = cfg.icon;
  return (
    <div className={`rounded-lg border px-2.5 py-1.5 ${cfg.cls}`}>
      <div className="flex items-center gap-2 text-[11px]">
        <Icon className="w-3.5 h-3.5" />
        <span className="font-mono font-bold">{signal.baseAsset}</span>
        <span className="text-[10px] opacity-80">{signal.timeframe}</span>
        <span className="text-[10px] mr-auto opacity-90">{cfg.label}</span>
        <span className="flex items-center gap-0.5 text-[9px] opacity-70">
          <Clock className="w-2.5 h-2.5" /> {verdict.durationMs}ms
        </span>
      </div>
      {verdict.matches > 0 && (
        <div className="flex gap-3 mt-1 text-[10px] font-mono opacity-90">
          <span>مطابقات: <b>{verdict.matches}</b></span>
          <span className="text-emerald-300">فوز: {verdict.wins}</span>
          <span className="text-rose-300">خسارة: {verdict.losses}</span>
          <span>WR: <b>{(verdict.winRate * 100).toFixed(0)}%</b></span>
          <span>R: <b>{verdict.avgR >= 0 ? "+" : ""}{verdict.avgR.toFixed(2)}</b></span>
        </div>
      )}
    </div>
  );
}

export default SmartJudgePanel;
