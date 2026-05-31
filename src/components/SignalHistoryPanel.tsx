import { History, CheckCircle2, XCircle, Clock } from "lucide-react";
import type { TrackedSignal } from "@/hooks/useSignalHistory";
import { formatPrice } from "@/lib/formatPrice";

interface SignalHistoryPanelProps {
  history: TrackedSignal[];
  onClear?: () => void;
  filterCryptoId?: string;  // optional: show only this crypto's history
  compact?: boolean;
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "دلوقتي";
  if (m < 60) return `من ${m} دقيقة`;
  const h = Math.floor(m / 60);
  if (h < 24) return `من ${h} ساعة`;
  const d = Math.floor(h / 24);
  return `من ${d} يوم`;
}

function outcomeMeta(outcome: TrackedSignal["outcome"]) {
  switch (outcome) {
    case "target3": return { icon: <CheckCircle2 className="w-3.5 h-3.5" />, text: "✅ هدف 3 محقق", cls: "bg-stock-green/20 text-stock-green" };
    case "target2": return { icon: <CheckCircle2 className="w-3.5 h-3.5" />, text: "✅ هدف 2 محقق", cls: "bg-stock-green/15 text-stock-green" };
    case "target1": return { icon: <CheckCircle2 className="w-3.5 h-3.5" />, text: "✅ هدف 1 محقق", cls: "bg-stock-green/10 text-stock-green" };
    case "stopLoss": return { icon: <XCircle className="w-3.5 h-3.5" />, text: "🛑 وقف خسارة", cls: "bg-stock-red/15 text-stock-red" };
    default: return { icon: <Clock className="w-3.5 h-3.5" />, text: "⏳ شغال", cls: "bg-gold/15 text-gold" };
  }
}

const SignalHistoryPanel = ({ history, onClear, filterCryptoId, compact }: SignalHistoryPanelProps) => {
  const items = filterCryptoId
    ? history.filter(s => s.cryptoId === filterCryptoId)
    : history;

  return (
    <div className="rounded-xl border border-border bg-secondary/30 p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-bold text-foreground flex items-center gap-1.5">
          <History className="w-3.5 h-3.5 text-gold" />
          آخر التوصيات المحققة
        </p>
        {onClear && history.length > 0 && !filterCryptoId && (
          <button
            onClick={onClear}
            className="text-[10px] text-muted-foreground hover:text-stock-red transition-colors"
          >
            مسح السجل
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <p className="text-[11px] text-muted-foreground text-center py-4">
          مفيش توصيات متسجلة لسه - السجل بيتحدث تلقائياً لما تظهر فرصة قوية
        </p>
      ) : (
        <div className={`space-y-2 ${compact ? "max-h-64" : "max-h-80"} overflow-y-auto`}>
          {items.slice(0, compact ? 5 : 15).map(s => {
            const meta = outcomeMeta(s.outcome);
            return (
              <div key={s.id} className="flex items-center gap-2 bg-background/40 rounded-lg p-2 text-xs">
                <img src={s.image} alt={s.symbol} className="w-6 h-6 rounded-full flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-bold text-foreground">{s.name}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {s.symbol.toUpperCase()}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
                    <span>{timeAgo(s.createdAt)}</span>
                    <span>•</span>
                    <span>دخول {formatPrice(s.entry)}</span>
                  </div>
                </div>
                <span className={`flex items-center gap-1 px-2 py-1 rounded-full font-bold text-[10px] ${meta.cls}`}>
                  {meta.icon}
                  {meta.text}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default SignalHistoryPanel;
