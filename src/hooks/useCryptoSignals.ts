import type { CryptoData } from "@/hooks/useCryptoPrices";
import { formatPrice } from "@/lib/formatPrice";

export type CryptoSignal = "buy" | "sell" | "hold";
export type Timeframe = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

export interface CryptoTechnicals {
  rsi: number;              // 0-100 (proxy)
  bbPosition: number;       // 0=lower band, 0.5=mid, 1=upper band
  bbSqueeze: boolean;       // narrow bands → breakout potential
  volumeRatio: number;      // 24h volume / market cap
  volumeStrength: "low" | "normal" | "high" | "extreme";
  trendStrength: number;    // 0-100
  trendDirection: "up" | "down" | "sideways";
  momentum: number;         // weighted recent momentum %
}

export interface CryptoTradePlan {
  timeframe: Timeframe;
  timeframeLabel: string;   // Arabic label
  entry: number;
  target1: number;
  target2: number;
  target3: number;
  stopLoss: number;
  riskReward: number;
}

export interface CryptoWithSignal extends CryptoData {
  signal: CryptoSignal;
  confidence: number;
  reason: string;
  detailedAnalysis: string;
  riskLevel: "low" | "medium" | "high";
  riskScore: number;        // 1-10 (10 = highest risk)
  isGolden: boolean;
  isPerfectEntry: boolean;  // triggers green glow
  goldenLine: string;       // one-line pro summary
  technicals: CryptoTechnicals;
  plan: CryptoTradePlan;
}

function getRiskLevel(crypto: CryptoData): "low" | "medium" | "high" {
  if (crypto.marketCapRank <= 10) return "low";
  if (crypto.marketCapRank <= 30) return "medium";
  return "high";
}

// Risk score 1-10 (10 = highest risk)
function getRiskScore(crypto: CryptoData, tech: CryptoTechnicals): number {
  let score = 0;
  // Market cap rank
  if (crypto.marketCapRank <= 5) score += 1;
  else if (crypto.marketCapRank <= 15) score += 2;
  else if (crypto.marketCapRank <= 30) score += 4;
  else if (crypto.marketCapRank <= 50) score += 6;
  else score += 8;
  // Volatility
  const vol = Math.abs(crypto.priceChangePercent24h);
  if (vol > 15) score += 2;
  else if (vol > 8) score += 1;
  // Liquidity
  if (tech.volumeRatio < 0.02) score += 2;
  else if (tech.volumeRatio < 0.05) score += 1;
  return Math.min(10, Math.max(1, Math.round(score)));
}

// Compute RSI proxy from short/medium/long momentum
function computeTechnicals(crypto: CryptoData): CryptoTechnicals {
  const m1 = crypto.priceChangePercent1h ?? 0;
  const m24 = crypto.priceChangePercent24h ?? 0;
  const m7 = crypto.priceChangePercent7d ?? 0;

  // RSI proxy: blend recent momentum into 0-100. Neutral=50.
  const weighted = m1 * 4 + m24 * 1.5 + m7 * 0.4;
  const rsi = Math.min(95, Math.max(5, 50 + weighted * 1.2));

  // Bollinger position proxy: where current price sits in 24h range
  const range = crypto.high24h - crypto.low24h;
  const bbPosition = range > 0
    ? Math.min(1, Math.max(0, (crypto.currentPrice - crypto.low24h) / range))
    : 0.5;
  // Squeeze: narrow 24h range relative to price → low volatility, breakout setup
  const rangePct = crypto.currentPrice > 0 ? (range / crypto.currentPrice) * 100 : 0;
  const bbSqueeze = rangePct < 3 && Math.abs(m24) < 2;

  // Volume
  const volumeRatio = crypto.marketCap > 0 ? crypto.totalVolume / crypto.marketCap : 0;
  const volumeStrength: CryptoTechnicals["volumeStrength"] =
    volumeRatio > 0.3 ? "extreme" :
    volumeRatio > 0.12 ? "high" :
    volumeRatio > 0.04 ? "normal" : "low";

  // Trend
  const alignment = Math.sign(m1) === Math.sign(m24) && Math.sign(m24) === Math.sign(m7);
  const trendStrength = Math.min(100, Math.round(
    (Math.abs(m24) * 3 + Math.abs(m7) * 1.5 + (alignment ? 25 : 0))
  ));
  const trendDirection: CryptoTechnicals["trendDirection"] =
    m24 > 1.5 && m7 > 0 ? "up" :
    m24 < -1.5 && m7 < 0 ? "down" : "sideways";

  const momentum = m1 * 0.5 + m24 * 0.3 + m7 * 0.2;

  return { rsi, bbPosition, bbSqueeze, volumeRatio, volumeStrength, trendStrength, trendDirection, momentum };
}

// Choose best timeframe based on volatility profile
function pickTimeframe(crypto: CryptoData, tech: CryptoTechnicals): { tf: Timeframe; label: string } {
  const v1 = Math.abs(crypto.priceChangePercent1h);
  const v24 = Math.abs(crypto.priceChangePercent24h);

  if (v1 > 3 && tech.volumeStrength === "extreme") return { tf: "1m", label: "مضاربة دقيقة" };
  if (v1 > 1.5 && (tech.volumeStrength === "high" || tech.volumeStrength === "extreme")) return { tf: "5m", label: "مضاربة 5 دقائق" };
  if (v24 > 6) return { tf: "15m", label: "مضاربة 15 دقيقة" };
  if (v24 > 3) return { tf: "1h", label: "تداول ساعة" };
  if (v24 > 1.5) return { tf: "4h", label: "تداول 4 ساعات" };
  return { tf: "1d", label: "تداول يومي" };
}

// Build entry/targets/SL using ATR-like proxy from 24h range scaled per timeframe
function buildPlan(crypto: CryptoData, tech: CryptoTechnicals, signal: CryptoSignal): CryptoTradePlan {
  const { tf, label } = pickTimeframe(crypto, tech);
  const price = crypto.currentPrice;
  const range = Math.max(crypto.high24h - crypto.low24h, price * 0.005);

  // Scale move size by timeframe
  const tfFactor: Record<Timeframe, number> = {
    "1m": 0.05, "5m": 0.1, "15m": 0.2, "1h": 0.35, "4h": 0.6, "1d": 1.0,
  };
  const move = range * tfFactor[tf];

  const dir = signal === "sell" ? -1 : 1; // hold uses long-bias plan
  const entry = price;
  const t1 = entry + dir * move * 1.0;
  const t2 = entry + dir * move * 1.8;
  const t3 = entry + dir * move * 3.0;
  const stopLoss = entry - dir * move * 1.2;
  const riskReward = +(Math.abs(t2 - entry) / Math.max(0.0001, Math.abs(entry - stopLoss))).toFixed(2);

  return {
    timeframe: tf,
    timeframeLabel: label,
    entry,
    target1: t1,
    target2: t2,
    target3: t3,
    stopLoss,
    riskReward,
  };
}

function getDetailedAnalysis(crypto: CryptoData, score: number, signal: CryptoSignal, tech: CryptoTechnicals): string {
  const parts: string[] = [];
  const athDiscount = Math.abs(crypto.athChangePercent);
  const positionInRange = tech.bbPosition;

  if (crypto.marketCapRank <= 5) {
    parts.push(`${crypto.name} دي من أكبر العملات في السوق (ترتيب #${crypto.marketCapRank}). يعني مش هتلاقيها بتتحرك زي العملات الصغيرة، بس في نفس الوقت أأمن.`);
  } else if (crypto.marketCapRank <= 15) {
    parts.push(`عملة كبيرة ومعروفة (ترتيب #${crypto.marketCapRank}) - ناس كتير بتثق فيها وبتتداول عليها.`);
  } else if (crypto.marketCapRank <= 30) {
    parts.push(`عملة متوسطة الحجم (ترتيب #${crypto.marketCapRank}) - فيها فرص حلوة بس لازم تاخد بالك.`);
  } else {
    parts.push(`عملة صغيرة نسبياً (ترتيب #${crypto.marketCapRank}) - ممكن تكسب فيها كتير بس الخطر أعلى.`);
  }

  // RSI commentary
  if (tech.rsi < 30) parts.push(`📉 مؤشر RSI = ${tech.rsi.toFixed(0)} (تشبع بيع) - تاريخياً ده وقت ارتداد محتمل.`);
  else if (tech.rsi > 70) parts.push(`📈 مؤشر RSI = ${tech.rsi.toFixed(0)} (تشبع شراء) - خد بالك من تصحيح قريب.`);
  else parts.push(`مؤشر RSI = ${tech.rsi.toFixed(0)} - في المنطقة المحايدة.`);

  // Bollinger
  if (tech.bbSqueeze) parts.push(`🎯 الباندز ضيقة جداً (Bollinger Squeeze) - ده غالباً بيسبق حركة قوية.`);
  if (positionInRange < 0.2) parts.push(`السعر في أقل ربع من نطاق 24 ساعة (قرب Lower Band) - دخول أحسن من القمة.`);
  else if (positionInRange > 0.8) parts.push(`السعر قرب Upper Band - خطر تدخل دلوقتي.`);

  // Volume
  if (tech.volumeStrength === "extreme") parts.push(`🔥 حجم تداول جنوني - في حركة كبيرة شغالة دلوقتي.`);
  else if (tech.volumeStrength === "high") parts.push(`حجم التداول عالي - السوق مهتم بالعملة دي.`);
  else if (tech.volumeStrength === "low") parts.push(`⚠️ سيولة ضعيفة - ممكن تلاقي صعوبة في البيع بسعر كويس.`);

  // Trend
  if (tech.trendStrength > 60) parts.push(`قوة الترند = ${tech.trendStrength}/100 (${tech.trendDirection === "up" ? "صاعد بقوة" : tech.trendDirection === "down" ? "هابط بقوة" : "جانبي"}).`);

  if (athDiscount > 60) parts.push(`نازلة ${athDiscount.toFixed(0)}% عن قمتها - فرصة لو المشروع لسه قوي.`);
  else if (athDiscount < 10) parts.push(`قريبة جداً من القمة (${athDiscount.toFixed(0)}% فرق فقط) - حذر.`);

  if (signal === "buy") parts.push(`✅ التحليل بيقول: فرصة شراء. متحطش فلوس مش قادر تخسرها.`);
  else if (signal === "sell") parts.push(`🔴 التحليل بيقول: الأحسن تبيع أو تستنى.`);
  else parts.push(`🟡 التحليل بيقول: استنى - مفيش إشارة واضحة.`);

  return parts.join(" ");
}

export function analyzeCrypto(crypto: CryptoData): CryptoWithSignal {
  const tech = computeTechnicals(crypto);
  let score = 0;
  const reasons: string[] = [];

  // RSI scoring
  if (tech.rsi < 28) { score += 3; reasons.push(`RSI ${tech.rsi.toFixed(0)} تشبع بيع`); }
  else if (tech.rsi < 40) { score += 1; reasons.push(`RSI ${tech.rsi.toFixed(0)} منخفض`); }
  else if (tech.rsi > 75) { score -= 3; reasons.push(`RSI ${tech.rsi.toFixed(0)} تشبع شراء`); }
  else if (tech.rsi > 65) { score -= 1; reasons.push(`RSI ${tech.rsi.toFixed(0)} مرتفع`); }

  // Bollinger position
  if (tech.bbPosition < 0.15) { score += 2; reasons.push("قرب Lower Band"); }
  else if (tech.bbPosition > 0.85) { score -= 2; reasons.push("قرب Upper Band"); }
  if (tech.bbSqueeze) { score += 1; reasons.push("BB Squeeze"); }

  // Volume
  if (tech.volumeStrength === "extreme") { score += 2; reasons.push("سيولة جنونية 🔥"); }
  else if (tech.volumeStrength === "high") { score += 1; reasons.push("سيولة عالية"); }
  else if (tech.volumeStrength === "low") { score -= 1; reasons.push("سيولة ضعيفة"); }

  // Trend
  if (tech.trendDirection === "up" && tech.trendStrength > 50) { score += 2; reasons.push("ترند صاعد قوي"); }
  else if (tech.trendDirection === "down" && tech.trendStrength > 50) { score -= 2; reasons.push("ترند هابط قوي"); }

  // ATH context
  const athDiscount = Math.abs(crypto.athChangePercent);
  if (athDiscount > 60) { score += 2; reasons.push(`خصم ${athDiscount.toFixed(0)}% عن ATH`); }
  else if (athDiscount < 10) { score -= 2; reasons.push("قرب ATH خطر"); }

  // 1h momentum kicker
  if (crypto.priceChangePercent1h > 2) { score += 1; reasons.push("زخم ساعة قوي"); }
  else if (crypto.priceChangePercent1h < -3) { score -= 1; reasons.push("ضغط بيع"); }

  const riskLevel = getRiskLevel(crypto);
  const riskScore = getRiskScore(crypto, tech);

  // === Sniper-grade cumulative confluence (5 mandatory gates) ===
  // Mirrors SniperEngine: every gate must agree before BUY is allowed.
  const gateRsi      = tech.rsi >= 30 && tech.rsi < 65;            // healthy zone, not overbought
  const gateBb       = tech.bbPosition < 0.7;                       // not stretched to upper band
  const gateTrend    = tech.trendDirection !== "down" && tech.trendStrength >= 35;
  const gateVolume   = tech.volumeStrength === "high" || tech.volumeStrength === "extreme";
  const gateRisk     = riskScore <= 7;                              // acceptable risk
  const gatesPassed  = [gateRsi, gateBb, gateTrend, gateVolume, gateRisk].filter(Boolean).length;
  const allGatesPass = gatesPassed === 5;

  let signal: CryptoSignal;
  if (allGatesPass && score >= 3) signal = "buy";
  else if (score <= -3) signal = "sell";
  else signal = "hold";

  const confidence = Math.min(97, Math.max(20, 40 + gatesPassed * 8 + Math.max(0, score) * 3));
  const plan = buildPlan(crypto, tech, signal);

  // Perfect entry now requires ALL 5 gates + strong score
  const isPerfectEntry = allGatesPass && signal === "buy" && score >= 5;

  // Golden requires at least 4 gates + buy
  const isGolden = signal === "buy" && gatesPassed >= 4;

  // Pro one-liner
  const arrow = signal === "buy" ? "دخول" : signal === "sell" ? "خروج" : "ترقب";
  const goldenLine = `${plan.timeframeLabel}: ${gatesPassed}/5 فلاتر • RSI ${tech.rsi.toFixed(0)}، ${arrow} ${signal === "buy" ? "آمن" : signal === "sell" ? "متحفظ" : "مؤجل"}، هدف ${formatPrice(plan.target1)} • وقف ${formatPrice(plan.stopLoss)} • R/R ${plan.riskReward}`;

  // Prepend gate summary to reason
  const gateSummary = `🎯 ${gatesPassed}/5 فلاتر تراكمية`;
  const fullReasons = [gateSummary, ...reasons.slice(0, 4)];

  return {
    ...crypto,
    signal,
    confidence,
    reason: fullReasons.join(" • "),
    detailedAnalysis: getDetailedAnalysis(crypto, score, signal, tech),
    riskLevel,
    riskScore,
    isGolden,
    isPerfectEntry,
    goldenLine,
    technicals: tech,
    plan,
  };
}

export function analyzeCryptos(cryptos: CryptoData[]): CryptoWithSignal[] {
  return cryptos.map(analyzeCrypto).sort((a, b) => {
    if (a.isPerfectEntry && !b.isPerfectEntry) return -1;
    if (!a.isPerfectEntry && b.isPerfectEntry) return 1;
    if (a.isGolden && !b.isGolden) return -1;
    if (!a.isGolden && b.isGolden) return 1;
    return b.confidence - a.confidence;
  });
}
