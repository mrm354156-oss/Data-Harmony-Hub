import { useState } from "react";
import { X, DollarSign } from "lucide-react";
import { toast } from "sonner";
import { formatPrice } from "@/lib/formatPrice";

interface Props {
  item: {
    id: string;
    name_ar: string;
    symbol: string;
    quantity: number;
    buy_price: number;
    currentPrice: number;
    isCrypto: boolean;
    currency: string;
  };
  onClose: () => void;
  onConfirm: (params: { sellQty: number; sellPrice: number }) => void;
}

const SellPartialDialog = ({ item, onClose, onConfirm }: Props) => {
  const [mode, setMode] = useState<"qty" | "amount">("qty");
  const [qtyInput, setQtyInput] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [sellPriceInput, setSellPriceInput] = useState(String(item.currentPrice));

  const sellPrice = parseFloat(sellPriceInput) || item.currentPrice;
  const sym = item.isCrypto ? "$" : "ج.م";
  const unit = item.isCrypto ? "وحدة" : "سهم";
  const fmtPrice = (n: number) => item.isCrypto ? formatPrice(n) : `${n.toFixed(2)} ${sym}`;

  let sellQty = 0;
  if (mode === "qty") {
    sellQty = parseFloat(qtyInput) || 0;
  } else {
    const amt = parseFloat(amountInput) || 0;
    sellQty = sellPrice > 0 ? amt / sellPrice : 0;
  }

  const realizedPL = (sellPrice - item.buy_price) * sellQty;
  const realizedPct = item.buy_price > 0 ? ((sellPrice - item.buy_price) / item.buy_price) * 100 : 0;
  const proceeds = sellPrice * sellQty;
  const remaining = item.quantity - sellQty;

  const setPercent = (pct: number) => {
    setMode("qty");
    setQtyInput(String(item.quantity * pct));
  };

  const handleConfirm = () => {
    if (sellQty <= 0) { toast.error("حدد كمية أو مبلغ للبيع"); return; }
    if (sellQty > item.quantity + 1e-9) { toast.error("الكمية أكبر من اللي عندك"); return; }
    if (sellPrice <= 0) { toast.error("سعر البيع لازم يكون أكبر من صفر"); return; }
    onConfirm({ sellQty, sellPrice });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-background/80 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md bg-card rounded-t-2xl sm:rounded-2xl border border-gold/30 p-5 animate-fade-up" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-gold" />
            <h3 className="font-cairo font-bold text-base text-foreground">بيع جزء من {item.name_ar}</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground"><X className="w-4 h-4" /></button>
        </div>

        <div className="rounded-lg bg-secondary/50 p-3 mb-4 text-xs space-y-1">
          <div className="flex justify-between"><span className="text-muted-foreground">عندك:</span><span className="font-bold text-foreground">{item.quantity.toLocaleString(undefined, { maximumFractionDigits: 6 })} {unit}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">متوسط الشرا:</span><span className="font-bold text-foreground">{fmtPrice(item.buy_price)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">السعر دلوقتي:</span><span className="font-bold text-gold">{fmtPrice(item.currentPrice)}</span></div>
        </div>

        <div className="flex gap-2 mb-3">
          <button onClick={() => setMode("qty")} className={`flex-1 py-2 rounded-lg text-xs font-bold ${mode === "qty" ? "gradient-gold text-primary-foreground" : "bg-secondary text-muted-foreground"}`}>بالكمية</button>
          <button onClick={() => setMode("amount")} className={`flex-1 py-2 rounded-lg text-xs font-bold ${mode === "amount" ? "gradient-gold text-primary-foreground" : "bg-secondary text-muted-foreground"}`}>بالمبلغ</button>
        </div>

        {mode === "qty" ? (
          <div className="mb-3">
            <label className="text-xs text-muted-foreground mb-1 block">كمية البيع ({unit})</label>
            <input type="number" value={qtyInput} onChange={e => setQtyInput(e.target.value)} placeholder="0" className="w-full px-3 py-2.5 rounded-lg bg-secondary text-foreground text-sm border border-border focus:border-gold focus:outline-none font-bold" min="0" max={item.quantity} step="any" autoFocus />
            <div className="flex gap-2 mt-2">
              {[0.25, 0.5, 0.75, 1].map(p => (
                <button key={p} onClick={() => setPercent(p)} className="flex-1 py-1 rounded-md bg-secondary hover:bg-gold/20 text-xs text-muted-foreground hover:text-gold transition-colors">{p === 1 ? "كله" : `${p * 100}%`}</button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mb-3">
            <label className="text-xs text-muted-foreground mb-1 block">مبلغ البيع ({sym})</label>
            <input type="number" value={amountInput} onChange={e => setAmountInput(e.target.value)} placeholder="0" className="w-full px-3 py-2.5 rounded-lg bg-secondary text-foreground text-sm border border-border focus:border-gold focus:outline-none font-bold" min="0" step="any" autoFocus />
          </div>
        )}

        <div className="mb-4">
          <label className="text-xs text-muted-foreground mb-1 block">سعر البيع لكل {unit} ({sym})</label>
          <input type="number" value={sellPriceInput} onChange={e => setSellPriceInput(e.target.value)} className="w-full px-3 py-2.5 rounded-lg bg-secondary text-foreground text-sm border border-border focus:border-gold focus:outline-none font-bold" min="0" step="any" />
        </div>

        {sellQty > 0 && (
          <div className="rounded-lg gradient-card gold-border p-3 mb-4 text-xs space-y-1.5 animate-fade-up">
            <div className="flex justify-between"><span className="text-muted-foreground">هتبيع:</span><span className="font-bold text-foreground">{sellQty.toLocaleString(undefined, { maximumFractionDigits: 6 })} {unit}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">المتحصل:</span><span className="font-bold text-foreground">{proceeds.toLocaleString(undefined, { maximumFractionDigits: 2 })} {sym}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">المتبقي:</span><span className="font-bold text-foreground">{Math.max(0, remaining).toLocaleString(undefined, { maximumFractionDigits: 6 })} {unit}</span></div>
            <div className="flex justify-between border-t border-border pt-1.5 mt-1.5">
              <span className="text-muted-foreground">الربح/الخسارة المحقق:</span>
              <span className={`font-bold ${realizedPL > 0 ? "text-stock-green" : realizedPL < 0 ? "text-stock-red" : "text-gold"}`}>
                {realizedPL > 0 ? "+" : ""}{realizedPL.toFixed(2)} {sym} ({realizedPct > 0 ? "+" : ""}{realizedPct.toFixed(2)}%)
              </span>
            </div>
          </div>
        )}

        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-lg bg-secondary text-muted-foreground text-sm font-bold hover:bg-secondary/80">إلغاء</button>
          <button onClick={handleConfirm} disabled={sellQty <= 0} className="flex-1 py-2.5 rounded-lg gradient-gold text-primary-foreground text-sm font-bold disabled:opacity-50 hover:scale-[1.02] active:scale-95 transition-transform">أكد البيع</button>
        </div>
      </div>
    </div>
  );
};

export default SellPartialDialog;
