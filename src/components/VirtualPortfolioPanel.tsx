import { forwardRef } from "react";
import { Wallet, TrendingUp, TrendingDown, RotateCcw, X, Activity, Lock } from "lucide-react";
import type { VirtualTrade } from "@/hooks/useVirtualPortfolio";
import type { LoggedSniperSignal } from "@/hooks/useSniperLog";
import { getLivePriceSnapshot } from "@/hooks/useBinanceLivePrices";
import { formatPrice } from "@/lib/formatPrice";

interface Props {
  balance: number;
  equity: number;
  floatingPnl: number;
  initialBalance: number;
  totalPnl: number;
  totalPnlPct: number;
  trades: VirtualTrade[];
  openLog?: LoggedSniperSignal[];   // pending sniper signals for live P&L row
  wins: number;
  losses: number;
  onReset: () => void;
  onRemoveTrade?: (id: string) => void;
}

function timeAgo(ts: number): string {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return "دلوقتي";
  if (m < 60) return `${m}د`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}س`;
  return `${Math.floor(h / 24)}ي`;
}

const VirtualPortfolioPanel = forwardRef<HTMLDivElement, Props>(({
  balance, equity, floatingPnl, initialBalance, totalPnl, totalPnlPct, trades, openLog, wins, losses, onReset, onRemoveTrade
}, ref) => {
  const isUp = totalPnl >= 0;
  const isFloatUp = floatingPnl >= 0;
  const openPending = (openLog ?? []).filter(l => l.outcome === "pending");

  return (
    <div ref={ref} className="rounded-xl border border-gold/40 bg-gradient-to-br from-gold/10 via-secondary/30 to-background p-3 space-y-3">
      <div className="flex items-center gap-2">
        <Wallet className="w-4 h-4 text-gold" />
        <h3 className="font-cairo font-bold text-sm text-foreground">المحفظة الوهمية</h3>
        <span className="text-[9px] px-1.5 py-0.5 rounded bg-gold/20 text-gold font-bold">$10K</span>
        <button
          onClick={() => {
            if (confirm("إعادة تعيين المحفظة لـ $10,000؟ هيتم مسح كل الصفقات.")) onReset();
          }}
          className="mr-auto p-1 rounded hover:bg-secondary text-muted-foreground"
          title="إعادة تعيين"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Balance row */}
      <div className="grid grid-cols-4 gap-2 text-center">
        <div className="p-2 rounded-md bg-background/60 border border-border">
          <p className="text-[9px] text-muted-foreground">الرصيد الحالي</p>
          <p className={`text-base font-bold ${isUp ? "text-stock-green" : "text-stock-red"}`}>
            ${balance.toFixed(2)}
          </p>
        </div>
        <div className={`p-2 rounded-md border ${isFloatUp ? "bg-stock-green/10 border-stock-green/40" : "bg-stock-red/10 border-stock-red/40"}`}>
          <p className="text-[9px] text-muted-foreground flex items-center justify-center gap-0.5">
            <Activity className="w-2.5 h-2.5" />
            P&amp;L عائم
          </p>
          <p className={`text-sm font-bold ${isFloatUp ? "text-stock-green" : "text-stock-red"}`}>
            {isFloatUp ? "+" : ""}${floatingPnl.toFixed(2)}
          </p>
          <p className="text-[9px] text-muted-foreground">حقوق ${equity.toFixed(2)}</p>
        </div>
        <div className={`p-2 rounded-md border ${isUp ? "bg-stock-green/10 border-stock-green/40" : "bg-stock-red/10 border-stock-red/40"}`}>
          <p className="text-[9px] text-muted-foreground flex items-center justify-center gap-0.5">
            {isUp ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
            محقق
          </p>
          <p className={`text-sm font-bold ${isUp ? "text-stock-green" : "text-stock-red"}`}>
            {isUp ? "+" : ""}${totalPnl.toFixed(2)}
          </p>
          <p className={`text-[9px] font-bold ${isUp ? "text-stock-green" : "text-stock-red"}`}>
            ({isUp ? "+" : ""}{totalPnlPct.toFixed(2)}%)
          </p>
        </div>
        <div className="p-2 rounded-md bg-background/60 border border-border">
          <p className="text-[9px] text-muted-foreground">صفقات</p>
          <p className="text-sm font-bold text-foreground">{trades.length}</p>
          <p className="text-[9px]">
            <span className="text-stock-green font-bold">{wins}✓</span>
            <span className="text-muted-foreground"> / </span>
            <span className="text-stock-red font-bold">{losses}✗</span>
          </p>
        </div>
      </div>

      {/* Open positions — live floating P&L per trade */}
      {openPending.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] text-muted-foreground font-bold flex items-center gap-1">
            <Activity className="w-2.5 h-2.5" /> صفقات مفتوحة ({openPending.length})
          </p>
          <div className="space-y-1 max-h-44 overflow-y-auto">
            {openPending.slice(0, 8).map(l => {
              const live = getLivePriceSnapshot(l.symbol) ?? l.entry;
              const livePct = l.direction === "short"
                ? ((l.entry - live) / l.entry) * 100
                : ((live - l.entry) / l.entry) * 100;
              const up = livePct >= 0;
              return (
                <div
                  key={l.id}
                  className={`flex items-center gap-2 p-1.5 rounded border text-[10px] ${
                    up ? "bg-stock-green/5 border-stock-green/30" : "bg-stock-red/5 border-stock-red/30"
                  }`}
                >
                  <span className="font-bold text-foreground">{l.baseAsset}</span>
                  <span className={`text-[9px] px-1 py-0.5 rounded font-bold ${
                    l.direction === "short" ? "bg-stock-red/20 text-stock-red" : "bg-stock-green/20 text-stock-green"
                  }`}>
                    {l.direction === "short" ? "S" : "L"}
                  </span>
                  {l.beLocked && (
                    <span title="نقطة الدخول مؤمنة" className="text-[9px] flex items-center gap-0.5 px-1 rounded bg-amber-500/20 text-amber-300">
                      <Lock className="w-2.5 h-2.5" /> BE
                    </span>
                  )}
                  {l.partialClosedAt && (
                    <span title="جني 50% عند الهدف الأول" className="text-[9px] px-1 rounded bg-stock-green/20 text-stock-green font-bold">
                      T1✓
                    </span>
                  )}
                  {l.midLocked && (
                    <span title="ستوب لمنتصف T1↔T2" className="text-[9px] px-1 rounded bg-violet-500/20 text-violet-300 font-bold">
                      MID
                    </span>
                  )}
                  <span className="text-muted-foreground text-[9px]">{formatPrice(l.entry)}→{formatPrice(live)}</span>
                  <span className={`mr-auto font-bold ${up ? "text-stock-green" : "text-stock-red"}`}>
                    {up ? "+" : ""}{livePct.toFixed(2)}%
                  </span>
                  {onRemoveTrade && (
                    <button
                      onClick={() => {
                        if (confirm(`إغلاق ${l.baseAsset} كخسارة فوراً؟ سيتم تحديث السجلات وإدارة المخاطر.`)) {
                          onRemoveTrade(l.id);
                        }
                      }}
                      className="p-0.5 rounded hover:bg-stock-red/20 text-stock-red"
                      title="إغلاق كخسارة"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Trades */}
      {trades.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] text-muted-foreground font-bold">آخر الصفقات المغلقة:</p>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {trades.slice(0, 8).map(t => (
              <div
                key={t.id}
                className={`flex items-center gap-2 p-1.5 rounded border text-[10px] ${
                  t.pnl >= 0 ? "bg-stock-green/5 border-stock-green/30" : "bg-stock-red/5 border-stock-red/30"
                }`}
              >
                <span className="font-bold text-foreground">{t.baseAsset}</span>
                <span className={`text-[9px] px-1 py-0.5 rounded font-bold ${
                  t.direction === "short" ? "bg-stock-red/20 text-stock-red" : "bg-stock-green/20 text-stock-green"
                }`}>
                  {t.direction === "short" ? "S" : "L"}
                </span>
                <span className="text-muted-foreground">${t.size.toFixed(0)}</span>
                <span className="text-muted-foreground text-[9px]">{formatPrice(t.entry)}→{formatPrice(t.exit)}</span>
                <span className={`mr-auto font-bold ${t.pnl >= 0 ? "text-stock-green" : "text-stock-red"}`}>
                  {t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(2)} ({t.pnlPct >= 0 ? "+" : ""}{t.pnlPct.toFixed(2)}%)
                </span>
                <span className="text-[9px] text-muted-foreground">{timeAgo(t.closedAt)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-[9px] text-muted-foreground text-center">
        💡 كل توصية تدخل بـ 10% من الرصيد · جني 50% عند T1 (فوري) · رفع SL تلقائي عند 75% للهدف ومنتصف T1↔T2
      </p>
    </div>
  );
});
VirtualPortfolioPanel.displayName = "VirtualPortfolioPanel";

export default VirtualPortfolioPanel;
