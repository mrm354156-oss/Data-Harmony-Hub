import { forwardRef, useEffect, useState } from "react";
import { Trophy, X as XIcon, Clock, ChevronDown, ChevronUp, Trash2, AlertTriangle, Radio, Shield, TrendingDown, TrendingUp } from "lucide-react";
import type { LoggedSniperSignal, SniperOutcome } from "@/hooks/useSniperLog";
import { formatPrice } from "@/lib/formatPrice";
import { useBinanceLivePrice } from "@/hooks/useBinanceLivePrices";

interface Props {
  log: LoggedSniperSignal[];
  wins: number;
  losses: number;
  winRate: number;
  resolvedCount: number;
  onClear: () => void;
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "دلوقتي";
  if (m < 60) return `من ${m} دقيقة`;
  const h = Math.floor(m / 60);
  if (h < 24) return `من ${h} ساعة`;
  return `من ${Math.floor(h / 24)} يوم`;
}

function outcomeBadge(o: SniperOutcome): { text: string; cls: string; icon: JSX.Element } {
  switch (o) {
    case "target2": return { text: "✅ ضربت T2", cls: "bg-stock-green/20 text-stock-green border-stock-green/40", icon: <Trophy className="w-3 h-3" /> };
    case "target1": return { text: "✅ ضربت T1", cls: "bg-stock-green/15 text-stock-green border-stock-green/30", icon: <Trophy className="w-3 h-3" /> };
    case "stopLoss": return { text: "❌ فشلت — وقف خسارة", cls: "bg-stock-red/15 text-stock-red border-stock-red/40", icon: <XIcon className="w-3 h-3" /> };
    case "emergencyExit": return { text: "🚨 خروج اضطراري", cls: "bg-stock-red/20 text-stock-red border-stock-red/50", icon: <AlertTriangle className="w-3 h-3" /> };
    case "expired": return { text: "⏰ انتهت المدة", cls: "bg-muted text-muted-foreground border-border", icon: <Clock className="w-3 h-3" /> };
    default: return { text: "🔄 متابعة", cls: "bg-gold/15 text-gold border-gold/40", icon: <Clock className="w-3 h-3" /> };
  }
}

const SniperLogPanel = forwardRef<HTMLDivElement, Props>(({ log, wins, losses, winRate, resolvedCount, onClear }, ref) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (log.length === 0) {
    return (
      <div ref={ref} className="rounded-xl border border-border bg-secondary/30 p-4 text-center">
        <p className="text-xs text-muted-foreground">📜 سجل التوصيات فاضي — استنى أول إشارة قناص.</p>
      </div>
    );
  }

  return (
    <div ref={ref} className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="font-cairo font-bold text-sm text-foreground flex items-center gap-1.5">
          <Trophy className="w-4 h-4 text-gold" /> سجل توصيات القناص
        </h3>
        <button onClick={onClear} className="p-1 rounded hover:bg-secondary text-muted-foreground" title="مسح السجل">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Win-rate summary */}
      <div className="grid grid-cols-4 gap-1.5 text-center">
        <div className="p-2 rounded-md bg-secondary border border-border">
          <p className="text-[9px] text-muted-foreground">إجمالي</p>
          <p className="text-sm font-bold text-foreground">{log.length}</p>
        </div>
        <div className="p-2 rounded-md bg-stock-green/10 border border-stock-green/30">
          <p className="text-[9px] text-muted-foreground">✅ ربح</p>
          <p className="text-sm font-bold text-stock-green">{wins}</p>
        </div>
        <div className="p-2 rounded-md bg-stock-red/10 border border-stock-red/30">
          <p className="text-[9px] text-muted-foreground">❌ خسارة</p>
          <p className="text-sm font-bold text-stock-red">{losses}</p>
        </div>
        <div className="p-2 rounded-md bg-gold/10 border border-gold/30">
          <p className="text-[9px] text-muted-foreground">Win Rate</p>
          <p className="text-sm font-bold text-gold">{resolvedCount > 0 ? `${winRate}%` : "—"}</p>
        </div>
      </div>

      {/* Log entries */}
      <div className="space-y-1.5">
        {log.slice(0, 10).map(l => (
          <LogEntry
            key={l.id}
            entry={l}
            isOpen={expandedId === l.id}
            onToggle={() => setExpandedId(expandedId === l.id ? null : l.id)}
          />
        ))}
      </div>

    </div>
  );
});
SniperLogPanel.displayName = "SniperLogPanel";

const LogEntry = ({ entry: l, isOpen, onToggle }: { entry: LoggedSniperSignal; isOpen: boolean; onToggle: () => void }) => {
  const livePrice = useBinanceLivePrice(l.symbol);
  const b = outcomeBadge(l.outcome);

  // Live PnL (direction-aware) — only meaningful while pending
  const refPrice = l.outcome === "pending" ? livePrice : l.resolvedPrice ?? livePrice;
  const pnlPct = refPrice != null
    ? l.direction === "short"
      ? ((l.entry - refPrice) / l.entry) * 100
      : ((refPrice - l.entry) / l.entry) * 100
    : null;
  const pnlColor = pnlPct == null ? "text-muted-foreground" : pnlPct >= 0 ? "text-stock-green" : "text-stock-red";

  const dirIcon = l.direction === "short"
    ? <TrendingDown className="w-2.5 h-2.5" />
    : <TrendingUp className="w-2.5 h-2.5" />;
  const dirCls = l.direction === "short"
    ? "bg-stock-red/15 text-stock-red border-stock-red/40"
    : "bg-stock-green/15 text-stock-green border-stock-green/40";

  return (
    <div className="rounded-lg border border-border bg-secondary/40 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 p-2.5 text-right hover:bg-secondary/60 transition-colors"
      >
        <span className="text-[10px] font-bold text-foreground">{l.baseAsset}/USDT</span>
        {l.grade && l.grade !== "rejected" && (
          <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${l.grade === "A+" ? "bg-stock-green text-background" :
              l.grade === "A" ? "bg-gold text-background" :
                "bg-foreground text-background"
            }`}>{l.grade}</span>
        )}
        <span className={`text-[9px] px-1.5 py-0.5 rounded border font-bold flex items-center gap-1 ${dirCls}`}>
          {dirIcon}{l.direction === "short" ? "هبوط" : "صعود"}
        </span>
        <span className="text-[9px] px-1.5 py-0.5 rounded bg-gold/15 text-gold font-bold">{l.timeframe}</span>
        <span className={`text-[9px] px-1.5 py-0.5 rounded border font-bold flex items-center gap-1 ${b.cls}`}>
          {b.icon} {b.text}
        </span>
        {l.partialClosedAt && l.outcome === "pending" && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-stock-green/15 text-stock-green border border-stock-green/40 font-bold">
            50% مؤمَّن
          </span>
        )}
        {l.outcome === "pending" && pnlPct != null && (
          <span className={`text-[9px] font-bold ${pnlColor} flex items-center gap-0.5`}>
            <Radio className="w-2 h-2 animate-pulse" /> {pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%
          </span>
        )}
        <span className="mr-auto text-[9px] text-muted-foreground">{timeAgo(l.createdAt)}</span>
        {isOpen ? <ChevronUp className="w-3 h-3 text-muted-foreground" /> : <ChevronDown className="w-3 h-3 text-muted-foreground" />}
      </button>
      {/* V35 — wisdom source pill, always visible (compact) */}
      {l.wisdomSource && !isOpen && (
        <div className="px-2.5 pb-1.5 -mt-1">
          <span className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-300 border border-cyan-500/30">
            <Shield className="w-2.5 h-2.5" /> {l.wisdomSource}
          </span>
        </div>
      )}

      {isOpen && (
        <div className="px-2.5 pb-2.5 space-y-2 border-t border-border/50">
          {/* V35 — Kitchen Shield wisdom badge */}
          {l.wisdomSource && (
            <div className="flex items-start gap-1.5 text-[10px] p-1.5 rounded bg-cyan-500/5 border border-cyan-500/30 mt-2">
              <Shield className="w-3 h-3 text-cyan-400 mt-0.5 shrink-0" />
              <div className="flex flex-col gap-0.5">
                <span className="font-bold text-cyan-300">{l.wisdomSource}</span>
                {l.shieldReason && (
                  <span className="text-foreground/70">{l.shieldReason}</span>
                )}
              </div>
            </div>
          )}
          {/* Trade plan */}
          <div className="grid grid-cols-4 gap-1 text-[10px]">
            <div className="p-1.5 rounded bg-background/50 text-center">
              <p className="text-muted-foreground">دخول</p>
              <p className="font-bold text-foreground">{formatPrice(l.entry)}</p>
            </div>
            <div className="p-1.5 rounded bg-stock-green/10 text-center">
              <p className="text-muted-foreground">T1</p>
              <p className="font-bold text-stock-green">{formatPrice(l.target1)}</p>
            </div>
            <div className="p-1.5 rounded bg-stock-green/15 text-center">
              <p className="text-muted-foreground">T2</p>
              <p className="font-bold text-stock-green">{formatPrice(l.target2)}</p>
            </div>
            <div className="p-1.5 rounded bg-stock-red/10 text-center">
              <p className="text-muted-foreground">SL{l.trailingActive ? " ⚙" : ""}</p>
              <p className="font-bold text-stock-red">{formatPrice(l.stopLoss)}</p>
            </div>
          </div>

          {/* Live price + trailing status */}
          {l.outcome === "pending" && (
            <div className="flex items-center justify-between text-[10px] p-1.5 rounded bg-background/50 border border-border/40">
              <span className="text-muted-foreground flex items-center gap-1">
                <Radio className={`w-2.5 h-2.5 ${livePrice != null ? "text-stock-green animate-pulse" : "text-muted-foreground"}`} />
                السعر المباشر
              </span>
              <span className="font-bold text-foreground">{livePrice != null ? formatPrice(livePrice) : "—"}</span>
              {l.trailingActive && (
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-gold/15 text-gold border border-gold/40 font-bold flex items-center gap-1">
                  <Shield className="w-2.5 h-2.5" /> SL @ Break-Even
                </span>
              )}
            </div>
          )}

          {/* Reason lines */}
          <div>
            <p className="text-[10px] font-bold text-gold mb-1">لماذا أصدرت هذه التوصية؟</p>
            <ul className="space-y-1">
              {l.reasonLines.map((r, i) => (
                <li key={i} className="text-[10px] text-foreground/80 leading-relaxed">{r}</li>
              ))}
            </ul>
          </div>

          {/* Resolution */}
          {l.resolvedAt && (
            <p className="text-[10px] text-muted-foreground border-t border-border/40 pt-1.5">
              تم الحسم {timeAgo(l.resolvedAt)}
              {l.resolvedPrice !== undefined && ` عند سعر ${formatPrice(l.resolvedPrice)}`}
              {l.outcome === "stopLoss" && " — السبب: السعر كسر وقف الخسارة قبل الوصول للهدف."}
              {l.outcome === "emergencyExit" && " — السبب: خروج استباقي بسبب انقلاب تدفق الحيتان مع خسارة 1.5%."}
              {l.outcome === "expired" && " — السبب: انتهت مدة صلاحية التوصية بدون تحقق هدف أو وقف."}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default SniperLogPanel;

