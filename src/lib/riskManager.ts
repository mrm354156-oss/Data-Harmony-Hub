// Risk Manager — V1
// Dynamic Position Sizing based on confidence, regime, and R:R
// Integrates with existing learning system

import type { SniperTimeframe, SniperDirection } from "./sniperEngine";
import type { MarketRegime } from "./qualityEngine";
import type { SmartMoneyVerdict } from "./smartMoneyEngine";

export interface RiskAssessment {
  riskPercent: number;        // 0.5% - 2.0%
  positionSize: string;       // "micro" | "small" | "normal" | "large"
  maxConcurrentTrades: number;
  reason: string;
  confidence: number;         // 0-100
  grade: "A+" | "A" | "B+" | "B" | "C";
  // V2 — enhanced fields
  kellyFraction: number;      // Kelly criterion result
  drawdownRisk: number;       // estimated drawdown risk %
  riskPerTrade: number;       // actual risk amount in account %
  positionValue: number;      // recommended position value
}

// V2 — Extended risk parameters for advanced position sizing
export interface AdvancedRiskParams {
  accountBalance: number;
  confidenceScore: number;
  smartMoneyScore: number;
  marketRegime: MarketRegime;
  riskReward: number;
  volatilityAtrPct: number;
  winRate: number;            // historical win rate
  avgWin: number;             // average win %
  avgLoss: number;            // average loss %
  consecutiveLosses: number;  // recent consecutive losses
  maxDrawdownPct: number;     // max drawdown from peak
}

// Base risk per grade
const GRADE_RISK: Record<string, number> = {
  "A+": 2.0,
  "A": 1.5,
  "B+": 1.0,
  "B": 0.75,
  "C": 0.5,
};

// Regime multiplier — V2 enhanced with new regimes
const REGIME_MULTIPLIER: Record<MarketRegime, number> = {
  trend_up: 1.2,
  trend_down: 1.1,
  strong_trend_up: 1.4,
  strong_trend_down: 1.3,
  range: 0.8,
  volatile: 0.9,
  choppy: 0.6,
  squeeze: 1.1,
  low_liquidity: 0.5,
};

// Timeframe multiplier (higher TFs = more conviction needed)
const TF_MULTIPLIER: Record<string, number> = {
  "1m": 0.8, "3m": 0.85, "5m": 0.9, "15m": 0.95, "30m": 1.0,
  "1h": 1.1, "2h": 1.15, "4h": 1.2, "6h": 1.25, "8h": 1.3,
  "12h": 1.35, "1d": 1.4, "3d": 1.5, "1w": 1.6,
};

export function calculateRisk(params: {
  confidence: number;
  qualityScore: number;
  regime: MarketRegime;
  riskReward: number;
  timeframe: string;
  smartMoneyScore: number;
  patternPresent: boolean;
  volumeConfirmed: boolean;
  isRecovery?: boolean; // After a loss, reduce risk
}): RiskAssessment {
  const {
    confidence, qualityScore, regime, riskReward, timeframe,
    smartMoneyScore, patternPresent, volumeConfirmed, isRecovery,
  } = params;

  // 1. Determine base grade from confidence + quality
  const combinedScore = confidence * 0.5 + qualityScore * 0.3 + smartMoneyScore * 0.2;
  let grade: RiskAssessment["grade"] = "C";
  if (combinedScore >= 85) grade = "A+";
  else if (combinedScore >= 75) grade = "A";
  else if (combinedScore >= 65) grade = "B+";
  else if (combinedScore >= 55) grade = "B";

  // 2. Base risk from grade
  let risk = GRADE_RISK[grade];

  // 3. Apply regime multiplier
  risk *= REGIME_MULTIPLIER[regime] || 1.0;

  // 4. Apply timeframe multiplier
  risk *= TF_MULTIPLIER[timeframe] || 1.0;

  // 5. Apply R:R bonus (better R:R = slightly more risk OK)
  if (riskReward >= 2.5) risk *= 1.1;
  else if (riskReward < 1.5) risk *= 0.8;

  // 6. Pattern + Volume bonus
  if (patternPresent && volumeConfirmed) risk *= 1.05;
  else if (!patternPresent && !volumeConfirmed) risk *= 0.7;

  // 7. Recovery mode: reduce risk after losses
  if (isRecovery) risk *= 0.5;

  // 8. Clamp to limits
  risk = Math.max(0.5, Math.min(2.0, risk));

  // Determine position size category
  let positionSize: RiskAssessment["positionSize"] = "normal";
  if (risk >= 1.8) positionSize = "large";
  else if (risk >= 1.2) positionSize = "normal";
  else if (risk >= 0.8) positionSize = "small";
  else positionSize = "micro";

  // Max concurrent trades based on regime
  let maxConcurrentTrades = 3;
  if (regime === "trend_up" || regime === "trend_down") maxConcurrentTrades = 4;
  else if (regime === "choppy" || regime === "volatile") maxConcurrentTrades = 2;

  const reason = buildReason(grade, regime, riskReward, smartMoneyScore, patternPresent);

  // V2 — Calculate additional metrics
  const kelly = kellyFraction(0.55, 1.5, 1.0); // default values
  const drawdownRisk = regime === "volatile" ? 3.0 : regime === "choppy" ? 2.5 : 1.5;

  return {
    riskPercent: +risk.toFixed(2),
    positionSize,
    maxConcurrentTrades,
    reason,
    confidence: Math.round(combinedScore),
    grade,
    kellyFraction: +kelly.toFixed(4),
    drawdownRisk,
    riskPerTrade: +risk.toFixed(2),
    positionValue: 0, // will be calculated when account balance is known
  };
}

// V2 — Advanced position sizing based on multiple factors
export function calculateAdvancedRisk(params: AdvancedRiskParams): RiskAssessment {
  const {
    accountBalance, confidenceScore, smartMoneyScore, marketRegime,
    riskReward, volatilityAtrPct, winRate, avgWin, avgLoss,
    consecutiveLosses, maxDrawdownPct,
  } = params;

  // 1. Kelly Criterion
  const kelly = kellyFraction(winRate, avgWin, avgLoss);

  // 2. Volatility adjustment (higher volatility = smaller position)
  const volAdj = volatilityAtrPct > 2.0 ? 0.6 : volatilityAtrPct > 1.5 ? 0.8 : 1.0;

  // 3. Drawdown adjustment (if drawdown > 10%, reduce risk)
  const ddAdj = maxDrawdownPct > 10 ? 0.5 : maxDrawdownPct > 5 ? 0.75 : 1.0;

  // 4. Consecutive loss adjustment
  const lossAdj = consecutiveLosses >= 3 ? 0.3 : consecutiveLosses >= 2 ? 0.5 : 1.0;

  // 5. Regime adjustment
  const regimeAdj = REGIME_MULTIPLIER[marketRegime] || 1.0;

  // 6. Combined score
  const combinedScore = confidenceScore * 0.4 + smartMoneyScore * 0.3 + (riskReward / 3) * 30;

  // 7. Calculate final risk
  let riskPct = 2.0 * kelly * volAdj * ddAdj * lossAdj * regimeAdj;
  riskPct = Math.max(0.25, Math.min(2.5, riskPct));

  // 8. Grade determination
  let grade: RiskAssessment["grade"] = "C";
  if (combinedScore >= 85) grade = "A+";
  else if (combinedScore >= 75) grade = "A";
  else if (combinedScore >= 65) grade = "B+";
  else if (combinedScore >= 55) grade = "B";

  // 9. Position size
  let positionSize: RiskAssessment["positionSize"] = "normal";
  if (riskPct >= 1.8) positionSize = "large";
  else if (riskPct >= 1.2) positionSize = "normal";
  else if (riskPct >= 0.8) positionSize = "small";
  else positionSize = "micro";

  // 10. Max concurrent trades
  let maxConcurrentTrades = 3;
  if (marketRegime === "strong_trend_up" || marketRegime === "strong_trend_down") maxConcurrentTrades = 5;
  else if (marketRegime === "trend_up" || marketRegime === "trend_down") maxConcurrentTrades = 4;
  else if (marketRegime === "choppy" || marketRegime === "volatile") maxConcurrentTrades = 2;

  const riskAmount = accountBalance * (riskPct / 100);

  return {
    riskPercent: +riskPct.toFixed(2),
    positionSize,
    maxConcurrentTrades,
    reason: `K ${(kelly * 100).toFixed(1)}% × V ${volAdj.toFixed(2)} × D ${ddAdj.toFixed(2)} × L ${lossAdj.toFixed(2)}`,
    confidence: Math.round(combinedScore),
    grade,
    kellyFraction: +kelly.toFixed(4),
    drawdownRisk: maxDrawdownPct,
    riskPerTrade: +riskPct.toFixed(2),
    positionValue: +riskAmount.toFixed(2),
  };
}

function buildReason(
  grade: string, regime: string, rr: number,
  smScore: number, pattern: boolean,
): string {
  const parts: string[] = [];
  parts.push(`الفئة: ${grade}`);
  parts.push(`السوق: ${regime}`);
  if (rr >= 2) parts.push(`R:R ممتاز (${rr.toFixed(1)})`);
  else if (rr < 1.5) parts.push(`R:R ضعيف (${rr.toFixed(1)})`);
  if (smScore >= 50) parts.push("Smart Money مؤكد");
  else if (smScore < 20) parts.push("Smart Money ضعيف");
  if (pattern) parts.push("✓ نموذج شمعي");
  return parts.join(" • ");
}

// Kelly Criterion simplified for position sizing
export function kellyFraction(winRate: number, avgWin: number, avgLoss: number): number {
  if (avgLoss === 0 || winRate === 0) return 0;
  const b = avgWin / avgLoss;
  const kelly = (winRate * b - (1 - winRate)) / b;
  return Math.max(0, Math.min(0.25, kelly)); // Cap at 25%
}

// ── Legacy exports for backward compatibility ──────────────────────
export interface RiskSettings {
  maxRiskPerTrade: number;
  maxConcurrentTrades: number;
  maxDailyLoss: number;
  useDynamicSizing: boolean;
}

const DEFAULT_RISK: RiskSettings = {
  maxRiskPerTrade: 1.0,
  maxConcurrentTrades: 3,
  maxDailyLoss: 5.0,
  useDynamicSizing: true,
};

const RISK_KEY = "sniper.riskSettings";

export function loadRiskSettings(): RiskSettings {
  try {
    const raw = localStorage.getItem(RISK_KEY);
    if (raw) return { ...DEFAULT_RISK, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULT_RISK };
}

export function saveRiskSettings(settings: Partial<RiskSettings>): void {
  try {
    const current = loadRiskSettings();
    localStorage.setItem(RISK_KEY, JSON.stringify({ ...current, ...settings }));
  } catch { /* ignore */ }
}

export function calculatePositionSize(
  accountBalance: number,
  entryPrice: number,
  stopLoss: number,
  riskPercent: number = 1.0,
): number {
  const riskAmount = accountBalance * (riskPercent / 100);
  const riskPerUnit = Math.abs(entryPrice - stopLoss);
  if (riskPerUnit <= 0) return 0;
  return Math.floor(riskAmount / riskPerUnit);
}

export function calculateLeverage(
  entryPrice: number,
  stopLoss: number,
  maxRiskPct: number = 2.0,
): number {
  const riskPerUnit = Math.abs(entryPrice - stopLoss);
  if (riskPerUnit <= 0 || entryPrice <= 0) return 1;
  const riskPctPerUnit = (riskPerUnit / entryPrice) * 100;
  const leverage = maxRiskPct / Math.max(0.1, riskPctPerUnit);
  return Math.min(10, Math.max(1, Math.round(leverage)));
}

export interface DailyStatsSnapshot {
  tradesToday: number;
  wins: number;
  losses: number;
  pnl: number;
  maxDrawdown: number;
  consecutiveLosses: number;
  isBreakerActive: boolean;
}

export function evaluateCircuitBreakers(
  log: Array<{ resolvedAt?: number; outcome?: string; pnl?: number }>,
): DailyStatsSnapshot {
  const now = Date.now();
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const dayMs = dayStart.getTime();

  const todayTrades = log.filter(l => l.resolvedAt && l.resolvedAt >= dayMs);
  const tradesToday = todayTrades.length;
  const wins = todayTrades.filter(l => l.outcome === "target1" || l.outcome === "target2").length;
  const losses = todayTrades.filter(l => l.outcome === "stopLoss" || l.outcome === "emergencyExit").length;
  const pnl = todayTrades.reduce((sum, l) => sum + (l.pnl ?? 0), 0);

  // Consecutive losses (from most recent)
  let consecutiveLosses = 0;
  for (let i = log.length - 1; i >= 0; i--) {
    if (log[i].outcome === "stopLoss" || log[i].outcome === "emergencyExit") consecutiveLosses++;
    else break;
  }

  // Max drawdown today
  let peak = 0;
  let maxDrawdown = 0;
  let running = 0;
  for (const t of todayTrades) {
    running += t.pnl ?? 0;
    peak = Math.max(peak, running);
    maxDrawdown = Math.min(maxDrawdown, running - peak);
  }

  // Breaker activates if: 3+ consecutive losses OR daily loss > 5%
  const isBreakerActive = consecutiveLosses >= 3 || pnl < -5;

  return { tradesToday, wins, losses, pnl, maxDrawdown, consecutiveLosses, isBreakerActive };
}
