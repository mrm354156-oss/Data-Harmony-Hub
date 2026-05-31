// V4 — Mock Market Data Generator
// Generates realistic crypto market data for testing AI models
// without requiring Binance Proxy connection
// Mimics real market patterns: trends, volatility, whale activity

import type { SniperKline, SniperFlow, SniperRawSymbol, SniperFearGreed, SniperTimeframe } from "@/lib/sniperEngine";

// ─── Top 30 USDT Pairs ─────────────────────────────────────────────────

const TOP_SYMBOLS = [
    "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT",
    "ADAUSDT", "DOGEUSDT", "AVAXUSDT", "DOTUSDT", "LINKUSDT",
    "MATICUSDT", "UNIUSDT", "SHIBUSDT", "LTCUSDT", "ATOMUSDT",
    "ETCUSDT", "XLMUSDT", "FILUSDT", "TRXUSDT", "NEARUSDT",
    "APTUSDT", "ARBUSDT", "OPUSDT", "SUIUSDT", "PEPEUSDT",
    "INJUSDT", "TIAUSDT", "SEIUSDT", "RUNEUSDT", "FETUSDT",
];

// ─── Realistic Price Generator ─────────────────────────────────────────

interface PriceState {
    price: number;
    trend: number;       // 0-1: how strong the trend is
    trendDir: number;    // 1 or -1
    volatility: number;  // 0.001 - 0.05
    phase: number;       // 0-2π: for cyclic patterns
}

function createPriceState(basePrice: number): PriceState {
    return {
        price: basePrice * (1 + (Math.random() - 0.5) * 0.1),
        trend: Math.random() * 0.5,
        trendDir: Math.random() > 0.5 ? 1 : -1,
        volatility: 0.002 + Math.random() * 0.008,
        phase: Math.random() * Math.PI * 2,
    };
}

function nextPrice(state: PriceState): number {
    // Cyclic component
    state.phase += 0.1 + state.trend * 0.2;
    const cyclic = Math.sin(state.phase) * 0.003;

    // Trend component
    const trendMove = state.trend * state.trendDir * 0.001;

    // Random walk with volatility clustering
    const noise = (Math.random() - 0.5) * state.volatility * 2;

    // Mean reversion (subtle)
    const reversion = (1 - state.price / 50000) * 0.0001;

    // Occasional jumps (whale activity)
    const jump = Math.random() < 0.02 ? (Math.random() - 0.5) * state.volatility * 3 : 0;

    // Update volatility (GARCH-like)
    state.volatility = Math.max(0.001, state.volatility * 0.9 + Math.abs(noise) * 0.1);

    // Occasionally flip trend
    if (Math.random() < 0.01) state.trendDir *= -1;
    if (Math.random() < 0.005) state.trend = Math.random() * 0.5;

    const change = cyclic + trendMove + noise + reversion + jump;
    state.price = Math.max(state.price * 0.95, state.price * (1 + change));
    return state.price;
}

function generateKlines(
    basePrice: number,
    count: number,
    symbol: string,
): SniperKline[] {
    const state = createPriceState(basePrice);
    const klines: SniperKline[] = [];
    const now = Date.now();
    const candleMs = 300000; // 5 minutes

    for (let i = count; i > 0; i--) {
        const closeTime = now - i * candleMs;
        const openTime = closeTime - candleMs;
        const close = nextPrice(state);
        const open = close * (1 + (Math.random() - 0.5) * 0.01);
        const high = Math.max(open, close) * (1 + Math.random() * 0.01);
        const low = Math.min(open, close) * (1 - Math.random() * 0.01);
        const volume = 10 + Math.random() * 1000 * (1 + Math.abs(state.trendDir) * 0.5);

        klines.push({ openTime, open, high, low, close, volume, closeTime });
    }

    return klines;
}

function generateFlow(symbol: string): SniperFlow {
    const totalVol = 100000 + Math.random() * 500000;
    const buyRatio = 0.4 + Math.random() * 0.3;
    const buyVol = totalVol * buyRatio;
    const sellVol = totalVol * (1 - buyRatio);

    return {
        buyVol,
        sellVol,
        largeBuy: buyVol * (0.1 + Math.random() * 0.3),
        largeSell: sellVol * (0.1 + Math.random() * 0.3),
        trades: Math.floor(50 + Math.random() * 200),
    };
}

// ─── Base Prices (approximate real prices as of 2026) ──────────────────

const BASE_PRICES: Record<string, number> = {
    BTCUSDT: 65000, ETHUSDT: 3500, BNBUSDT: 600, SOLUSDT: 150,
    XRPUSDT: 0.65, ADAUSDT: 0.55, DOGEUSDT: 0.12, AVAXUSDT: 35,
    DOTUSDT: 7.5, LINKUSDT: 18, MATICUSDT: 0.85, UNIUSDT: 12,
    SHIBUSDT: 0.000025, LTCUSDT: 85, ATOMUSDT: 9.5, ETCUSDT: 28,
    XLMUSDT: 0.12, FILUSDT: 5.5, TRXUSDT: 0.11, NEARUSDT: 5,
    APTUSDT: 12, ARBUSDT: 1.8, OPUSDT: 2.5, SUIUSDT: 1.5,
    PEPEUSDT: 0.000008, INJUSDT: 25, TIAUSDT: 8, SEIUSDT: 0.6,
    RUNEUSDT: 5.5, FETUSDT: 1.2,
};

// ─── Fear & Greed Generator ────────────────────────────────────────────

function generateFearGreed(): SniperFearGreed {
    const value = Math.floor(Math.random() * 100);
    const classification = value >= 80 ? "Extreme Greed"
        : value >= 60 ? "Greed"
            : value >= 40 ? "Neutral"
                : value >= 20 ? "Fear"
                    : "Extreme Fear";
    return { value, classification };
}

// ─── Mock Scan Function ────────────────────────────────────────────────

export interface MockScanResponse {
    timeframe: SniperTimeframe;
    fearGreed: SniperFearGreed | null;
    scannedAt: string;
    symbols: SniperRawSymbol[];
    totalScanned: number;
}

export type MockQualityLevel = "all" | "high_quality" | "low_quality";

/**
 * Generate mock market data for AI model testing
 * @param count Number of symbols to generate (1-20)
 * @param quality Filter by signal quality
 */
export function generateMockScan(
    timeframe: SniperTimeframe = "5m",
    count: number = 10,
    quality: MockQualityLevel = "high_quality",
): MockScanResponse {
    const shuffled = [...TOP_SYMBOLS].sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, Math.min(count, TOP_SYMBOLS.length));
    const klineCount = 50;

    const symbols: SniperRawSymbol[] = selected.map(symbol => {
        const basePrice = BASE_PRICES[symbol] ?? 10;
        const klines = generateKlines(basePrice, klineCount, symbol);
        const flow = generateFlow(symbol);
        const now = Date.now();

        return {
            symbol,
            klines,
            flow,
            prevFlow: generateFlow(symbol),
            shieldStartedAt: now,
            supportBreaking: Math.random() < 0.1,
        };
    });

    return {
        timeframe,
        fearGreed: generateFearGreed(),
        scannedAt: new Date().toISOString(),
        symbols,
        totalScanned: selected.length,
    };
}

/**
 * Check if we're getting real data from Binance Proxy
 * Falls back to mock data if Supabase proxy is unreachable
 */
export function isBinanceProxyAvailable(): Promise<boolean> {
    return fetch(
        "https://aodzerqrhyjsrbnxqrmk.supabase.co/functions/v1/binance-proxy?path=ticker24hAll",
        {
            method: "HEAD",
            headers: {
                "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFvZHplcnFyaHlqc3Jibnhxcm1rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgyNzE2MDIsImV4cCI6MjA5Mzg0NzYwMn0.sCqlsuIrq5MmGLhNkL1c9lguomydDeqe7Tjdkw86KBs",
            },
        },
    )
        .then(r => r.ok)
        .catch(() => false);
}