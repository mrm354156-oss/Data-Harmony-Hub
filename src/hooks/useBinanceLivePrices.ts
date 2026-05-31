import { useEffect, useRef, useSyncExternalStore } from "react";

/**
 * Binance Live Price Stream (WebSocket)
 * - Endpoint: wss://stream.binance.com:9443/ws/!ticker@arr
 * - Updates a global price map in real-time (~every Binance tick)
 * - Components throttle reads to 500ms via useSyncExternalStore + interval re-subscribe
 * - Auto-reconnect with backoff (<1s for first attempt)
 */

type PriceMap = Record<string, number>;

const priceMap: PriceMap = {};
const listeners = new Set<() => void>();

let ws: WebSocket | null = null;
let connecting = false;
let pendingFlush = false;
let reconnectAttempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleFlush() {
  if (pendingFlush) return;
  pendingFlush = true;
  // Coalesce notifications to ~every 500ms — avoids React render thrash
  setTimeout(() => {
    pendingFlush = false;
    listeners.forEach(l => l());
  }, 500);
}

function connect() {
  if (connecting || (ws && ws.readyState === WebSocket.OPEN)) return;
  connecting = true;

  try {
    ws = new WebSocket("wss://stream.binance.com:9443/ws/!ticker@arr");
  } catch {
    connecting = false;
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    connecting = false;
    reconnectAttempts = 0;
  };

  ws.onmessage = (ev) => {
    try {
      const arr = JSON.parse(ev.data) as Array<{ s: string; c: string }>;
      if (!Array.isArray(arr)) return;
      for (const t of arr) {
        const p = +t.c;
        if (p > 0) priceMap[t.s] = p;
      }
      scheduleFlush();
    } catch { /* ignore parse errors */ }
  };

  const onClose = () => {
    connecting = false;
    ws = null;
    scheduleReconnect();
  };
  ws.onclose = onClose;
  ws.onerror = () => { try { ws?.close(); } catch { /* noop */ } };
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  // First retry < 1s, then backoff up to 10s
  const delay = Math.min(800 * Math.pow(1.6, reconnectAttempts), 10_000);
  reconnectAttempts++;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  if (!ws && !connecting) connect();
  return () => {
    listeners.delete(cb);
  };
}

/** Get live price for a Binance symbol (e.g. "BTCUSDT"). Returns null if not yet streamed. */
export function useBinanceLivePrice(symbol: string | undefined): number | null {
  const lastSymbol = useRef(symbol);
  lastSymbol.current = symbol;

  return useSyncExternalStore(
    subscribe,
    () => (symbol ? priceMap[symbol] ?? null : null),
    () => null,
  );
}

/** Eagerly start the stream (e.g. mount once at app root). */
export function ensureBinanceStream() {
  if (typeof window !== "undefined" && !ws && !connecting) connect();
}

/** Read latest snapshot without subscribing (for one-off calculations). */
export function getLivePriceSnapshot(symbol: string): number | null {
  return priceMap[symbol] ?? null;
}

/** Health probe for the Binance WebSocket — used by the Connection Status panel. */
export function getBinanceStreamStatus(): { open: boolean; readyState: number } {
  return {
    open: !!ws && ws.readyState === WebSocket.OPEN,
    readyState: ws ? ws.readyState : -1,
  };
}
