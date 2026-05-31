import { useState, useEffect, useRef } from "react";
import { Bell, Plus, Trash2, LogIn, TrendingUp, TrendingDown, CheckCircle2 } from "lucide-react";
import type { Stock } from "@/data/stocks";
import type { User } from "@supabase/supabase-js";
import { usePriceAlerts } from "@/hooks/usePriceAlerts";
import { toast } from "sonner";

interface AlertsTabProps {
  stocks: Stock[];
  user: User | null;
  onLoginRequest: () => void;
}

const AlertsTab = ({ stocks, user, onLoginRequest }: AlertsTabProps) => {
  const { alerts, isLoading, addAlert, removeAlert, triggerAlert } = usePriceAlerts(user);
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedStock, setSelectedStock] = useState<Stock | null>(null);
  const [targetPrice, setTargetPrice] = useState("");
  const [direction, setDirection] = useState<"above" | "below">("above");
  const triggeredRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!stocks.length || !alerts.length) return;

    alerts.forEach((alert) => {
      if (alert.is_triggered || triggeredRef.current.has(alert.id)) return;
      const liveStock = stocks.find((s) => s.symbol === alert.symbol);
      if (!liveStock) return;

      const triggered =
        (alert.direction === "above" && liveStock.currentPrice >= alert.target_price) ||
        (alert.direction === "below" && liveStock.currentPrice <= alert.target_price);

      if (triggered) {
        triggeredRef.current.add(alert.id);
        triggerAlert.mutate(alert.id);
        toast.success(
          `🔔 تنبيه! ${alert.name_ar} وصل ${liveStock.currentPrice.toFixed(2)} ج.م (${alert.direction === "above" ? "فوق" : "تحت"} ${alert.target_price} ج.م)`,
          { duration: 10000 }
        );
      }
    });
  }, [stocks, alerts]);

  if (!user) {
    return (
      <div className="text-center py-16 animate-fade-up">
        <Bell className="w-12 h-12 text-gold mx-auto mb-4" />
        <p className="text-foreground font-bold text-lg mb-2">تنبيهات الأسعار</p>
        <p className="text-muted-foreground text-sm mb-6">سجل دخول عشان تحط تنبيهات على الأسهم</p>
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

  const filteredStocks = stocks.filter(
    (s) =>
      s.nameAr.includes(search) || s.symbol.toLowerCase().includes(search.toLowerCase())
  );

  const handleAdd = () => {
    if (!selectedStock || !targetPrice) return;
    const price = parseFloat(targetPrice);
    if (!price || price <= 0) {
      toast.error("حط سعر صح");
      return;
    }
    addAlert.mutate(
      { symbol: selectedStock.symbol, name_ar: selectedStock.nameAr, target_price: price, direction },
      {
        onSuccess: () => {
          toast.success(`تنبيه ${selectedStock.nameAr} اتضاف ✅`);
          setShowAdd(false);
          setSelectedStock(null);
          setTargetPrice("");
          setSearch("");
        },
        onError: () => toast.error("حصل مشكلة في الإضافة"),
      }
    );
  };

  const activeAlerts = alerts.filter((a) => !a.is_triggered);
  const triggeredAlerts = alerts.filter((a) => a.is_triggered);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Bell className="w-5 h-5 text-gold" />
          <h2 className="font-cairo font-bold text-lg text-foreground">🔔 تنبيهاتي</h2>
        </div>
        <button
          onClick={() => { setShowAdd(!showAdd); setSelectedStock(null); setSearch(""); }}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-gold/20 text-gold text-xs font-bold hover:bg-gold/30 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          تنبيه جديد
        </button>
      </div>

      {showAdd && (
        <div className="rounded-xl border border-gold/30 bg-card p-4 animate-fade-up space-y-3">
          {!selectedStock ? (
            <>
              <input
                type="text"
                placeholder="دور على سهم..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full px-4 py-2.5 rounded-lg bg-secondary text-foreground text-sm border border-border focus:border-gold focus:outline-none font-cairo"
                maxLength={100}
              />
              <div className="max-h-48 overflow-y-auto space-y-2">
                {filteredStocks.slice(0, 15).map((stock) => (
                  <button
                    key={stock.id}
                    onClick={() => setSelectedStock(stock)}
                    className="w-full flex items-center justify-between p-3 rounded-lg hover:bg-secondary transition-colors text-right"
                  >
                    <div>
                      <p className="font-cairo font-bold text-sm text-foreground">{stock.nameAr}</p>
                      <p className="text-xs text-muted-foreground">{stock.symbol}</p>
                    </div>
                    <p className="font-bold text-sm text-foreground">{stock.currentPrice.toFixed(2)} ج.م</p>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between p-3 rounded-lg bg-secondary">
                <div>
                  <p className="font-cairo font-bold text-sm text-foreground">{selectedStock.nameAr}</p>
                  <p className="text-xs text-muted-foreground">السعر دلوقتي: {selectedStock.currentPrice.toFixed(2)} ج.م</p>
                </div>
                <button onClick={() => setSelectedStock(null)} className="text-xs text-gold">غيّر</button>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setDirection("above")}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-bold transition-colors ${
                    direction === "above" ? "bg-stock-green/20 text-stock-green border border-stock-green/30" : "bg-secondary text-muted-foreground"
                  }`}
                >
                  <TrendingUp className="w-3.5 h-3.5" />
                  لما يوصل فوق
                </button>
                <button
                  onClick={() => setDirection("below")}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-bold transition-colors ${
                    direction === "below" ? "bg-stock-red/20 text-stock-red border border-stock-red/30" : "bg-secondary text-muted-foreground"
                  }`}
                >
                  <TrendingDown className="w-3.5 h-3.5" />
                  لما ينزل تحت
                </button>
              </div>

              <input
                type="number"
                placeholder="السعر اللي عايزه (ج.م)"
                value={targetPrice}
                onChange={(e) => setTargetPrice(e.target.value)}
                className="w-full px-4 py-2.5 rounded-lg bg-secondary text-foreground text-sm border border-border focus:border-gold focus:outline-none font-cairo"
                min="0.01"
                step="0.01"
              />

              <button
                onClick={handleAdd}
                disabled={addAlert.isPending}
                className="w-full py-2.5 rounded-lg gradient-gold text-primary-foreground font-bold text-sm hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50"
              >
                {addAlert.isPending ? "بنضيف..." : "ضيف التنبيه"}
              </button>
            </>
          )}
        </div>
      )}

      {isLoading ? (
        <p className="text-center text-muted-foreground py-8">بنحمّل...</p>
      ) : activeAlerts.length === 0 && triggeredAlerts.length === 0 ? (
        <div className="text-center py-12 rounded-xl gradient-card gold-border p-6">
          <p className="text-gold font-bold text-lg mb-2">🔕 مفيش تنبيهات</p>
          <p className="text-muted-foreground text-sm">دوس "تنبيه جديد" عشان تتابع سعر سهم معين</p>
        </div>
      ) : (
        <>
          {activeAlerts.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground font-bold">⏳ تنبيهات شغالة ({activeAlerts.length})</p>
              {activeAlerts.map((alert, i) => {
                const liveStock = stocks.find((s) => s.symbol === alert.symbol);
                const currentPrice = liveStock?.currentPrice ?? 0;
                const diff = alert.direction === "above"
                  ? ((alert.target_price - currentPrice) / currentPrice * 100)
                  : ((currentPrice - alert.target_price) / currentPrice * 100);

                return (
                  <div
                    key={alert.id}
                    className="rounded-xl gradient-card border border-border p-4 animate-fade-up"
                    style={{ animationDelay: `${i * 50}ms` }}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <h3 className="font-cairo font-bold text-sm text-foreground">{alert.name_ar}</h3>
                        <p className="text-xs text-muted-foreground">{alert.symbol}</p>
                      </div>
                      <button
                        onClick={() => removeAlert.mutate(alert.id, { onSuccess: () => toast.success("التنبيه اتمسح") })}
                        className="p-2 rounded-lg hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <p className="text-muted-foreground">السعر دلوقتي</p>
                        <p className="font-bold text-foreground">{currentPrice.toFixed(2)} ج.م</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">{alert.direction === "above" ? "فوق" : "تحت"}</p>
                        <p className="font-bold text-gold">{alert.target_price} ج.م</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">الفرق</p>
                        <p className={`font-bold ${diff > 0 ? "text-gold" : "text-stock-green"}`}>
                          {diff > 0 ? `${diff.toFixed(1)}% فاضل` : "قرّب!"}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {triggeredAlerts.length > 0 && (
            <div className="space-y-3 mt-4">
              <p className="text-xs text-muted-foreground font-bold">✅ تنبيهات اتحققت ({triggeredAlerts.length})</p>
              {triggeredAlerts.map((alert) => (
                <div key={alert.id} className="rounded-xl bg-stock-green/5 border border-stock-green/20 p-4 opacity-70">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-stock-green" />
                      <div>
                        <h3 className="font-cairo font-bold text-sm text-foreground">{alert.name_ar}</h3>
                        <p className="text-xs text-muted-foreground">
                          {alert.direction === "above" ? "فوق" : "تحت"} {alert.target_price} ج.م
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => removeAlert.mutate(alert.id)}
                      className="p-2 rounded-lg hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default AlertsTab;
