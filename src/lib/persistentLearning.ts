// V30 — Persistent Learning Memory
// Bridges localStorage learning cache with Supabase `learning_memory` table so that
// the bot's accumulated experience SURVIVES page refresh, log clear, or new device.
//
// Two-layer model:
//   • localStorage = personal session cache (fast, fine-grained)
//   • Supabase     = global accumulated memory (slow, durable, cross-device)
//
// On every resolved trade we push outcome to the cloud table via record_learning_outcome().
// On app start we hydrate a read-only snapshot of cloud buckets into a memory map that
// the engine consults as a fallback when local samples are too few.

import { supabase } from "@/integrations/supabase/client";
import type { SniperDirection, SniperTimeframe } from "./sniperEngine";

export interface CloudBucket {
  bucket_key: string;
  pattern_label: string;
  regime_label: string;
  direction: string;
  timeframe: string;
  wins: number;
  losses: number;
  total: number;
}

let cloudCache = new Map<string, CloudBucket>();
let lastHydrate = 0;
const HYDRATE_TTL_MS = 60_000;
const recentlyRecorded = new Set<string>(); // dedupe within session

function bucketKey(pattern: string, regime: string, direction: SniperDirection, tf: SniperTimeframe): string {
  return `${tf}|${direction}|${regime}|${pattern}`;
}

/** Pull all cloud buckets into memory (called every 60s and on demand). */
export async function hydratePersistentMemory(): Promise<void> {
  const now = Date.now();
  if (now - lastHydrate < HYDRATE_TTL_MS) return;
  lastHydrate = now;
  try {
    const { data, error } = await supabase
      .from("learning_memory")
      .select("bucket_key,pattern_label,regime_label,direction,timeframe,wins,losses,total");
    if (error || !data) return;
    const next = new Map<string, CloudBucket>();
    for (const row of data) next.set(row.bucket_key, row as CloudBucket);
    cloudCache = next;
  } catch { /* network down → keep stale cache */ }
}

/** Synchronous read of a cloud bucket (use after hydrate). */
export function getCloudBucket(
  pattern: string,
  regime: string,
  direction: SniperDirection,
  tf: SniperTimeframe,
): CloudBucket | null {
  return cloudCache.get(bucketKey(pattern, regime, direction, tf)) ?? null;
}

/** Push a resolved outcome to the cloud (idempotent within session via dedupeKey). */
export async function recordPersistentOutcome(
  signalId: string,
  pattern: string,
  regime: string,
  direction: SniperDirection,
  tf: SniperTimeframe,
  outcome: string,
): Promise<void> {
  // Only count terminal outcomes
  const valid = outcome === "target1" || outcome === "target2"
    || outcome === "stopLoss" || outcome === "emergencyExit";
  if (!valid) return;

  const dedupe = `${signalId}|${outcome}`;
  if (recentlyRecorded.has(dedupe)) return;
  recentlyRecorded.add(dedupe);
  // bound the dedupe set
  if (recentlyRecorded.size > 500) {
    const first = recentlyRecorded.values().next().value;
    if (first) recentlyRecorded.delete(first);
  }

  try {
    const key = bucketKey(pattern || "—", regime || "—", direction, tf);
    // V44 — edge function "record_learning_outcome" معطل بسبب quota.
    // يتم التحديث محلياً فقط.
    const existing = cloudCache.get(key);
    const isWin = outcome === "target1" || outcome === "target2";
    cloudCache.set(key, {
      bucket_key: key,
      pattern_label: pattern || "—",
      regime_label: regime || "—",
      direction,
      timeframe: tf,
      wins: (existing?.wins ?? 0) + (isWin ? 1 : 0),
      losses: (existing?.losses ?? 0) + (isWin ? 0 : 1),
      total: (existing?.total ?? 0) + 1,
    });
  } catch { /* ignore */ }
}

export function getAllCloudBuckets(): CloudBucket[] {
  return [...cloudCache.values()].sort((a, b) => b.total - a.total);
}
