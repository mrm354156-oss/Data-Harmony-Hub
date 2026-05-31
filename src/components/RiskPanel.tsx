// V27 — Risk Manager Panel
// يعرض إعدادات المخاطرة، حجم الصفقة المحسوب، حالة Circuit Breakers،
// والإحصائيات اليومية — تمهيداً لربط البوت بمحفظة حقيقية.

import { forwardRef, useEffect, useMemo, useState } from "react";
import { Shield, TrendingUp, TrendingDown, AlertTriangle, Settings2, Cloud, CloudOff, Zap, Layers } from "lucide-react";
import type { LoggedSniperSignal } from "@/hooks/useSniperLog";
import {
  loadRiskSettings,
  saveRiskSettings,
  calculatePositionSize,
  calculateLeverage,
  type RiskSettings,
} from "@/lib/riskManager";

interface Props {
  log: LoggedSniperSignal[];
  isCloudAuthed: boolean;
}

const RiskPanel = forwardRef<HTMLDivElement, Props>(({ log, isCloudAuthed }, _ref) => {
  const [settings, setSettings] = useState<RiskSettings>(() => loadRiskSettings());
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const onChange = () => setSettings(loadRiskSettings());
    window.addEventListener("risk-settings-changed", onChange);
    return () => window.removeEventListener("risk-settings-changed", onChange);
  }, []);

  // Build today's snapshot from the log
  const stats = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const cutoff = today.getTime();
    const todays = log.filter(l => l.createdAt >= cutoff);
    const wins = todays.filter(l => l.outcome === "target1" || l.outcome === "target2").length;
    const losses = todays.filter(l => l.outcome === "stopLoss" || l.outcome === "emergencyExit").length;
    const openCount = log.filter(l => l.outcome === "pending").length;
    const pnlPct = (wins * settings.maxRiskPerTrade * 1.5) - (losses * settings.maxRiskPerTrade);
    return { tradesCount: wins + losses, wins, losses, pnlPct, openCount };
  }, [log, settings]);

  // Circuit breaker logic (simple version)
  const circuitBreaker = useMemo(() => {
    const consecutiveLosses = log.reduceRight((acc, l) => {
      if (l.outcome === "stopLoss" || l.outcome === "emergencyExit") return acc + 1;
      return acc;
    }, 0);
    const tripped = settings.useDynamicSizing && consecutiveLosses >= 3;
    const canTrade = !tripped && stats.openCount < settings.maxConcurrentTrades;
    const reason = tripped ? `خسائر متتالية ${consecutiveLosses}` : !canTrade ? `صفقات مفتوحة ${stats.openCount}/${settings.maxConcurrentTrades}` : null;
    return { tripped, canTrade, reason };
  }, [log, settings, stats]);

  // Latest pending trade → show computed position size
  const latest = log.find(l => l.outcome === "pending");
  const sizing = latest
    ? (() => {
      const posSize = calculatePositionSize(10000, latest.entry, latest.stopLoss, settings.maxRiskPerTrade);
      const slDist = Math.abs(latest.entry - latest.stopLoss);
      const slDistPct = (slDist / latest.entry) * 100;
      const riskUsdt = 10000 * (settings.maxRiskPerTrade / 100);
      return { positionUsdt: posSize * latest.entry, riskUsdt, stopDistancePct: slDistPct };
    })()
    : null;
  const leverageInfo = latest
    ? (() => {
      const lev = calculateLeverage(latest.entry, latest.stopLoss, settings.maxRiskPerTrade);
      const marginUsdt = sizing ? sizing.positionUsdt / lev : 0;
      const slDistPct = sizing ? sizing.stopDistancePct : 0;
      return { leverage: lev, marginUsdt, effectiveRiskPct: slDistPct * lev };
    })()
    : null;

  const update = <K extends keyof RiskSettings>(key: K, value: RiskSettings[K]) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    saveRiskSettings(next);
  };

  return (
    <div className="rounded-xl border border-border bg-card/60 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-amber-400" />
          <h3 className="text-sm font-bold">إدارة المخاطر</h3>
          <span className="text-[10px] text-muted-foreground">V27</span>
        </div>
        <div className="flex items-center gap-2">
          {isCloudAuthed ? (
            <span className="flex items-center gap-1 text-[10px] text-emerald-400">
              <Cloud className="w-3 h-3" /> متزامن
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <CloudOff className="w-3 h-3" /> محلي
            </span>
          )}
          <button
            onClick={() => setExpanded(v => !v)}
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <Settings2 className="w-3 h-3" /> إعدادات
          </button>
        </div>
      </div>

      {/* Circuit Breaker Status */}
      <div
        className={`rounded-lg border px-3 py-2 text-xs flex items-start gap-2 ${circuitBreaker.tripped
          ? "border-rose-500/50 bg-rose-500/10 text-rose-300"
          : circuitBreaker.canTrade
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
            : "border-amber-500/40 bg-amber-500/10 text-amber-300"
          }`}
      >
        {circuitBreaker.tripped ? (
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
        ) : circuitBreaker.canTrade ? (
          <Shield className="w-4 h-4 flex-shrink-0 mt-0.5" />
        ) : (
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
        )}
        <div className="flex-1">
          <div className="font-bold">
            {circuitBreaker.tripped
              ? "الحماية مُفعّلة — البوت متوقف"
              : circuitBreaker.canTrade
                ? "جاهز للتداول"
                : "مؤقتاً متوقف"}
          </div>
          <div className="text-[11px] opacity-90 mt-0.5">
            {circuitBreaker.reason ?? "كل الحدود ضمن الأمان"}
          </div>
        </div>
      </div>

      {/* Daily Stats */}
      <div className="grid grid-cols-4 gap-2 text-[11px]">
        <div className="rounded-lg bg-muted/30 px-2 py-1.5 text-center">
          <div className="text-muted-foreground">صفقات اليوم</div>
          <div className="font-mono font-bold">{stats.tradesCount}</div>
        </div>
        <div className="rounded-lg bg-emerald-500/10 px-2 py-1.5 text-center">
          <div className="text-emerald-300 flex items-center justify-center gap-1">
            <TrendingUp className="w-3 h-3" /> فوز
          </div>
          <div className="font-mono font-bold text-emerald-400">{stats.wins}</div>
        </div>
        <div className="rounded-lg bg-rose-500/10 px-2 py-1.5 text-center">
          <div className="text-rose-300 flex items-center justify-center gap-1">
            <TrendingDown className="w-3 h-3" /> خسارة
          </div>
          <div className="font-mono font-bold text-rose-400">{stats.losses}</div>
        </div>
        <div className="rounded-lg bg-sky-500/10 px-2 py-1.5 text-center">
          <div className="text-sky-300">مفتوحة</div>
          <div className="font-mono font-bold text-sky-400">{stats.openCount}</div>
        </div>
      </div>

      {/* Position Sizing Preview */}
      {latest && sizing && (
        <div className="rounded-lg border border-border bg-card/40 px-3 py-2 text-[11px] space-y-1">
          <div className="text-[10px] text-muted-foreground">
            آخر إشارة: <span className="text-foreground">{latest.baseAsset}</span> · {latest.timeframe} · {latest.direction === "long" ? "🟢" : "🔴"}
          </div>
          <div className="grid grid-cols-3 gap-2 pt-1">
            <div>
              <div className="text-muted-foreground">حجم الصفقة</div>
              <div className="font-mono font-bold text-foreground">${sizing.positionUsdt.toFixed(2)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">المخاطرة</div>
              <div className="font-mono font-bold text-amber-400">${sizing.riskUsdt.toFixed(2)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">مسافة SL</div>
              <div className="font-mono font-bold">{sizing.stopDistancePct.toFixed(2)}%</div>
            </div>
          </div>
          {/* V37 — Leverage block */}
          {leverageInfo && leverageInfo.leverage > 0 && (
            <div className="grid grid-cols-3 gap-2 pt-2 mt-1 border-t border-border/40">
              <div>
                <div className="text-muted-foreground flex items-center gap-1">
                  <Zap className="w-2.5 h-2.5 text-amber-400" /> الرافعة
                </div>
                <div className="font-mono font-bold text-amber-300">{leverageInfo.leverage}x</div>
              </div>
              <div>
                <div className="text-muted-foreground flex items-center gap-1">
                  <Layers className="w-2.5 h-2.5" /> النوع
                </div>
                <button
                  onClick={() => update("useDynamicSizing", !settings.useDynamicSizing)}
                  className={`font-mono font-bold text-[10px] px-1.5 py-0.5 rounded border ${settings.useDynamicSizing
                    ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40"
                    : "bg-violet-500/15 text-violet-300 border-violet-500/40"
                    }`}
                  title="انقر للتبديل بين الديناميكي والثابت"
                >
                  {settings.useDynamicSizing ? "Dynamic 📊" : "Fixed 🔒"}
                </button>
              </div>
              <div>
                <div className="text-muted-foreground">الهامش الفعلي</div>
                <div className="font-mono font-bold text-foreground">${leverageInfo.marginUsdt.toFixed(2)}</div>
              </div>
              <div className="col-span-3 text-[9px] text-muted-foreground/80 leading-relaxed">
                💡 الرافعة محسوبة ديناميكياً بحيث لا تتجاوز المخاطرة <b className="text-amber-300">{settings.maxRiskPerTrade}%</b> من الرصيد عند ضرب SL
                (الخسارة المتوقعة عند SL: <b className="text-rose-300">{leverageInfo.effectiveRiskPct.toFixed(2)}%</b>).
                {leverageInfo.leverage >= 10 && (
                  <span className="text-amber-400"> · مقيّدة بسقف 10x</span>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Expandable Settings */}
      {expanded && (
        <div className="space-y-2 border-t border-border pt-3">
          <Field
            label="المخاطرة لكل صفقة (%)"
            value={settings.maxRiskPerTrade}
            onChange={v => update("maxRiskPerTrade", v)}
            step={0.25}
            max={5}
          />
          <Field
            label="الحد الأقصى للصفقات المتزامنة"
            value={settings.maxConcurrentTrades}
            onChange={v => update("maxConcurrentTrades", Math.round(v))}
            step={1}
            max={10}
          />
          <Field
            label="الحد الأقصى للخسارة اليومية (%)"
            value={settings.maxDailyLoss}
            onChange={v => update("maxDailyLoss", v)}
            step={0.5}
            max={20}
          />
          <div className="flex items-center justify-between text-[11px] pt-1">
            <span>التحديد الديناميكي</span>
            <button
              onClick={() => update("useDynamicSizing", !settings.useDynamicSizing)}
              className={`px-2 py-0.5 rounded text-[10px] font-mono ${settings.useDynamicSizing
                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                : "bg-muted text-muted-foreground border border-border"
                }`}
            >
              {settings.useDynamicSizing ? "مُفعّل" : "مُعطّل"}
            </button>
          </div>
        </div>
      )}

      {!isCloudAuthed && (
        <div className="text-[10px] text-muted-foreground/80 border-t border-border pt-2">
          💡 سجّل الدخول لحفظ الصفقات دائماً في السحابة + تفعيل التزامن التلقائي.
        </div>
      )}
    </div>
  );
});
RiskPanel.displayName = "RiskPanel";

interface FieldProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
}

function Field({ label, value, onChange, step = 1, min = 0, max = 1_000_000 }: FieldProps) {
  return (
    <div className="flex items-center justify-between gap-2 text-[11px]">
      <label className="text-muted-foreground flex-1">{label}</label>
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
        className="w-24 bg-muted/40 border border-border rounded px-2 py-1 font-mono text-right text-foreground focus:outline-none focus:border-primary"
      />
    </div>
  );
}

export default RiskPanel;
