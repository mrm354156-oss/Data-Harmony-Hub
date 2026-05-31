import { useEffect, useState } from "react";
import { Ghost, ChevronDown, ChevronUp, XIcon } from "lucide-react";
import { getShadowEntries, subscribeShadowChanges } from "@/lib/shadowLearning";
import { useBinanceLivePrice } from "@/hooks/useBinanceLivePrices";
import { formatPrice } from "@/lib/formatPrice";

function timeAgo(ts: number): string {
    const diff = Date.now() - ts;
    const m = Math.floor(diff / 60000);
    if (m < 1) return "دلوقتي";
    if (m < 60) return `من ${m} دقيقة`;
    const h = Math.floor(m / 60);
    if (h < 24) return `من ${h} ساعة`;
    return `من ${Math.floor(h / 24)} يوم`;
}

function shadowOutcomeBadge(o?: string): { text: string; cls: string } {
    switch (o) {
        case "target2": return { text: "✅ T2", cls: "bg-stock-green/20 text-stock-green border-stock-green/40" };
        case "target1": return { text: "✅ T1", cls: "bg-stock-green/15 text-stock-green border-stock-green/30" };
        case "stopLoss": return { text: "❌ SL", cls: "bg-stock-red/15 text-stock-red border-stock-red/40" };
        case "expired": return { text: "⏰ منتهية", cls: "bg-muted text-muted-foreground border-border" };
        default: return { text: "👻 متابعة", cls: "bg-foreground/10 text-foreground border-border" };
    }
}

const ShadowLogPanel = () => {
    const [showShadows, setShowShadows] = useState(false);
    const [shadowTick, setShadowTick] = useState(0);
    useEffect(() => subscribeShadowChanges(() => setShadowTick(t => t + 1)), []);
    const shadows = getShadowEntries();
    void shadowTick;

    return (
        <div className="rounded-lg border border-dashed border-border/60 bg-secondary/20 overflow-hidden">
            <button
                onClick={() => setShowShadows(s => !s)}
                className="w-full flex items-center gap-2 p-2 text-right hover:bg-secondary/40 transition-colors"
            >
                <Ghost className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-[11px] font-bold text-foreground">سجل الظلّ — رفض القاضي</span>
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-bold">
                    {shadows.length}
                </span>
                <span className="mr-auto text-[9px] text-muted-foreground">
                    بيانات تعلّم خفية
                </span>
                {showShadows ? <ChevronUp className="w-3 h-3 text-muted-foreground" /> : <ChevronDown className="w-3 h-3 text-muted-foreground" />}
            </button>
            {showShadows && (
                <div className="px-2 pb-2 space-y-1.5 border-t border-border/40">
                    {shadows.length === 0 && (
                        <p className="text-[10px] text-muted-foreground text-center py-2">
                            لا توجد إشارات مرفوضة بعد.
                        </p>
                    )}
                    {shadows.slice(0, 15).map(s => <ShadowEntry key={s.id} entry={s} />)}
                </div>
            )}
        </div>
    );
};

const ShadowEntry = ({ entry: s }: { entry: ReturnType<typeof getShadowEntries>[number] }) => {
    const live = useBinanceLivePrice(s.symbol);
    const refPrice = s.outcome && s.outcome !== "pending" ? s.resolvedPrice ?? live : live;
    const pnl = refPrice != null
        ? s.direction === "short"
            ? ((s.entry - refPrice) / s.entry) * 100
            : ((refPrice - s.entry) / s.entry) * 100
        : null;
    const pnlCls = pnl == null ? "text-muted-foreground" : pnl >= 0 ? "text-stock-green" : "text-stock-red";
    const b = shadowOutcomeBadge(s.outcome);
    const dirCls = s.direction === "short"
        ? "bg-stock-red/10 text-stock-red border-stock-red/30"
        : "bg-stock-green/10 text-stock-green border-stock-green/30";

    return (
        <div className="rounded-md border border-border/40 bg-background/40 p-2 space-y-1">
            <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] font-bold text-foreground">{s.baseAsset}/USDT</span>
                <span className={`text-[9px] px-1.5 py-0.5 rounded border font-bold ${dirCls}`}>
                    {s.direction === "short" ? "هبوط" : "صعود"}
                </span>
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-gold/10 text-gold font-bold">{s.timeframe}</span>
                <span className={`text-[9px] px-1.5 py-0.5 rounded border font-bold ${b.cls}`}>{b.text}</span>
                {pnl != null && (
                    <span className={`text-[9px] font-bold ${pnlCls}`}>
                        {pnl >= 0 ? "+" : ""}{pnl.toFixed(2)}%
                    </span>
                )}
                <span className="mr-auto text-[9px] text-muted-foreground">{timeAgo(s.createdAt)}</span>
            </div>
            <div className="text-[9px] text-stock-red/90 leading-relaxed flex items-start gap-1">
                <XIcon className="w-2.5 h-2.5 mt-0.5 shrink-0" />
                <span><b>سبب الرفض:</b> {s.rejectionReason}</span>
            </div>
            <div className="grid grid-cols-2 gap-1 text-[9px] text-muted-foreground">
                <span>نموذج: <span className="text-foreground">{s.patternLabel}</span></span>
                <span>نظام: <span className="text-foreground">{s.regimeLabel}</span></span>
                {s.confidence != null && <span>ثقة: <span className="text-foreground">{s.confidence}%</span></span>}
                {s.riskReward != null && <span>R:R: <span className="text-foreground">{s.riskReward.toFixed(2)}</span></span>}
            </div>
            <div className="grid grid-cols-4 gap-1 text-[9px] pt-1 border-t border-border/30">
                <span className="text-muted-foreground">دخول: <span className="text-foreground">{formatPrice(s.entry)}</span></span>
                <span className="text-stock-green">T1: {formatPrice(s.target1)}</span>
                <span className="text-stock-green">T2: {formatPrice(s.target2)}</span>
                <span className="text-stock-red">SL: {formatPrice(s.stopLoss)}</span>
            </div>
        </div>
    );
};

export default ShadowLogPanel;