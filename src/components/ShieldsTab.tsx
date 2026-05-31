import { useEffect, useState } from "react";
import { Shield, Clock, AlertTriangle, ShieldCheck } from "lucide-react";
import {
  loadSniperSettings,
  saveSniperSettings,
  DEFAULT_SHIELD_MULTIPLIERS,
  SWEEP_SENS_MIN,
  SWEEP_SENS_MAX,
  type ShieldMultipliers,
} from "@/lib/sniperSettings";

/**
 * تاب الدروع — يجمع كل أدوات الحماية التي كانت في تاب القناص:
 *  - 🛡️ درع بوابة المطبخ الذكي (Kitchen Shield) + مضاعفات الصرامة
 *  - ⏱️ مدة الصفقة الديناميكية (Dynamic TTL)
 *  - 🪤 درع حساسية كشف فخاخ السيولة (Sweep Sensitivity)
 *
 * الإعدادات محفوظة في نفس مخزن sniper_settings (محلي + سحابي)
 * فالتكامل مع محرك القناص يبقى كاملاً تلقائياً.
 */
const ShieldsTab = () => {
  const [dynamicTtl, setDynamicTtl] = useState(() => loadSniperSettings().dynamicTtl);
  const [kitchenShield, setKitchenShield] = useState(() => loadSniperSettings().kitchenShield);
  const [shieldMultipliers, setShieldMultipliersState] = useState<ShieldMultipliers>(
    () => loadSniperSettings().shieldMultipliers,
  );
  const [sweepSensitivity, setSweepSensitivityState] = useState<number>(
    () => loadSniperSettings().sweepSensitivity,
  );
  const [showShieldAdvanced, setShowShieldAdvanced] = useState(false);

  // تزامن مع التغييرات القادمة من تابات أخرى أو السحابة
  useEffect(() => {
    const onChange = () => {
      const s = loadSniperSettings();
      setDynamicTtl(s.dynamicTtl);
      setKitchenShield(s.kitchenShield);
      setShieldMultipliersState(s.shieldMultipliers);
      setSweepSensitivityState(s.sweepSensitivity);
    };
    window.addEventListener("sniper-settings-changed", onChange);
    return () => window.removeEventListener("sniper-settings-changed", onChange);
  }, []);

  const toggleDynamicTtl = () => {
    const next = !dynamicTtl;
    setDynamicTtl(next);
    saveSniperSettings({ dynamicTtl: next });
  };
  const toggleKitchenShield = () => {
    const next = !kitchenShield;
    setKitchenShield(next);
    saveSniperSettings({ kitchenShield: next });
  };
  const updateMultiplier = (key: keyof ShieldMultipliers, value: number) => {
    const next = { ...shieldMultipliers, [key]: value };
    setShieldMultipliersState(next);
    saveSniperSettings({ shieldMultipliers: next });
  };
  const resetMultipliers = () => {
    const next = { ...DEFAULT_SHIELD_MULTIPLIERS };
    setShieldMultipliersState(next);
    saveSniperSettings({ shieldMultipliers: next });
  };
  const updateSweepSensitivity = (n: number) => {
    setSweepSensitivityState(n);
    saveSniperSettings({ sweepSensitivity: n });
  };

  return (
    <div className="space-y-4 pb-4">
      {/* رأس التاب — اللوجو */}
      <div className="flex items-center gap-3 p-3 rounded-xl bg-gradient-to-br from-gold/15 to-secondary/40 border border-gold/30">
        <div className="w-12 h-12 rounded-xl gradient-gold flex items-center justify-center shadow-lg">
          <ShieldCheck className="w-7 h-7 text-primary-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-bold text-foreground">🛡️ مركز الدروع</h2>
          <p className="text-[10px] text-muted-foreground leading-tight">
            كل أدوات الحماية في مكان واحد — تتكامل مباشرة مع محرك القناص.
          </p>
        </div>
      </div>

      {/* درع بوابة المطبخ الذكي */}
      <div
        className={`flex items-center justify-between gap-2 p-2.5 rounded-lg border ${
          kitchenShield ? "bg-gold/10 border-gold/40" : "bg-secondary/40 border-border"
        }`}
      >
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-bold text-foreground flex items-center gap-1.5">
            <Shield className={`w-3.5 h-3.5 ${kitchenShield ? "text-gold" : "text-muted-foreground"}`} />
            🛡️ درع بوابة المطبخ الذكي
          </p>
          <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
            {kitchenShield
              ? "مفعّل: العتبة ديناميكية حسب توافق المؤشرات (10) + عقوبات الفخاخ والسوق العرضي والتعلم الذاتي والوريد. حد أدنى مطلق 80%."
              : "متوقّف: النظام يعمل بمنطقه الافتراضي."}
          </p>
        </div>
        <button
          onClick={toggleKitchenShield}
          className={`shrink-0 px-3 py-1.5 rounded-md border text-[10px] font-bold transition-all ${
            kitchenShield
              ? "bg-gold text-background border-gold"
              : "bg-secondary text-muted-foreground border-border hover:border-gold/40"
          }`}
        >
          {kitchenShield ? "✓ مفعّل" : "متوقّف"}
        </button>
      </div>

      {/* مضاعفات الصرامة */}
      {kitchenShield && (
        <div className="rounded-lg border border-gold/30 bg-gold/5 p-2.5 space-y-2">
          <button
            onClick={() => setShowShieldAdvanced(v => !v)}
            className="w-full flex items-center justify-between gap-2 text-[11px] font-bold text-foreground"
          >
            <span className="flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5 text-gold" />
              ضبط مضاعفات الصرامة
            </span>
            <span className="text-[10px] text-muted-foreground">
              {showShieldAdvanced ? "إخفاء ▲" : "عرض ▼"}
            </span>
          </button>

          {showShieldAdvanced && (
            <div className="space-y-2.5 pt-1">
              {([
                { key: "trapPenalty",     label: "🪤 عقوبة الفخ",            sign: "+", min: 0, max: 15, hint: "ترفع العتبة عند رصد فخ ناعم" },
                { key: "rangePenalty",    label: "↔️ عقوبة السوق العرضي",     sign: "+", min: 0, max: 15, hint: "ترفع العتبة في الأسواق المتذبذبة" },
                { key: "trendRelief",     label: "📈 تخفيف الترند",           sign: "−", min: 0, max: 10, hint: "تخفّض العتبة عند وجود ترند واضح" },
                { key: "learningPenalty", label: "🧠 عقوبة التعلم الذاتي",    sign: "+", min: 0, max: 15, hint: "ترفع العتبة لأنماط فاشلة سابقاً" },
                { key: "veinPenalty",     label: "🩸 عقوبة الوريد (آخر خسارة)", sign: "+", min: 0, max: 15, hint: "ترفع العتبة بعد صفقة خاسرة" },
              ] as const).map(({ key, label, sign, min, max, hint }) => (
                <div key={key} className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] font-bold text-foreground">{label}</p>
                    <span className="text-[10px] font-bold text-gold tabular-nums">
                      {sign}{shieldMultipliers[key]}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={min}
                    max={max}
                    step={1}
                    value={shieldMultipliers[key]}
                    onChange={(e) => updateMultiplier(key, Number(e.target.value))}
                    className="w-full h-1.5 rounded-full bg-secondary accent-gold cursor-pointer"
                  />
                  <p className="text-[9px] text-muted-foreground leading-tight">{hint}</p>
                </div>
              ))}

              <button
                onClick={resetMultipliers}
                className="w-full mt-1 px-2 py-1.5 rounded-md border border-border bg-secondary text-[10px] font-bold text-muted-foreground hover:text-foreground hover:border-gold/40"
              >
                ↺ استعادة القيم الافتراضية (5/5/2/4/3)
              </button>

              <p className="text-[9px] text-muted-foreground leading-tight pt-1 border-t border-border">
                ⚠️ الحد الأدنى المطلق للعتبة النهائية = 80% مهما كانت القيم.
              </p>
            </div>
          )}
        </div>
      )}

      {/* مدة الصفقة الديناميكية */}
      <div className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-secondary/40 border border-border">
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-bold text-foreground flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-gold" />
            مدة الصفقة الديناميكية (TTL)
          </p>
          <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
            {dynamicTtl
              ? "مفعّل: المدة تتكيف مع تذبذب العملة (ATR) — أسواق هادئة = وقت أطول، متقلبة = أقصر."
              : "متوقّف: مدة ثابتة لكل فريم بصرف النظر عن التذبذب."}
          </p>
        </div>
        <button
          onClick={toggleDynamicTtl}
          className={`shrink-0 px-3 py-1.5 rounded-md border text-[10px] font-bold transition-all ${
            dynamicTtl
              ? "bg-gold text-background border-gold"
              : "bg-secondary text-muted-foreground border-border hover:border-gold/40"
          }`}
        >
          {dynamicTtl ? "✓ مفعّل" : "متوقّف"}
        </button>
      </div>

      {/* درع حساسية كشف فخاخ السيولة */}
      <div className="p-2.5 rounded-lg bg-secondary/40 border border-border space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-bold text-foreground flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-stock-red" />
            🪤 درع حساسية كشف فخاخ السيولة
          </p>
          <span className="text-[10px] font-bold text-stock-red tabular-nums">
            {sweepSensitivity}/{SWEEP_SENS_MAX} {sweepSensitivity >= 4 ? "صارم" : sweepSensitivity <= 2 ? "متساهل" : "متوازن"}
          </span>
        </div>
        <input
          type="range"
          min={SWEEP_SENS_MIN}
          max={SWEEP_SENS_MAX}
          step={1}
          value={sweepSensitivity}
          onChange={e => updateSweepSensitivity(Number(e.target.value))}
          className="w-full h-1.5 rounded-full bg-secondary accent-stock-red cursor-pointer"
        />
        <p className="text-[9px] text-muted-foreground leading-tight">
          1 = يتجاهل أغلب الكسور الوهمية • 5 = يكشف أدق سيولة هندسية ويرفض الإشارة فوراً.
        </p>
      </div>
    </div>
  );
};

export default ShieldsTab;
