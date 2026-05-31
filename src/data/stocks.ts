export type StockSignal = "buy" | "sell" | "hold";
export type VolumeLevel = "ضعيفة" | "متوسطة" | "عالية" | "عالية جداً";
export type BollingerState = "انضغاط" | "انفجار صاعد" | "انفجار هابط" | "عادي";

export interface TechnicalIndicators {
  rsi: number;
  macd: { value: number; signal: number; histogram: number };
  bollingerBands: { upper: number; lower: number; middle: number; state: BollingerState };
  bullPower: number;
}

export interface FundamentalAnalysis {
  peRatio: number;
  earningsGrowth: number;
  fairValue: number;
  discountToFairValue: number;
}

export interface SafetyAnalysis {
  stopLoss: number;
  stopLossPercent: number;
  supportLevel: number;
  resistanceLevel: number;
  pivotPoint: number;
}

export interface BacktestResult {
  similarPatternCount: number;
  successRate: number;
  avgReturn: number;
  confirmed: boolean;
}

export interface SmartLiquidity {
  volumeLevel: VolumeLevel;
  volumeVsAvg: number;
  isFakeBreakout: boolean;
  liquidityWarning: string | null;
}

export interface IndicatorAgreement {
  technical: boolean;
  fundamental: boolean;
  fairValue: boolean;
  allAgree: boolean;
}

export interface Stock {
  id: string;
  nameAr: string;
  symbol: string;
  sector?: string;
  currentPrice: number;
  targetPrice: number;
  signal: StockSignal;
  profitPercent: number;
  timeframe: string;
  confidence: number;
  reason: string;
  volume: string;
  technical: TechnicalIndicators;
  fundamental: FundamentalAnalysis;
  safety?: SafetyAnalysis;
  backtest: BacktestResult;
  liquidity: SmartLiquidity;
  indicators: IndicatorAgreement;
  lastUpdated: string;
}

// No more dummy data - live only
export const egxStocks: Stock[] = [];
