// V33 Supreme — Memory Garbage Collection
// Periodically purges stale per-symbol memory used by the scan engine
// (flow snapshots, shield arm timestamps, kline & ticker caches) so the
// browser stays snappy even when scanning the full 180-coin universe.

import { logDebug } from "./debugBus";
import { dataCacheStats } from "./binanceDataLayer";

// Active-symbol set: anything currently visible / in-flight stays alive.
// Anything NOT touched in this many ms is considered dormant and may be GC'd.
const ACTIVE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Touch-tracking — call this whenever the scan engine sees a symbol so the GC
// knows it's still active.
const lastSeen = new Map<string, number>();

export function touchSymbol(symbol: string) {
  lastSeen.set(symbol, Date.now());
}

export function getActiveSymbols(): Set<string> {
  const now = Date.now();
  const active = new Set<string>();
  for (const [sym, ts] of lastSeen) {
    if (now - ts < ACTIVE_TTL_MS) active.add(sym);
  }
  return active;
}

// Pluggable cleaners — modules that own per-symbol state register here so the
// GC can reach in and prune dormant entries.
type Cleaner = (active: Set<string>) => number; // returns # entries pruned
const cleaners = new Set<Cleaner>();

export function registerMemoryCleaner(fn: Cleaner): () => void {
  cleaners.add(fn);
  return () => cleaners.delete(fn);
}

export function runMemoryGC() {
  const active = getActiveSymbols();
  // Prune our own touch map first
  let prunedTouches = 0;
  const cutoff = Date.now() - ACTIVE_TTL_MS;
  for (const [sym, ts] of lastSeen) {
    if (ts < cutoff) { lastSeen.delete(sym); prunedTouches++; }
  }
  let pruned = prunedTouches;
  for (const fn of cleaners) {
    try { pruned += fn(active); } catch { /* ignore */ }
  }
  const stats = dataCacheStats();
  logDebug(
    "gc",
    `🧹 GC منتهي • نشط ${active.size} • مُسح ${pruned} • كاش K:${stats.klines} H:${stats.historical} T:${stats.ticker24h}`,
  );
}
