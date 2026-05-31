// Sniper Execution Log — central record of every attempt to open/sync a trade.
// Persists last 100 entries to localStorage and broadcasts changes for the UI.

export type ExecutionStatus = "allowed" | "blocked" | "error" | "paper" | "synced" | "resolved";

export interface ExecutionAttempt {
  id: string;
  ts: number;
  symbol: string;
  baseAsset: string;
  timeframe: string;
  direction: "long" | "short";
  status: ExecutionStatus;
  reason: string;
  binanceResponse?: string; // future: when real Binance orders are wired
  dbCode?: string;
  dbMessage?: string;
}

const KEY = "sniper_execution_log_v1";
const MAX = 100;

let cache: ExecutionAttempt[] = load();
const listeners = new Set<() => void>();

function load(): ExecutionAttempt[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as ExecutionAttempt[]) : [];
  } catch { return []; }
}

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(cache.slice(0, MAX))); } catch { /* ignore */ }
  listeners.forEach((fn) => { try { fn(); } catch {/*ignore*/} });
}

export function logExecution(entry: Omit<ExecutionAttempt, "id" | "ts"> & { id?: string; ts?: number }) {
  const id = entry.id ?? `${entry.symbol}-${entry.status}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
  cache = [{ ...entry, id, ts: entry.ts ?? Date.now() }, ...cache].slice(0, MAX);
  persist();
}

export function getExecutionLog(): ExecutionAttempt[] {
  return cache;
}

export function clearExecutionLog() {
  cache = [];
  persist();
}

export function subscribeExecutionLog(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
