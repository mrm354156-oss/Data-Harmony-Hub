import { useState } from "react";
import { Briefcase, Plus, Trash2, TrendingUp, TrendingDown, Minus, LogIn, Pencil, Check, X, Bitcoin, DollarSign, History, Crosshair } from "lucide-react";
import type { Stock } from "@/data/stocks";
import type { User } from "@supabase/supabase-js";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useCryptoPrices } from "@/hooks/useCryptoPrices";
import { useExchangeRate } from "@/hooks/useExchangeRate";
import { useRealizedTrades } from "@/hooks/useRealizedTrades";
import { toast } from "sonner";
import { formatPrice } from "@/lib/formatPrice";
import SellPartialDialog from "@/components/SellPartialDialog";
import VirtualPortfolioPanel from "@/components/VirtualPortfolioPanel";
import SniperLogPanel from "@/components/SniperLogPanel";
import type { LoggedSniperSignal } from "@/hooks/useSniperLog";
import type { VirtualTrade } from "@/hooks/useVirtualPortfolio";

interface PortfolioTabProps {
  stocks: Stock[];
  user: User | null;
  onLoginRequest: () => void;
  sniperLog?: LoggedSniperSignal[];
  sniperPortfolio?: {
    balance: number;
    equity: number;
    floatingPnl: number;
    initialBalance: number;
    totalPnl: number;
    totalPnlPct: number;
    trades: VirtualTrade[];
    wins: number;
    losses: number;
    reset: () => void;
    removeTrade: (id: string) => void;
  };
  sniperLogState?: {
    wins: number;
    losses: number;
    winRate: number;
    resolvedCount: number;
    clear: () => void;
  };
}

const PortfolioTab = ({ stocks, user, onLoginRequest, sniperLog, sniperPortfolio, sniperLogState }: PortfolioTabProps) => {
  const hasSniperData = sniperLog && sniperPortfolio && sniperLog.length > 0;
  const { portfolio, isLoading, addItem, updateItem, removeItem } = usePortfolio(user);
  const { data: cryptoData } = useCryptoPrices();
  const cryptos = cryptoData?.cryptos || [];
  const { rate: USD_TO_EGP, isLive: rateIsLive } = useExchangeRate();
  const { trades: realizedTrades, addTrade: addRealizedTrade, removeTrade: removeRealizedTrade, totalRealized } = useRealizedTrades(user);

  const [showAdd, setShowAdd] = useState(false);
  const [addMode, setAddMode] = useState<"stock" | "crypto">("stock");
  const [search, setSearch] = useState("");
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [buyAmount, setBuyAmount] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPrice, setEditPrice] = useState("");
  const [editQty, setEditQty] = useState("");
  const [displayCurrency, setDisplayCurrency] = useState<"EGP" | "USD">("EGP");
  const [sellingItem, setSellingItem] = useState<null | { id: string; name_ar: string; symbol: string; quantity: number; buy_price: number; currentPrice: number; isCrypto: boolean; currency: string }>(null);
  const [showHistory, setShowHistory] = useState(false);

  const toDisplay = (amount: number, from: "EGP" | "USD") => {
    if (from === displayCurrency) return amount;
    return from === "USD" ? amount * USD_TO_EGP : amount / USD_TO_EGP;
  };
  const displaySym = displayCurrency === "EGP" ? "ج.م" : "$";
  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

  if (!user) {
    return (
      <div className="text-center py-16 animate-fade-up">
        <Briefcase className="w-12 h-12 text-gold mx-auto mb-4" />
        <p className="text-foreground font-bold text-lg mb-2">المحفظة بتاعتك</p>
        <p className="text-muted-foreground text-sm mb-6">سجل دخول عشان تبدأ تتابع أسهمك وعملاتك</p>
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

  const enriched = portfolio.map(item => {
    const isCrypto = item.asset_type === "crypto";
    if (isCrypto) {
      const liveCrypto = cryptos.find(c => c.symbol === item.symbol);
      const currentPrice = liveCrypto?.currentPrice ?? item.buy_price;
      const profitLoss = ((currentPrice - item.buy_price) / item.buy_price) * 100;
      const totalValue = currentPrice * item.quantity;
      const totalCost = item.buy_price * item.quantity;
      return { ...item, currentPrice, profitLoss, totalValue, totalCost, isCrypto: true, currency: "USD" };
    } else {
      const liveStock = stocks.find(s => s.symbol === item.symbol);
      const currentPrice = liveStock?.currentPrice ?? item.buy_price;
      const profitLoss = ((currentPrice - item.buy_price) / item.buy_price) * 100;
      const totalValue = currentPrice * item.quantity;
      const totalCost = item.buy_price * item.quantity;
      return { ...item, currentPrice, profitLoss, totalValue, totalCost, isCrypto: false, currency: "EGP" };
    }
  });

  const stockItems = enriched.filter(i => !i.isCrypto);
  const cryptoItems = enriched.filter(i => i.isCrypto);

  const totalStockValue = stockItems.reduce((s, i) => s + i.totalValue, 0);
  const totalStockCost = stockItems.reduce((s, i) => s + i.totalCost, 0);
  const totalCryptoValue = cryptoItems.reduce((s, i) => s + i.totalValue, 0);
  const totalCryptoCost = cryptoItems.reduce((s, i) => s + i.totalCost, 0);
  // Combined totals in display currency
  const combinedValue = enriched.reduce((s, i) => s + toDisplay(i.totalValue, i.currency as "EGP" | "USD"), 0);
  const combinedCost = enriched.reduce((s, i) => s + toDisplay(i.totalCost, i.currency as "EGP" | "USD"), 0);
  const combinedPL = combinedCost > 0 ? ((combinedValue - combinedCost) / combinedCost) * 100 : 0;

  const filteredStocks = stocks.filter(s =>
    s.nameAr.includes(search) || s.symbol.toLowerCase().includes(search.toLowerCase())
  );

  const filteredCryptos = cryptos.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) || c.symbol.toLowerCase().includes(search.toLowerCase())
  );

  const resetAdd = () => { setShowAdd(false); setSearch(""); setSelectedSymbol(null); setBuyAmount(""); };

  // Weighted average cost: ((oldQty * oldPrice) + (newQty * newPrice)) / (oldQty + newQty)
  const mergeOrAdd = (params: { symbol: string; name_ar: string; price: number; qty: number; asset_type: "stock" | "crypto"; currency: "EGP" | "USD"; amountLabel: string }) => {
    const existing = portfolio.find(p => p.symbol === params.symbol && p.asset_type === params.asset_type);
    if (existing) {
      const oldQty = Number(existing.quantity);
      const oldPrice = Number(existing.buy_price);
      const newQty = oldQty + params.qty;
      const avgPrice = ((oldQty * oldPrice) + (params.qty * params.price)) / newQty;
      updateItem.mutate(
        { id: existing.id, buy_price: avgPrice, quantity: newQty },
        {
          onSuccess: () => { toast.success(`${params.name_ar} اتزود بـ ${params.amountLabel} • متوسط الشرا الجديد ${avgPrice.toFixed(params.asset_type === "crypto" ? 4 : 2)} ✅`); resetAdd(); },
          onError: () => toast.error("حصل مشكلة في الإضافة"),
        }
      );
    } else {
      addItem.mutate(
        { symbol: params.symbol, name_ar: params.name_ar, buy_price: params.price, quantity: params.qty, asset_type: params.asset_type, currency: params.currency },
        {
          onSuccess: () => { toast.success(`${params.name_ar} اتضاف بـ ${params.amountLabel} ✅`); resetAdd(); },
          onError: () => toast.error("حصل مشكلة في الإضافة"),
        }
      );
    }
  };

  const handleAddStock = (stock: Stock) => {
    const amount = parseFloat(buyAmount);
    if (!amount || amount <= 0) { toast.error("اكتب المبلغ اللي عايز تشتري بيه"); return; }
    if (!stock.currentPrice || stock.currentPrice <= 0) { toast.error("السعر مش متاح دلوقتي"); return; }
    const qty = amount / stock.currentPrice;
    mergeOrAdd({ symbol: stock.symbol, name_ar: stock.nameAr, price: stock.currentPrice, qty, asset_type: "stock", currency: "EGP", amountLabel: `${amount} ج.م` });
  };

  const handleAddCrypto = (crypto: typeof cryptos[0]) => {
    const amount = parseFloat(buyAmount);
    if (!amount || amount <= 0) { toast.error("اكتب المبلغ اللي عايز تشتري بيه"); return; }
    if (!crypto.currentPrice || crypto.currentPrice <= 0) { toast.error("السعر مش متاح دلوقتي"); return; }
    const qty = amount / crypto.currentPrice;
    mergeOrAdd({ symbol: crypto.symbol, name_ar: crypto.name, price: crypto.currentPrice, qty, asset_type: "crypto", currency: "USD", amountLabel: `$${amount}` });
  };

  const startEdit = (item: typeof enriched[0]) => {
    setEditingId(item.id);
    setEditPrice(String(item.buy_price));
    setEditQty(String(item.quantity));
  };

  const cancelEdit = () => { setEditingId(null); setEditPrice(""); setEditQty(""); };

  const saveEdit = (id: string) => {
    const price = parseFloat(editPrice);
    const qty = parseFloat(editQty);
    if (!price || price <= 0 || !qty || qty <= 0) { toast.error("حط قيم صح"); return; }
    updateItem.mutate(
      { id, buy_price: price, quantity: qty },
      { onSuccess: () => { toast.success("تم التحديث ✅"); cancelEdit(); }, onError: () => toast.error("حصل مشكلة") }
    );
  };

  const handleSellPartial = (params: { sellQty: number; sellPrice: number }) => {
    if (!sellingItem) return;
    const { sellQty, sellPrice } = params;
    const remaining = sellingItem.quantity - sellQty;
    const realized_pl = (sellPrice - sellingItem.buy_price) * sellQty;
    const realized_pl_pct = sellingItem.buy_price > 0 ? ((sellPrice - sellingItem.buy_price) / sellingItem.buy_price) * 100 : 0;

    const finalize = () => {
      addRealizedTrade({
        symbol: sellingItem.symbol,
        name_ar: sellingItem.name_ar,
        asset_type: sellingItem.isCrypto ? "crypto" : "stock",
        currency: sellingItem.isCrypto ? "USD" : "EGP",
        buy_price: sellingItem.buy_price,
        sell_price: sellPrice,
        quantity: sellQty,
        realized_pl,
        realized_pl_pct,
      });
      const sym = sellingItem.isCrypto ? "$" : "ج.م";
      toast.success(`اتباع ${sellQty.toFixed(sellingItem.isCrypto ? 6 : 4)} • ${realized_pl >= 0 ? "ربح" : "خسارة"} ${realized_pl.toFixed(2)} ${sym}`);
      setSellingItem(null);
    };

    if (remaining <= 1e-9) {
      // Sell all → remove the item
      removeItem.mutate(sellingItem.id, {
        onSuccess: finalize,
        onError: () => toast.error("حصل مشكلة في البيع"),
      });
    } else {
      // Partial sell → keep average buy price, reduce quantity
      updateItem.mutate(
        { id: sellingItem.id, buy_price: sellingItem.buy_price, quantity: remaining },
        {
          onSuccess: finalize,
          onError: () => toast.error("حصل مشكلة في البيع"),
        }
      );
    }
  };

  const currencyLabel = (isCrypto: boolean) => isCrypto ? "$" : "ج.م";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Briefcase className="w-5 h-5 text-gold" />
          <h2 className="font-cairo font-bold text-lg text-foreground">💼 محفظتي</h2>
        </div>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-gold/20 text-gold text-xs font-bold hover:bg-gold/30 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          إضافة
        </button>
      </div>

      {showAdd && (
        <div className="rounded-xl border border-gold/30 bg-card p-4 animate-fade-up">
          <div className="flex gap-2 mb-3">
            <button
              onClick={() => { setAddMode("stock"); setSearch(""); }}
              className={`flex-1 py-2 rounded-lg text-xs font-bold transition-colors ${addMode === "stock" ? "gradient-gold text-primary-foreground" : "bg-secondary text-muted-foreground"}`}
            >
              📈 أسهم
            </button>
            <button
              onClick={() => { setAddMode("crypto"); setSearch(""); }}
              className={`flex-1 py-2 rounded-lg text-xs font-bold transition-colors ${addMode === "crypto" ? "gradient-gold text-primary-foreground" : "bg-secondary text-muted-foreground"}`}
            >
              ₿ عملات رقمية
            </button>
          </div>
          <input
            type="text"
            placeholder={addMode === "stock" ? "دور على سهم..." : "دور على عملة..."}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full px-4 py-2.5 rounded-lg bg-secondary text-foreground text-sm border border-border focus:border-gold focus:outline-none font-cairo mb-3"
            maxLength={100}
          />
          <div className="max-h-72 overflow-y-auto space-y-2">
            {addMode === "stock" ? (
              filteredStocks.slice(0, 20).map(stock => {
                const isSel = selectedSymbol === stock.symbol;
                const amt = parseFloat(buyAmount) || 0;
                const qty = isSel && amt > 0 && stock.currentPrice > 0 ? amt / stock.currentPrice : 0;
                return (
                  <div key={stock.id} className={`rounded-lg transition-colors ${isSel ? "bg-secondary border border-gold/40" : "hover:bg-secondary"}`}>
                    <button
                      onClick={() => { setSelectedSymbol(isSel ? null : stock.symbol); setBuyAmount(""); }}
                      className="w-full flex items-center justify-between p-3 text-right"
                    >
                      <div>
                        <p className="font-cairo font-bold text-sm text-foreground">{stock.nameAr}</p>
                        <p className="text-xs text-muted-foreground">{stock.symbol}</p>
                      </div>
                      <p className="font-bold text-sm text-foreground">{stock.currentPrice} ج.م</p>
                    </button>
                    {isSel && (
                      <div className="px-3 pb-3 space-y-2 animate-fade-up">
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            placeholder="المبلغ بالجنيه"
                            value={buyAmount}
                            onChange={e => setBuyAmount(e.target.value)}
                            className="flex-1 px-3 py-2 rounded-md bg-card text-foreground text-sm border border-gold/50 focus:border-gold focus:outline-none font-bold"
                            min="0.01"
                            step="any"
                            autoFocus
                          />
                          <span className="text-xs text-muted-foreground">ج.م</span>
                        </div>
                        {qty > 0 && (
                          <p className="text-[11px] text-muted-foreground">هتشتري ≈ <span className="text-gold font-bold">{qty.toFixed(4)}</span> سهم</p>
                        )}
                        <button
                          onClick={() => handleAddStock(stock)}
                          disabled={!buyAmount || addItem.isPending}
                          className="w-full py-2 rounded-md gradient-gold text-primary-foreground text-xs font-bold disabled:opacity-50 hover:scale-[1.02] active:scale-95 transition-transform"
                        >
                          أضف للمحفظة
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              filteredCryptos.slice(0, 20).map(crypto => {
                const isSel = selectedSymbol === crypto.symbol;
                const amt = parseFloat(buyAmount) || 0;
                const qty = isSel && amt > 0 && crypto.currentPrice > 0 ? amt / crypto.currentPrice : 0;
                return (
                  <div key={crypto.id} className={`rounded-lg transition-colors ${isSel ? "bg-secondary border border-gold/40" : "hover:bg-secondary"}`}>
                    <button
                      onClick={() => { setSelectedSymbol(isSel ? null : crypto.symbol); setBuyAmount(""); }}
                      className="w-full flex items-center justify-between p-3 text-right"
                    >
                      <div className="flex items-center gap-2">
                        <img src={crypto.image} alt={crypto.name} className="w-6 h-6 rounded-full" />
                        <div>
                          <p className="font-cairo font-bold text-sm text-foreground">{crypto.name}</p>
                          <p className="text-xs text-muted-foreground">{crypto.symbol}</p>
                        </div>
                      </div>
                      <p className="font-bold text-sm text-foreground">{formatPrice(crypto.currentPrice)}</p>
                    </button>
                    {isSel && (
                      <div className="px-3 pb-3 space-y-2 animate-fade-up">
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            placeholder="المبلغ بالدولار"
                            value={buyAmount}
                            onChange={e => setBuyAmount(e.target.value)}
                            className="flex-1 px-3 py-2 rounded-md bg-card text-foreground text-sm border border-gold/50 focus:border-gold focus:outline-none font-bold"
                            min="0.01"
                            step="any"
                            autoFocus
                          />
                          <span className="text-xs text-muted-foreground">$</span>
                        </div>
                        {qty > 0 && (
                          <p className="text-[11px] text-muted-foreground">هتشتري ≈ <span className="text-gold font-bold">{qty.toFixed(6)}</span> {crypto.symbol}</p>
                        )}
                        <button
                          onClick={() => handleAddCrypto(crypto)}
                          disabled={!buyAmount || addItem.isPending}
                          className="w-full py-2 rounded-md gradient-gold text-primary-foreground text-xs font-bold disabled:opacity-50 hover:scale-[1.02] active:scale-95 transition-transform"
                        >
                          أضف للمحفظة
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
            {((addMode === "stock" && filteredStocks.length === 0) || (addMode === "crypto" && filteredCryptos.length === 0)) && (
              <p className="text-center text-muted-foreground text-sm py-4">مفيش نتايج</p>
            )}
          </div>
        </div>
      )}

      {enriched.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-xl bg-secondary/50 border border-border p-2">
            <p className="text-xs text-muted-foreground px-2">عرض القيم بـ:</p>
            <div className="flex gap-1">
              <button
                onClick={() => setDisplayCurrency("EGP")}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors ${displayCurrency === "EGP" ? "gradient-gold text-primary-foreground" : "bg-card text-muted-foreground"}`}
              >
                ج.م جنيه
              </button>
              <button
                onClick={() => setDisplayCurrency("USD")}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors ${displayCurrency === "USD" ? "gradient-gold text-primary-foreground" : "bg-card text-muted-foreground"}`}
              >
                $ دولار
              </button>
            </div>
          </div>

          <SummaryCard
            label="إجمالي المحفظة"
            value={combinedValue}
            cost={combinedCost}
            pl={combinedPL}
            currency={displaySym}
          />

          {stockItems.length > 0 && cryptoItems.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              <MiniCard
                label="أسهم"
                value={toDisplay(totalStockValue, "EGP")}
                cost={toDisplay(totalStockCost, "EGP")}
                currency={displaySym}
              />
              <MiniCard
                label="عملات"
                value={toDisplay(totalCryptoValue, "USD")}
                cost={toDisplay(totalCryptoCost, "USD")}
                currency={displaySym}
                icon={<Bitcoin className="w-3 h-3 text-gold" />}
              />
            </div>
          )}
          <p className="text-[10px] text-muted-foreground text-center">
            {rateIsLive ? "💱 سعر صرف لايف" : "⚠️ سعر صرف تقريبي"}: 1$ = {USD_TO_EGP.toFixed(2)} ج.م
          </p>
        </div>
      )}

      {isLoading ? (
        <p className="text-center text-muted-foreground py-8">بنحمّل...</p>
      ) : enriched.length === 0 ? (
        <div className="text-center py-12 rounded-xl gradient-card gold-border p-6">
          <p className="text-gold font-bold text-lg mb-2">📂 محفظتك فاضية</p>
          <p className="text-muted-foreground text-sm">دوس "إضافة" عشان تبدأ تتابع أسهمك وعملاتك</p>
        </div>
      ) : (
        <div className="space-y-3">
          {enriched.map((item, i) => (
            <div
              key={item.id}
              className="rounded-xl gradient-card border border-border p-4 animate-fade-up"
              style={{ animationDelay: `${i * 50}ms` }}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  {item.isCrypto && <Bitcoin className="w-4 h-4 text-gold" />}
                  <div>
                    <h3 className="font-cairo font-bold text-sm text-foreground">{item.name_ar}</h3>
                    <p className="text-xs text-muted-foreground">
                      {item.symbol} • {Number(item.quantity).toLocaleString(undefined, { maximumFractionDigits: item.isCrypto ? 6 : 4 })} {item.isCrypto ? "وحدة" : "سهم"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {editingId === item.id ? (
                    <>
                      <button onClick={() => saveEdit(item.id)} className="p-2 rounded-lg hover:bg-stock-green/20 text-stock-green transition-colors"><Check className="w-4 h-4" /></button>
                      <button onClick={cancelEdit} className="p-2 rounded-lg hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"><X className="w-4 h-4" /></button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => setSellingItem({ id: item.id, name_ar: item.name_ar, symbol: item.symbol, quantity: Number(item.quantity), buy_price: Number(item.buy_price), currentPrice: item.currentPrice, isCrypto: item.isCrypto, currency: item.currency })} className="p-2 rounded-lg hover:bg-stock-green/20 text-muted-foreground hover:text-stock-green transition-colors" title="بيع جزء"><DollarSign className="w-4 h-4" /></button>
                      <button onClick={() => startEdit(item)} className="p-2 rounded-lg hover:bg-gold/20 text-muted-foreground hover:text-gold transition-colors"><Pencil className="w-4 h-4" /></button>
                      <button onClick={() => removeItem.mutate(item.id, { onSuccess: () => toast.success("اتمسح من المحفظة") })} className="p-2 rounded-lg hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"><Trash2 className="w-4 h-4" /></button>
                    </>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div>
                  <p className="text-muted-foreground">سعر الشرا</p>
                  {editingId === item.id ? (
                    <input type="number" value={editPrice} onChange={e => setEditPrice(e.target.value)} className="w-full mt-1 px-2 py-1 rounded-md bg-secondary text-foreground text-xs border border-gold/50 focus:border-gold focus:outline-none font-bold" min="0.0001" step="any" />
                  ) : (
                    <p className="font-bold text-foreground">{item.isCrypto ? formatPrice(item.buy_price) : `${item.buy_price} ج.م`}</p>
                  )}
                </div>
                <div>
                  <p className="text-muted-foreground">{editingId === item.id ? "الكمية" : "السعر دلوقتي"}</p>
                  {editingId === item.id ? (
                    <input type="number" value={editQty} onChange={e => setEditQty(e.target.value)} className="w-full mt-1 px-2 py-1 rounded-md bg-secondary text-foreground text-xs border border-gold/50 focus:border-gold focus:outline-none font-bold" min="0.0001" step="any" />
                  ) : (
                    <p className="font-bold text-foreground">{item.isCrypto ? formatPrice(item.currentPrice) : `${item.currentPrice.toLocaleString()} ج.م`}</p>
                  )}
                </div>
                <div>
                  <p className="text-muted-foreground">كسبان/خسران</p>
                  <p className={`font-bold ${item.profitLoss > 0 ? "text-stock-green" : item.profitLoss < 0 ? "text-stock-red" : "text-gold"}`}>
                    {item.profitLoss > 0 ? "+" : ""}{item.profitLoss.toFixed(2)}%
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {realizedTrades.length > 0 && (
        <div className="rounded-xl gradient-card border border-border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-gold" />
              <h3 className="font-cairo font-bold text-sm text-foreground">الأرباح/الخسائر المحققة</h3>
            </div>
            <button onClick={() => setShowHistory(s => !s)} className="text-xs text-gold hover:underline">
              {showHistory ? "إخفاء" : `عرض (${realizedTrades.length})`}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-secondary/50 p-2">
              <p className="text-[10px] text-muted-foreground">إجمالي بالجنيه</p>
              <p className={`font-bold text-sm ${totalRealized.egp > 0 ? "text-stock-green" : totalRealized.egp < 0 ? "text-stock-red" : "text-foreground"}`}>
                {totalRealized.egp > 0 ? "+" : ""}{totalRealized.egp.toFixed(2)} ج.م
              </p>
            </div>
            <div className="rounded-lg bg-secondary/50 p-2">
              <p className="text-[10px] text-muted-foreground">إجمالي بالدولار</p>
              <p className={`font-bold text-sm ${totalRealized.usd > 0 ? "text-stock-green" : totalRealized.usd < 0 ? "text-stock-red" : "text-foreground"}`}>
                {totalRealized.usd > 0 ? "+" : ""}{totalRealized.usd.toFixed(2)} $
              </p>
            </div>
          </div>
          {showHistory && (
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {realizedTrades.map(t => {
                const sym = t.currency === "USD" ? "$" : "ج.م";
                return (
                  <div key={t.id} className="rounded-lg bg-secondary/40 p-2.5 text-xs">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5">
                        {t.asset_type === "crypto" && <Bitcoin className="w-3 h-3 text-gold" />}
                        <span className="font-bold text-foreground">{t.name_ar}</span>
                        <span className="text-muted-foreground">({t.symbol})</span>
                      </div>
                      <button onClick={() => removeRealizedTrade(t.id)} className="p-1 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive"><X className="w-3 h-3" /></button>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>{t.quantity.toLocaleString(undefined, { maximumFractionDigits: 6 })} × {t.sell_price.toFixed(2)} {sym}</span>
                      <span className={`font-bold ${t.realized_pl > 0 ? "text-stock-green" : t.realized_pl < 0 ? "text-stock-red" : "text-gold"}`}>
                        {t.realized_pl > 0 ? "+" : ""}{t.realized_pl.toFixed(2)} {sym} ({t.realized_pl_pct > 0 ? "+" : ""}{t.realized_pl_pct.toFixed(2)}%)
                      </span>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1">{new Date(t.sold_at).toLocaleString("ar-EG", { timeZone: "Africa/Cairo" })}</p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 🎯 توصيات القناص — المحفظة الوهمية وسجل التوصيات (تظهر دائماً) */}
      <div className="pt-4 border-t border-border space-y-3">
        <div className="flex items-center gap-2">
          <Crosshair className="w-4 h-4 text-gold" />
          <h3 className="font-cairo font-bold text-sm text-foreground">🎯 محفظة القناص الوهمية</h3>
        </div>
        {hasSniperData ? (
          <>
            <VirtualPortfolioPanel
              balance={sniperPortfolio!.balance}
              equity={sniperPortfolio!.equity}
              floatingPnl={sniperPortfolio!.floatingPnl}
              initialBalance={sniperPortfolio!.initialBalance}
              totalPnl={sniperPortfolio!.totalPnl}
              totalPnlPct={sniperPortfolio!.totalPnlPct}
              trades={sniperPortfolio!.trades}
              openLog={sniperLog!}
              wins={sniperPortfolio!.wins}
              losses={sniperPortfolio!.losses}
              onReset={sniperPortfolio!.reset}
              onRemoveTrade={sniperPortfolio!.removeTrade}
            />
            <SniperLogPanel
              log={sniperLog!}
              wins={sniperLogState?.wins ?? 0}
              losses={sniperLogState?.losses ?? 0}
              winRate={sniperLogState?.winRate ?? 0}
              resolvedCount={sniperLogState?.resolvedCount ?? 0}
              onClear={sniperLogState?.clear ?? (() => { })}
            />
          </>
        ) : (
          <div className="rounded-xl border border-border bg-secondary/30 p-4 text-center">
            <p className="text-xs text-muted-foreground">
              🎯 لا توجد توصيات قناص بعد — استخدم تبويب القناص لبدء المسح
            </p>
          </div>
        )}
      </div>

      {sellingItem && (
        <SellPartialDialog item={sellingItem} onClose={() => setSellingItem(null)} onConfirm={handleSellPartial} />
      )}
    </div>
  );
};

const SummaryCard = ({ label, value, cost, pl, currency, icon }: { label: string; value: number; cost: number; pl: number; currency: string; icon?: React.ReactNode }) => {
  const profit = value - cost;
  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return (
    <div className="rounded-xl gradient-card gold-border p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-1.5">
            {icon}
            <p className="text-xs text-muted-foreground">{label}</p>
          </div>
          <p className="font-bold text-xl text-foreground">{fmt(value)} {currency}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">تكلفة: {fmt(cost)} {currency}</p>
        </div>
        <div className="text-left">
          <p className="text-xs text-muted-foreground">كسبان/خسران</p>
          <div className="flex items-center gap-1">
            {pl > 0 ? <TrendingUp className="w-4 h-4 text-stock-green" /> : pl < 0 ? <TrendingDown className="w-4 h-4 text-stock-red" /> : <Minus className="w-4 h-4 text-gold" />}
            <span className={`font-bold text-lg ${pl > 0 ? "text-stock-green" : pl < 0 ? "text-stock-red" : "text-gold"}`}>
              {pl > 0 ? "+" : ""}{pl.toFixed(2)}%
            </span>
          </div>
          <p className={`text-[11px] font-bold mt-0.5 ${profit > 0 ? "text-stock-green" : profit < 0 ? "text-stock-red" : "text-gold"}`}>
            {profit > 0 ? "+" : ""}{fmt(profit)} {currency}
          </p>
        </div>
      </div>
    </div>
  );
};

const MiniCard = ({ label, value, cost, currency, icon }: { label: string; value: number; cost: number; currency: string; icon?: React.ReactNode }) => {
  const profit = value - cost;
  const pl = cost > 0 ? ((value - cost) / cost) * 100 : 0;
  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return (
    <div className="rounded-xl gradient-card border border-border p-3">
      <div className="flex items-center gap-1 mb-1">
        {icon}
        <p className="text-[11px] text-muted-foreground">{label}</p>
      </div>
      <p className="font-bold text-sm text-foreground">{fmt(value)} {currency}</p>
      <p className={`text-[11px] font-bold mt-0.5 ${profit > 0 ? "text-stock-green" : profit < 0 ? "text-stock-red" : "text-gold"}`}>
        {pl > 0 ? "+" : ""}{pl.toFixed(2)}%
      </p>
    </div>
  );
};

export default PortfolioTab;
