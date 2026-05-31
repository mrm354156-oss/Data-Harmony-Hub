// V34 Supreme — Binance Proxy (public + signed)
// Public endpoints: klines, aggTrades, ticker24h, ticker24hAll
// Signed endpoints (require BINANCE_API_KEY + BINANCE_SECRET_KEY env vars):
//   account, openOrders, myTrades
//
// Signed requests use HMAC-SHA256 over the query string with the secret key,
// and send the API key in the X-MBX-APIKEY header. Secrets are never exposed
// to the browser — only the proxy reads them from the environment.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, range, accept, accept-language, cache-control, pragma",
  "Access-Control-Expose-Headers": "content-length, content-type, cache-control, sb-request-id",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
};

const BASES = [
  "https://api.binance.com",
  "https://api1.binance.com",
  "https://api2.binance.com",
  "https://api3.binance.com",
  "https://data-api.binance.vision",
];

// V33 Supreme — only the timeframes the strategy actually uses are allowed.
// (No "1M" — engine never requests monthly candles.)
const STRATEGY_INTERVALS = [
  "1m","3m","5m","15m","30m","1h","2h","4h","6h","8h","12h","1d","3d","1w",
] as const;
type StrategyInterval = typeof STRATEGY_INTERVALS[number];
const VALID_INTERVALS = new Set<string>(STRATEGY_INTERVALS);

// Per-frame max limit guardrail. Higher frames don't need 1000-bar fetches
// from a single client, so we cap them tighter to protect rate-limits.
const MAX_LIMIT_BY_TF: Record<StrategyInterval, number> = {
  "1m": 1000, "3m": 1000, "5m": 1000, "15m": 1000, "30m": 1000,
  "1h": 1000, "2h":  750, "4h":  500, "6h":  500, "8h":  500,
  "12h": 500, "1d":  500, "3d":  365, "1w":  260,
};

function safeSymbol(s: string | null): string | null {
  if (!s) return null;
  // Binance USDT-perp/spot symbols are uppercase alnum, 5–20 chars in practice.
  return /^[A-Z0-9]{2,20}$/.test(s) ? s : null;
}

function safeInterval(s: string | null): StrategyInterval | null {
  if (!s) return null;
  return VALID_INTERVALS.has(s) ? (s as StrategyInterval) : null;
}

function safeInt(raw: string | null, fallback: number, min: number, max: number): number {
  const n = parseInt(raw ?? "", 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

function safeTimestamp(raw: string | null): number | null {
  if (!raw) return null;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return null;
  // Binance accepts ms timestamps. Reject anything before 2017 or > now+1d.
  const MIN = 1_483_228_800_000; // 2017-01-01
  const MAX = Date.now() + 86_400_000;
  if (n < MIN || n > MAX) return null;
  return n;
}

function badRequest(message: string, extra: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ error: "bad_params", message, ...extra }), {
    status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function tryFetch(pathAndQuery: string, extraHeaders: Record<string, string> = {}): Promise<Response> {
  let lastErr: unknown = null;
  for (const base of BASES) {
    try {
      const r = await fetch(base + pathAndQuery, {
        headers: { "User-Agent": "V34-Supreme-Proxy/1.0", ...extraHeaders },
      });
      if (r.ok) return r;
      if (r.status >= 400 && r.status < 500) return r;
      lastErr = `status ${r.status} from ${base}`;
    } catch (e) {
      lastErr = e;
    }
  }
  return new Response(JSON.stringify({ error: "all_mirrors_failed", detail: String(lastErr) }), {
    status: 502, headers: { "Content-Type": "application/json" },
  });
}

// ── Signed-endpoint helpers ──────────────────────────────────────────────
async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function signedFetch(
  endpoint: string,
  extraParams: Record<string, string | number> = {},
): Promise<Response> {
  const apiKey = Deno.env.get("BINANCE_API_KEY");
  const secret = Deno.env.get("BINANCE_SECRET_KEY");
  if (!apiKey || !secret) {
    return new Response(JSON.stringify({
      error: "missing_credentials",
      message: "BINANCE_API_KEY / BINANCE_SECRET_KEY not configured on the server",
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(extraParams)) params.set(k, String(v));
  params.set("recvWindow", "5000");
  params.set("timestamp", String(Date.now()));
  const qs = params.toString();
  const signature = await hmacSha256Hex(secret, qs);
  const fullPath = `${endpoint}?${qs}&signature=${signature}`;
  return tryFetch(fullPath, { "X-MBX-APIKEY": apiKey });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const path = url.searchParams.get("path");

    let upstreamPath = "";
    if (path === "klines") {
      const symbol = safeSymbol(url.searchParams.get("symbol"));
      const interval = safeInterval(url.searchParams.get("interval"));
      if (!symbol) return badRequest("symbol invalid or missing");
      if (!interval) {
        return badRequest("interval not supported by strategy", {
          allowed: STRATEGY_INTERVALS,
        });
      }
      const cap = MAX_LIMIT_BY_TF[interval];
      const limit = safeInt(url.searchParams.get("limit"), 50, 1, cap);
      const startTime = safeTimestamp(url.searchParams.get("startTime"));
      const endTime = safeTimestamp(url.searchParams.get("endTime"));
      if (url.searchParams.get("endTime") && endTime === null) {
        return badRequest("endTime invalid (expected ms timestamp)");
      }
      if (url.searchParams.get("startTime") && startTime === null) {
        return badRequest("startTime invalid (expected ms timestamp)");
      }
      if (startTime !== null && endTime !== null && startTime >= endTime) {
        return badRequest("startTime must be < endTime");
      }
      upstreamPath = `/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
        + (startTime !== null ? `&startTime=${startTime}` : "")
        + (endTime !== null ? `&endTime=${endTime}` : "");
    } else if (path === "aggTrades") {
      const symbol = safeSymbol(url.searchParams.get("symbol"));
      if (!symbol) return badRequest("symbol invalid or missing");
      const limit = safeInt(url.searchParams.get("limit"), 500, 1, 1000);
      const startTime = safeTimestamp(url.searchParams.get("startTime"));
      const endTime = safeTimestamp(url.searchParams.get("endTime"));
      if (url.searchParams.get("startTime") && startTime === null) {
        return badRequest("startTime invalid");
      }
      if (url.searchParams.get("endTime") && endTime === null) {
        return badRequest("endTime invalid");
      }
      // Binance requires startTime/endTime window ≤ 1h
      if (startTime !== null && endTime !== null) {
        if (endTime - startTime > 3_600_000) {
          return badRequest("aggTrades window cannot exceed 1 hour");
        }
      }
      upstreamPath = `/api/v3/aggTrades?symbol=${symbol}&limit=${limit}`
        + (startTime !== null ? `&startTime=${startTime}` : "")
        + (endTime !== null ? `&endTime=${endTime}` : "");
    } else if (path === "ticker24h") {
      const symbol = safeSymbol(url.searchParams.get("symbol"));
      if (!symbol) return badRequest("symbol invalid or missing");
      upstreamPath = `/api/v3/ticker/24hr?symbol=${symbol}`;
    } else if (path === "ticker24hAll") {
      upstreamPath = `/api/v3/ticker/24hr`;
    } else if (path === "account" || path === "openOrders" || path === "myTrades") {
      // Signed endpoints — never cache, never expose secrets in URL to client.
      const extra: Record<string, string | number> = {};
      if (path === "openOrders" || path === "myTrades") {
        const symbol = safeSymbol(url.searchParams.get("symbol"));
        if (path === "myTrades" && !symbol) return badRequest("symbol required for myTrades");
        if (symbol) extra.symbol = symbol;
        if (path === "myTrades") {
          extra.limit = safeInt(url.searchParams.get("limit"), 500, 1, 1000);
        }
      }
      const endpoint = path === "account" ? "/api/v3/account"
        : path === "openOrders" ? "/api/v3/openOrders"
        : "/api/v3/myTrades";
      const signedRes = await signedFetch(endpoint, extra);
      const signedBody = await signedRes.text();
      return new Response(signedBody, {
        status: signedRes.status,
        headers: {
          ...corsHeaders,
          "Content-Type": signedRes.headers.get("content-type") ?? "application/json",
          "Cache-Control": "no-store",
        },
      });
    } else {
      return new Response(JSON.stringify({
        error: "unknown_path",
        allowed: ["klines","aggTrades","ticker24h","ticker24hAll","account","openOrders","myTrades"],
      }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const upstream = await tryFetch(upstreamPath);
    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: {
        ...corsHeaders,
        "Content-Type": upstream.headers.get("content-type") ?? "application/json",
        "Cache-Control": "public, max-age=10",
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
