// V33 Supreme — Debug Timeline Bus
// Centralized event log used by every layer of the engine to broadcast what
// it's doing. Subscribed to by DebugTimelinePanel for live display.
//
// Categories:
//   scan       — raw scan progress (frame, symbols swept)
//   skip       — why a coin was skipped (clarity, trap, judge, low liquidity…)
//   cooldown   — auto-frame jump cooldown ticks
//   judge      — Smart Judge verdicts (10k deep replay)
//   gc         — garbage collection events (flow/shield memory cleanup)
//   clarity    — Signal Clarity filter (noise-cancellation) outcomes

export type DebugCategory =
  | "scan" | "skip" | "cooldown" | "judge" | "gc" | "clarity" | "info" | "backcheck" | "diagnostic";

export interface DebugEvent {
  id: number;
  ts: number;
  category: DebugCategory;
  frame?: string;
  symbol?: string;
  message: string;
}

const MAX_EVENTS = 250;

let counter = 0;
const events: DebugEvent[] = [];
const listeners = new Set<() => void>();

export function logDebug(
  category: DebugCategory,
  message: string,
  meta?: { frame?: string; symbol?: string },
) {
  counter += 1;
  events.unshift({
    id: counter,
    ts: Date.now(),
    category,
    frame: meta?.frame,
    symbol: meta?.symbol,
    message,
  });
  if (events.length > MAX_EVENTS) events.length = MAX_EVENTS;
  // notify subscribers (microtask to coalesce bursts)
  queueMicrotask(() => listeners.forEach(l => { try { l(); } catch {/* ignore */ } }));
}

export function getDebugEvents(): DebugEvent[] {
  return events;
}

export function clearDebugEvents() {
  events.length = 0;
  listeners.forEach(l => { try { l(); } catch {/* ignore */ } });
}

export function subscribeDebug(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
