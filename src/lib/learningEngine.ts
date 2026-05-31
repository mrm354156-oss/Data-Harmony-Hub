// V41+ — Self-Learning Engine Enhancement
// 
// Wraps the existing learningFilter + persistentLearning with:
// 1. Local JSON backup (in case localStorage gets wiped)
// 2. Smarter deduplication with signal fingerprinting
// 3. Retry queue for failed cloud uploads
// 4. Enhanced streak tracking (win streaks too, not just loss streaks)
// 5. Continuous improvement: if a cloud bucket is stale (>24h without update),
//    we flag it for re-evaluation

import type { SniperDirection, SniperTimeframe } from "./sniperEngine";

// ─── Local Backup ────────────────────────────────────────────────────────────
const BACKUP_KEY = "sniper_learning_backup_v1";
const BACKUP_INTERVAL_MS = 120_000; // backup every 2 minutes

interface BackupEntry {
    id: string;
    pattern: string;
    regime: string;
    direction: SniperDirection;
    timeframe: SniperTimeframe;
    outcome: string;
    ts: number;
}

function loadBackup(): BackupEntry[] {
    try {
        const raw = localStorage.getItem(BACKUP_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch { return []; }
}

function saveBackup(entries: BackupEntry[]) {
    try {
        localStorage.setItem(BACKUP_KEY, JSON.stringify(entries.slice(-200)));
    } catch { /* ignore quota errors */ }
}

/** Call this from Index.tsx: periodically backups local learning data */
export function startLearningBackupRoutine() {
    setInterval(() => {
        try {
            // Backup the current sniper log (resolved trades) so we can rebuild
            // learning buckets even if localStorage gets corrupted
            const raw = localStorage.getItem("sniper_signal_log_v2");
            if (raw) {
                localStorage.setItem("sniper_signal_log_v2_backup", raw);
            }
        } catch { /* graceful */ }
    }, BACKUP_INTERVAL_MS);
}

/** Restore sniper log from backup if primary is missing */
export function restoreLearningFromBackup(): boolean {
    try {
        // V44 — Clear Marker: إذا تم مسح السجل يدوياً، لا نستعيد أي backup
        const clearMarker = localStorage.getItem("sniper_clear_marker");
        if (clearMarker) {
            // clear marker موجود → تم حذف متعمد → لا نستعيد
            return false;
        }

        const primary = localStorage.getItem("sniper_signal_log_v2");
        if (primary && JSON.parse(primary).length > 0) return false; // primary fine

        const backup = localStorage.getItem("sniper_signal_log_v2_backup");
        if (backup) {
            const parsed = JSON.parse(backup);
            if (Array.isArray(parsed) && parsed.length > 0) {
                // V44 — تحقق إضافي: إذا كان backup أقدم من آخر clear marker، لا نستعيد
                const backupKey = "sniper_signal_log_v2_backup_ts";
                const backupTs = localStorage.getItem(backupKey);
                if (clearMarker && backupTs && Number(backupTs) < Number(clearMarker)) {
                    localStorage.removeItem("sniper_signal_log_v2_backup");
                    localStorage.removeItem(backupKey);
                    return false; // backup قديم جداً
                }
                localStorage.setItem("sniper_signal_log_v2", backup);
                return true; // restored
            }
        }
    } catch { /* graceful */ }
    return false;
}

// ─── Retry Queue ────────────────────────────────────────────────────────────
const RETRY_KEY = "sniper_cloud_retry_queue_v1";
const MAX_RETRIES = 5;

interface RetryItem {
    signalId: string;
    pattern: string;
    regime: string;
    direction: SniperDirection;
    timeframe: SniperTimeframe;
    outcome: string;
    attempts: number;
    lastAttempt: number;
}

function loadRetryQueue(): RetryItem[] {
    try {
        const raw = localStorage.getItem(RETRY_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch { return []; }
}

function saveRetryQueue(items: RetryItem[]) {
    try { localStorage.setItem(RETRY_KEY, JSON.stringify(items.slice(-100))); }
    catch { /* ignore */ }
}

/** Add a failed cloud upload to the retry queue */
export function enqueueRetry(
    signalId: string,
    pattern: string,
    regime: string,
    direction: SniperDirection,
    timeframe: SniperTimeframe,
    outcome: string,
) {
    const queue = loadRetryQueue();
    // Avoid duplicate entries
    const exists = queue.find(
        (q) => q.signalId === signalId && q.outcome === outcome,
    );
    if (exists) return;
    queue.push({ signalId, pattern, regime, direction, timeframe, outcome, attempts: 0, lastAttempt: 0 });
    saveRetryQueue(queue);
}

/** V44 — Retry queue معطل: يستخدم Edge Functions التي تتجاوز quota الخطة المجانية.
 *  يتم مسح الـ queue فوراً لمنع استهلاك الـ quota. */
export async function flushRetryQueue(): Promise<number> {
    try { localStorage.removeItem(RETRY_KEY); } catch { /* ignore */ }
    return 0;
}

// ─── Fingerprint (improved deduplication) ────────────────────────────────────
const FINGERPRINT_KEY = "sniper_learning_fingerprints_v1";

function loadFingerprints(): Set<string> {
    try {
        const raw = localStorage.getItem(FINGERPRINT_KEY);
        return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch { return new Set(); }
}

function saveFingerprints(set: Set<string>) {
    try { localStorage.setItem(FINGERPRINT_KEY, JSON.stringify([...set].slice(-1000))); }
    catch { /* ignore */ }
}

/**
 * Generate a strong fingerprint that survives browser refreshes.
 * Based on: symbol + direction + timeframe + approximate price level + outcome
 */
export function createLearningFingerprint(
    symbol: string,
    direction: SniperDirection,
    timeframe: SniperTimeframe,
    entryPrice: number,
    outcome: string,
): string {
    // Round price to 2 decimal places to group similar trades
    const priceBucket = Math.round(entryPrice * 100) / 100;
    return `LF|${symbol}|${timeframe}|${direction}|${priceBucket}|${outcome}`;
}

export function isDuplicateFingerprint(fp: string): boolean {
    const set = loadFingerprints();
    return set.has(fp);
}

export function addFingerprint(fp: string) {
    const set = loadFingerprints();
    set.add(fp);
    saveFingerprints(set);
}

// ─── Win Streak Tracking (complementary to loss streak) ──────────────────────
const STREAK_KEY = "sniper_learning_streak_v1";

interface StreakData {
    wins: number;
    losses: number;
    lastOutcome: "win" | "loss" | null;
}

export function getLearningStreak(): StreakData {
    try {
        const raw = localStorage.getItem(STREAK_KEY);
        return raw ? JSON.parse(raw) : { wins: 0, losses: 0, lastOutcome: null };
    } catch { return { wins: 0, losses: 0, lastOutcome: null }; }
}

export function updateLearningStreak(outcome: string) {
    const isWin = outcome === "target1" || outcome === "target2";
    const isLoss = outcome === "stopLoss" || outcome === "emergencyExit";
    if (!isWin && !isLoss) return;

    const streak = getLearningStreak();
    if (isWin) {
        if (streak.lastOutcome === "win") streak.wins++;
        else { streak.wins = 1; streak.losses = 0; }
        streak.lastOutcome = "win";
    } else {
        if (streak.lastOutcome === "loss") streak.losses++;
        else { streak.losses = 1; streak.wins = 0; }
        streak.lastOutcome = "loss";
    }
    try { localStorage.setItem(STREAK_KEY, JSON.stringify(streak)); }
    catch { /* ignore */ }
}

/**
 * Get confidence multiplier based on current streak.
 * - 3+ consecutive wins: +5% confidence
 * - 3+ consecutive losses: -10% confidence (stronger penalty than reward)
 */
export function getStreakConfidenceMultiplier(): number {
    const streak = getLearningStreak();
    if (streak.losses >= 3) return 0.90;  // -10%: cold streak
    if (streak.wins >= 3) return 1.05;    // +5%: hot streak
    if (streak.losses >= 2) return 0.95;  // -5%: warn
    return 1.0;
}