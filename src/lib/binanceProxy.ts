// V33 Supreme — Binance proxy client
// Routes all Binance public data calls through our edge function to bypass
// CORS / regional blocks that prevent direct browser access to api.binance.com.
//
// Resilience strategy:
//  • Retries transient failures (network drop, 5xx, 429) with exponential
//    backoff + jitter — up to 3 attempts.
//  • Does NOT retry 4xx (bad params) — those are caller bugs, fail fast.
//  • On final failure returns a typed { ok: false, reason } envelope via
//    callSafe(); the strategy keeps running and just skips this symbol.
//  • Per-symbol cooldown: if a symbol fails repeatedly, we short-circuit
//    further calls for 60s to avoid hammering the proxy.

import { logDebug } from "./debugBus";

const SUPABASE_URL = "https://aodzerqrhyjsrbnxqrmk.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFvZHplcnFyaHlqc3Jibnhxcm1rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgyNzE2MDIsImV4cCI6MjA5Mzg0NzYwMn0.sCqlsuIrq5MmGLhNkL1c9lguomydDeqe7Tjdkw86KBs";

const PROXY_BASE = `${SUPABASE_URL}/functions/v1/binance-proxy`;
const ANON = SUPABASE_PUBLISHABLE_KEY;

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 350;       // 350ms → 700ms → 1400ms (+ jitter)
const REQUEST_TIMEOUT_MS = 8_000;
const COOLDOWN_MS = 60_000;
const COOLDOWN_THRESHOLD = 3;    // N consecutive failures before cooldown kicks in

// Per-symbol failure tracker (symbol → { fails, cooldownUntil })
const symbolHealth = new Map<string, { fails: number; cooldownUntil: number }>();

export interface ProxyFailure {
  ok: false;
  reason: "cooldown" | "network" | "timeout" | "bad_request" | "server" | "unknown";
  status?: number;
  attempts: number;
  message: string;
}
export interface ProxySuccess<T> { ok: true; data: T; attempts: number; }
export type ProxyResult<T> = ProxySuccess<T> | ProxyFailure;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const jitter = (ms: number) => ms + Math.floor(Math.random() * (ms * 0.4));

function noteFailure(symbol: string | undefined) {
  if (!symbol) return;
  const cur = symbolHealth.get(symbol) ?? { fails: 0, cooldownUntil: 0 };
  cur.fails += 1;
  if (cur.fails >= COOLDOWN_THRESHOLD) {
    cur.cooldownUntil = Date.now() + COOLDOWN_MS;
    cur.fails = 0;
    logDebug("skip", `🧊 تبريد ${COOLDOWN_MS / 1000}ث على ${symbol} بعد فشل متكرر في البروكسي`, { symbol });
  }
  symbolHealth.set(symbol, cur);
}

function noteSuccess(symbol: string | undefined) {
  if (!symbol) return;
  const cur = symbolHealth.get(symbol);
  if (cur && (cur.fails > 0 || cur.cooldownUntil > 0)) {
    symbolHealth.set(symbol, { fails: 0, cooldownUntil: 0 });
  }
}

function checkCooldown(symbol: string | undefined): number {
  if (!symbol) return 0;
  const cur = symbolHealth.get(symbol);
  if (!cur || cur.cooldownUntil === 0) return 0;
  const left = cur.cooldownUntil - Date.now();
  return left > 0 ? left : 0;
}

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, {
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(t);
  }
}

/**
 * Internal: perform the call with retries. Returns the typed envelope.
 * Symbol is extracted from params for cooldown bookkeeping.
 */
async function callWithRetry<T = unknown>(
  params: Record<string, string | number | undefined>,
): Promise<ProxyResult<T>> {
  const symbol = typeof params.symbol === "string" ? params.symbol : undefined;

  const cdLeft = checkCooldown(symbol);
  if (cdLeft > 0) {
    return {
      ok: false, reason: "cooldown", attempts: 0,
      message: `cooldown ${Math.ceil(cdLeft / 1000)}s for ${symbol ?? "?"}`
    };
  }

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  }
  const url = `${PROXY_BASE}?${qs.toString()}`;

  let lastReason: ProxyFailure["reason"] = "unknown";
  let lastStatus: number | undefined;
  let lastMessage = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const r = await fetchWithTimeout(url, REQUEST_TIMEOUT_MS);
      if (r.ok) {
        const data = await r.json() as T;
        noteSuccess(symbol);
        return { ok: true, data, attempts: attempt };
      }
      lastStatus = r.status;
      // 4xx (except 429) → fail fast, don't retry
      if (r.status >= 400 && r.status < 500 && r.status !== 429) {
        let body = "";
        try { body = await r.text(); } catch {/* ignore */ }
        noteFailure(symbol);
        return {
          ok: false, reason: "bad_request", status: r.status, attempts: attempt,
          message: body.slice(0, 200) || `HTTP ${r.status}`,
        };
      }
      lastReason = r.status === 429 ? "server" : "server";
      lastMessage = `HTTP ${r.status}`;
    } catch (e: unknown) {
      if (e instanceof Error && e.name === "AbortError") {
        lastReason = "timeout";
        lastMessage = `timeout after ${REQUEST_TIMEOUT_MS}ms`;
      } else if (e instanceof Error) {
        lastReason = "network";
        lastMessage = e.message;
      } else {
        lastReason = "network";
        lastMessage = String(e);
      }
    }

    if (attempt < MAX_ATTEMPTS) {
      const delay = jitter(BASE_DELAY_MS * Math.pow(2, attempt - 1));
      await sleep(delay);
    }
  }

  noteFailure(symbol);
  return {
    ok: false, reason: lastReason, status: lastStatus, attempts: MAX_ATTEMPTS,
    message: lastMessage || "all retries failed",
  };
}

/**
 * Legacy throwing API — kept for backward-compat with existing callers.
 * Throws on failure; callers should migrate to *Safe variants below.
 */
async function call(params: Record<string, string | number | undefined>): Promise<unknown> {
  const res = await callWithRetry(params);
  if (res.ok === true) return res.data;
  const fail = res as ProxyFailure;
  throw new Error(`proxy ${fail.reason}${fail.status ? ` ${fail.status}` : ""}: ${fail.message}`);
}

export const binanceProxy = {
  // ── throwing variants (legacy callers) ────────────────────────────────
  klines(symbol: string, interval: string, limit = 50, endTime?: number, startTime?: number) {
    return call({ path: "klines", symbol, interval, limit, endTime, startTime });
  },
  aggTrades(symbol: string, startTime?: number, limit = 1000) {
    return call({ path: "aggTrades", symbol, startTime, limit });
  },
  ticker24h(symbol: string) {
    return call({ path: "ticker24h", symbol });
  },
  ticker24hAll() {
    return call({ path: "ticker24hAll" });
  },

  // ── safe variants — return typed envelope, never throw ────────────────
  // Use these in scan paths so one bad symbol can't kill the whole batch.
  klinesSafe(symbol: string, interval: string, limit = 50, endTime?: number, startTime?: number) {
    return callWithRetry<unknown[]>({ path: "klines", symbol, interval, limit, endTime, startTime });
  },
  aggTradesSafe(symbol: string, startTime?: number, limit = 1000) {
    return callWithRetry<unknown[]>({ path: "aggTrades", symbol, startTime, limit });
  },
  ticker24hSafe(symbol: string) {
    return callWithRetry<unknown>({ path: "ticker24h", symbol });
  },
  ticker24hAllSafe() {
    return callWithRetry<unknown[]>({ path: "ticker24hAll" });
  },

  // ── signed (account-scoped) endpoints — server-side HMAC ──────────────
  accountSafe() {
    return callWithRetry<unknown>({ path: "account" });
  },
  openOrdersSafe(symbol?: string) {
    return callWithRetry<unknown[]>({ path: "openOrders", symbol });
  },
  myTradesSafe(symbol: string, limit = 500) {
    return callWithRetry<unknown[]>({ path: "myTrades", symbol, limit });
  },
};

/** Inspect / reset cooldowns (debug + GC integration). */
export function getProxyHealth() {
  const now = Date.now();
  const cooling: string[] = [];
  for (const [sym, h] of symbolHealth.entries()) {
    if (h.cooldownUntil > now) cooling.push(sym);
  }
  return { tracked: symbolHealth.size, cooling };
}

export function resetProxyHealth(symbol?: string) {
  if (symbol) symbolHealth.delete(symbol);
  else symbolHealth.clear();
}
