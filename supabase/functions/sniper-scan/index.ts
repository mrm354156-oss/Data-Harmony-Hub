// Sniper Protocol scanner: Binance klines + aggTrades + Fear&Greed
// Public endpoints, no API key required.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, range, accept, accept-language, cache-control, pragma",
};

const SYMBOLS = [
  // Tier 1 — top 30 majors
  "BTCUSDT", "ETHUSDT", "BNBUSDT", "XRPUSDT", "SOLUSDT",
  "ADAUSDT", "DOGEUSDT", "TRXUSDT", "AVAXUSDT", "LINKUSDT",
  "DOTUSDT", "UNIUSDT", "LTCUSDT", "PEPEUSDT", "SHIBUSDT",
  "NEARUSDT", "APTUSDT", "SUIUSDT", "ARBUSDT", "OPUSDT",
  "ATOMUSDT", "ICPUSDT", "FILUSDT", "HBARUSDT", "AAVEUSDT",
  "INJUSDT", "RNDRUSDT", "GRTUSDT", "ALGOUSDT", "FLOWUSDT",
  // Tier 2 — additional 30 alts
  "XLMUSDT", "VETUSDT", "MKRUSDT", "SANDUSDT", "MANAUSDT",
  "AXSUSDT", "FTMUSDT", "EGLDUSDT", "XTZUSDT", "THETAUSDT",
  "EOSUSDT", "KAVAUSDT", "CHZUSDT", "ZILUSDT", "ENJUSDT",
  "1INCHUSDT", "CRVUSDT", "SNXUSDT", "COMPUSDT", "BATUSDT",
  "DASHUSDT", "ZECUSDT", "ETCUSDT", "XMRUSDT", "BCHUSDT",
  "STXUSDT", "IMXUSDT", "LDOUSDT", "DYDXUSDT", "GMXUSDT",
];

const VALID_TFS = new Set(["1m", "5m", "15m", "1h", "4h"]);

function parseKlines(raw: any[]) {
  return raw.map((k: any) => ({
    openTime: k[0], open: +k[1], high: +k[2], low: +k[3],
    close: +k[4], volume: +k[5], closeTime: k[6],
  }));
}

async function fetchKlines(symbol: string, tf: string, limit: number) {
  try {
    const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${tf}&limit=${limit}`);
    if (!r.ok) return null;
    return parseKlines(await r.json());
  } catch { return null; }
}

async function fetchNetFlow(symbol: string) {
  try {
    const startTime = Date.now() - 5 * 60 * 1000;
    const r = await fetch(`https://api.binance.com/api/v3/aggTrades?symbol=${symbol}&startTime=${startTime}&limit=1000`);
    if (!r.ok) return null;
    const trades = await r.json();
    let buyVol = 0, sellVol = 0, largeBuy = 0, largeSell = 0;
    for (const t of trades) {
      const notional = +t.p * +t.q;
      if (t.m) { sellVol += notional; if (notional > 50000) largeSell += notional; }
      else { buyVol += notional; if (notional > 50000) largeBuy += notional; }
    }
    return { buyVol, sellVol, largeBuy, largeSell, trades: trades.length };
  } catch { return null; }
}

let cachedFng: { value: number; classification: string; ts: number } | null = null;
async function fetchFearGreed() {
  const now = Date.now();
  if (cachedFng && now - cachedFng.ts < 10 * 60 * 1000) return cachedFng;
  try {
    const r = await fetch("https://api.alternative.me/fng/?limit=1");
    if (!r.ok) return null;
    const j = await r.json();
    const d = j?.data?.[0];
    if (!d) return null;
    cachedFng = { value: +d.value, classification: d.value_classification, ts: now };
    return cachedFng;
  } catch { return null; }
}

const flowMemory = new Map();
const shieldMemory = new Map();

Deno.serve(async (req) => {
  console.log("[sniper-scan] request", req.method);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    let timeframe = url.searchParams.get("tf") || "5m";
    if (!VALID_TFS.has(timeframe)) timeframe = "5m";

    const fng = await fetchFearGreed();

    const results = await Promise.all(SYMBOLS.map(async (sym) => {
      const [klines, flow] = await Promise.all([
        fetchKlines(sym, timeframe, 50),
        fetchNetFlow(sym),
      ]);
      if (!klines || klines.length < 25) return null;

      const mem = flowMemory.get(sym);
      const now = Date.now();
      const prevFlow = mem && now - mem.prevTs >= 30000 && now - mem.prevTs <= 180000
        ? mem.prevFlow : null;

      if (!mem || now - mem.prevTs > 60000) {
        flowMemory.set(sym, { prevFlow: flow, prevTs: now });
      }

      const shieldKey = `${sym}|${timeframe}`;
      let shieldStartedAt = shieldMemory.get(shieldKey);
      if (!shieldStartedAt || now - shieldStartedAt > 120000) {
        shieldStartedAt = now;
        shieldMemory.set(shieldKey, shieldStartedAt);
      }

      return { symbol: sym, klines, flow, prevFlow, shieldStartedAt };
    }));

    const payload = results.filter(Boolean);

    return new Response(
      JSON.stringify({
        timeframe,
        fearGreed: fng,
        scannedAt: new Date().toISOString(),
        symbols: payload,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("sniper-scan error", e);
    return new Response(JSON.stringify({ error: (e as Error).message, symbols: [] }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
