import { useEffect, useState, useCallback } from "react";
import type { SniperSignal, SniperTimeframe, SniperDirection } from "@/lib/sniperEngine";
import { getLivePriceSnapshot, ensureBinanceStream } from "@/hooks/useBinanceLivePrices";
import { refreshLearningCache } from "@/lib/learningFilter";
import { recordPersistentOutcome } from "@/lib/persistentLearning";
import { loadSniperSettings, setLastTradeWasLoss, getSweepSensitivity } from "@/lib/sniperSettings";
import { subscribeJudgeChanges, decideTradeAdmission } from "@/lib/judgeAuthority";
import { decideShieldAdmission, SHIELD_MIN_RR, type WisdomSource } from "@/lib/kitchenShield";
import { logDebug } from "@/lib/debugBus";
import { trackShadowSignal } from "@/lib/shadowLearning";
import { fetchKlinesCached } from "@/lib/binanceDataLayer";
import {
  incrementTotalSignals, incrementClarityRejected, incrementJudgeRejected,
  incrementShieldRejected, incrementDuplicateRejected, incrementAntiRepeatRejected,
  incrementAdmitted, incrementScanCycle,
} from "@/lib/gateAudit";

export type SniperOutcome = "pending" | "target1" | "target2" | "stopLoss" | "expired" | "emergencyExit" | "stagnation";

export interface LoggedSniperSignal {
  id: string;
  symbol: string;
  baseAsset: string;
  timeframe: SniperTimeframe;
  direction: SniperDirection;
  createdAt: number;
  entry: number;
  target1: number;
  target2: number;
  stopLoss: number;          // dynamic — moves to break-even after T1
  hardStopLoss: number;      // immutable hard 3% stop
  initialStopLoss: number;
  trailingActive: boolean;   // flipped to true once price hits T1 (SL → BE)
  beLocked?: boolean;        // V38 — Stop moved to break-even at 75% to T1
  midLocked?: boolean;       // V38 — Stop moved to mid-point T1↔T2
  partialClosedAt?: number;  // timestamp when 50% was booked at T1
  partialClosePrice?: number;
  confidence: number;
  reasonLines: string[];
  patternLabel: string;
  rsi: number;
  volumeRatio: number;
  netFlowPct: number;
  fearGreed: number | null;
  grade?: "A+" | "A" | "B" | "rejected";
  qualityScore?: number;
  regimeLabel?: string;
  riskReward?: number;
  targetProbability?: number;
  outcome: SniperOutcome;
  resolvedAt?: number;
  resolvedPrice?: number;
  ttlMs: number;
  wisdomSource?: WisdomSource;
  shieldReason?: string;
  forcedLoss?: boolean;      // V38 — closed manually by portfolio deletion
}

const STORAGE_KEY = "sniper_signal_log_v2";
const MAX_LOG = 30;
// Win Rate auto-refresh tick: every 90s force re-evaluation of pending signals
const REFRESH_INTERVAL_MS = 90_000;

// V21: TTL widened ~50% on short TFs — gives price room to reach T1 (now 0.85×ATR).
// Still tight enough that truly dead trades expire instead of rotting indefinitely.
const TF_TTL_MS: Record<SniperTimeframe, number> = {
  "1m": 25 * 60 * 1000,
  "3m": 75 * 60 * 1000,
  "5m": 135 * 60 * 1000,
  "15m": 6 * 60 * 60 * 1000,
  "30m": 10 * 60 * 60 * 1000,
  "1h": 18 * 60 * 60 * 1000,
  "2h": 30 * 60 * 60 * 1000,
  "4h": 3 * 24 * 60 * 60 * 1000,
  "6h": 4 * 24 * 60 * 60 * 1000,
  "8h": 5 * 24 * 60 * 60 * 1000,
  "12h": 6 * 24 * 60 * 60 * 1000,
  "1d": 10 * 24 * 60 * 60 * 1000,
  "3d": 21 * 24 * 60 * 60 * 1000,
  "1w": 45 * 24 * 60 * 60 * 1000,
};

const TRAIL_STEP_PCT = 0.5;
const TRAIL_LOCK_PCT = 0.25;

// V39 — Fee-aware profit lock.
// Binance taker fee ≈ 0.10% per side ⇒ 0.20% round-trip.
// We add a small safety cushion so a "locked" trade exits at NET profit.
const FEE_ROUNDTRIP_PCT = 0.25; // 0.20% fees + 0.05% slippage cushion
function feeSafeBE(entry: number, direction: SniperDirection): number {
  const f = FEE_ROUNDTRIP_PCT / 100;
  return direction === "long" ? entry * (1 + f) : entry * (1 - f);
}

// V39 — Anti-repeat guard.
// Prevents re-entering the same coin at a price level that already lost or
// stagnated recently — the "$1 grinder" leak. A fresh entry is only allowed
// when price has moved meaningfully away from the prior failed level.
const REPEAT_LOOKBACK_MS = 6 * 60 * 60 * 1000; // 6h memory
const REPEAT_PRICE_BAND_PCT = 0.4;             // within ±0.4% = "same level"
function isRepeatedFailedLevel(
  log: LoggedSniperSignal[],
  symbol: string,
  direction: SniperDirection,
  entry: number,
  now: number,
): { blocked: boolean; reason?: string } {
  const band = entry * (REPEAT_PRICE_BAND_PCT / 100);
  for (const l of log) {
    if (l.symbol !== symbol || l.direction !== direction) continue;
    if (!l.resolvedAt || now - l.resolvedAt > REPEAT_LOOKBACK_MS) continue;
    const failed =
      l.outcome === "stopLoss" ||
      l.outcome === "emergencyExit" ||
      l.outcome === "stagnation" ||
      l.outcome === "expired";
    if (!failed) continue;
    // Compare against the prior entry — same level = same trap
    if (Math.abs(l.entry - entry) <= band) {
      const minsAgo = Math.round((now - l.resolvedAt) / 60_000);
      return {
        blocked: true,
        reason: `🚫 نفس المستوى (${l.entry.toFixed(6)}) خسر قبل ${minsAgo}د — ننتظر تحرك سعري حقيقي`,
      };
    }
  }
  return { blocked: false };
}

const REF_ATR_PCT: Record<SniperTimeframe, number> = {
  "1m": 0.30, "3m": 0.42, "5m": 0.55, "15m": 0.85, "30m": 1.10,
  "1h": 1.40, "2h": 1.85, "4h": 2.50, "6h": 2.95, "8h": 3.30,
  "12h": 3.80, "1d": 4.60, "3d": 6.20, "1w": 8.50,
};
function dynamicTtlMs(tf: SniperTimeframe, atrPct: number | undefined): number {
  const base = TF_TTL_MS[tf];
  if (!atrPct || atrPct <= 0) return base;
  const ref = REF_ATR_PCT[tf];
  let mult = ref / atrPct;
  mult = Math.max(0.5, Math.min(2.0, mult));
  return Math.round(base * mult);
}

const TF_MINUTES: Record<SniperTimeframe, number> = {
  "1m": 1, "3m": 3, "5m": 5, "15m": 15, "30m": 30,
  "1h": 60, "2h": 120, "4h": 240, "6h": 360, "8h": 480,
  "12h": 720, "1d": 1440, "3d": 4320, "1w": 10080,
};
const STAGNATION_CANDLES = 5;
const STAGNATION_MIN_PNL_PCT = 0.5;

function load(): LoggedSniperSignal[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as LoggedSniperSignal[];
  } catch { return []; }
}

function save(list: LoggedSniperSignal[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_LOG))); }
  catch { /* ignore */ }
}

function buildReasonLines(s: SniperSignal, judgeNote?: string): string[] {
  const lines: string[] = [];
  const dir = s.direction === "short" ? "🔻 هبوط (Short)" : "🟢 صعود (Long)";
  lines.push(`📍 اتجاه: ${dir}`);
  lines.push(`📊 نموذج شمعي: ${s.patternLabel}`);
  lines.push(`🔥 انفجار فوليوم: ×${s.volumeRatio.toFixed(2)} مقارنة بالمتوسط`);
  lines.push(`🐋 صافي تدفق الحيتان: ${s.netFlowPct >= 0 ? "+" : ""}${s.netFlowPct.toFixed(1)}% (${s.whalesBullish ? (s.direction === "short" ? "بيع غالب" : "شراء غالب") : "ضعيف"})`);
  lines.push(`📈 RSI = ${s.rsi.toFixed(0)} (${s.rsiOk ? "منطقة صحية" : "خارج المنطقة"})`);
  if (s.fearGreed) lines.push(`🧠 الخوف والطمع: ${s.fearGreed.value} (${s.fearGreed.classification})`);
  if (s.direction === "short" && s.supportBreakConfirmed) lines.push(`🩸 تم تأكيد كسر الدعم القوي على فريم ${s.timeframe}`);
  lines.push(`✅ اجتاز ${s.passedCount} فلتر بثقة ${s.confidence}%`);
  lines.push(`⚖️ R:R = 1:${(s.riskReward ?? 0).toFixed(2)} (الحد الأدنى ${SHIELD_MIN_RR})`);
  if (judgeNote) lines.push(`🛡️ ${judgeNote}`);
  if (s.shieldActive) lines.push(`🛡️ المراقب الصامت 120s نشط`);
  return lines;
}

/** Get current flow snapshot for an emergency-exit decision. Stored on the signal at log time. */
function getNetFlowPctNow(symbol: string, currentSignals: SniperSignal[]): number | null {
  const s = currentSignals.find(x => x.symbol === symbol);
  return s ? s.netFlowPct : null;
}

export function useSniperLog(currentSignals: SniperSignal[], timeframe: SniperTimeframe) {
  const [log, setLog] = useState<LoggedSniperSignal[]>(() => load());
  const [refreshTick, setRefreshTick] = useState(0);
  const [settings, setSettings] = useState(() => loadSniperSettings());

  // Ensure WS is open so persisted pending signals can resolve after a browser refresh
  useEffect(() => { ensureBinanceStream(); }, []);

  // Cross-device hydration: on mount, pull existing trades from Supabase and
  // merge them into the local log so the same account sees identical state on
  // any new device. Local entries always win on id collision (we only ADD
  // missing remote rows). Graceful: silent on auth/network failure.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { supabase } = await import("@/integrations/supabase/client");
        const { data: sess } = await supabase.auth.getSession();
        if (!sess.session?.user) return;
        const { data, error } = await supabase
          .from("sniper_trades")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(MAX_LOG);
        if (cancelled || error || !data) return;
        setLog(prev => {
          const seen = new Set(prev.map(l => l.id));
          const remote: LoggedSniperSignal[] = data
            .filter(r => !seen.has(r.signal_id))
            .map(r => ({
              id: r.signal_id,
              symbol: r.symbol,
              baseAsset: r.base_asset,
              timeframe: r.timeframe as SniperTimeframe,
              direction: r.direction as SniperDirection,
              createdAt: new Date(r.created_at as string).getTime(),
              entry: Number(r.entry),
              target1: Number(r.target1),
              target2: Number(r.target2),
              stopLoss: Number(r.stop_loss),
              hardStopLoss: Number(r.hard_stop_loss),
              initialStopLoss: Number(r.stop_loss),
              trailingActive: false,
              confidence: Number(r.confidence ?? 0),
              reasonLines: [],
              patternLabel: r.pattern_label ?? "",
              rsi: Number(r.rsi ?? 0),
              volumeRatio: Number(r.volume_ratio ?? 0),
              netFlowPct: Number(r.net_flow_pct ?? 0),
              fearGreed: r.fear_greed != null ? Number(r.fear_greed) : null,
              grade: (r.quality_grade as LoggedSniperSignal["grade"]) ?? undefined,
              qualityScore: r.quality_score != null ? Number(r.quality_score) : undefined,
              regimeLabel: r.regime_label ?? undefined,
              riskReward: r.risk_reward != null ? Number(r.risk_reward) : undefined,
              targetProbability: r.target_probability != null ? Number(r.target_probability) : undefined,
              outcome: (r.outcome as SniperOutcome) ?? "pending",
              resolvedAt: r.resolved_at ? new Date(r.resolved_at as string).getTime() : undefined,
              resolvedPrice: r.resolved_price != null ? Number(r.resolved_price) : undefined,
              ttlMs: TF_TTL_MS[(r.timeframe as SniperTimeframe)] ?? 0,
            }));
          if (remote.length === 0) return prev;
          const merged = [...prev, ...remote]
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, MAX_LOG);
          save(merged);
          return merged;
        });
      } catch { /* graceful */ }
    })();
    return () => { cancelled = true; };
  }, []);


  // Auto-refresh Win Rate every 90 seconds
  useEffect(() => {
    const id = setInterval(() => setRefreshTick(t => t + 1), REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  // V33 — Re-evaluate when the Judge publishes a new verdict (so previously
  // queued passing signals can be admitted as soon as the judge approves).
  useEffect(() => {
    return subscribeJudgeChanges(() => setRefreshTick(t => t + 1));
  }, []);

  // Listen for settings changes (Dynamic TTL toggle)
  useEffect(() => {
    const onChange = () => setSettings(loadSniperSettings());
    window.addEventListener("sniper-settings-changed", onChange);
    return () => window.removeEventListener("sniper-settings-changed", onChange);
  }, []);

  useEffect(() => {
    setLog(prev => {
      const next = [...prev];
      let changed = false;
      const now = Date.now();

      // 1) Add new passed signals — V33: GATED by Judge Authority + R:R floor + Signal Clarity
      const sweepSens = getSweepSensitivity();
      let cycleTotalSignals = 0;
      for (const s of currentSignals) {
        if (!s.passed || s.suppressed || s.emergencyExit) continue;
        cycleTotalSignals++;

        // V33 Supreme — Signal Clarity: reject candles whose body is dwarfed by
        // wicks (price noise / liquidity sweep). Stricter sensitivity = lower
        // body-ratio floor allowed before we declare the signal "noisy".
        // V41 — softened body-ratio formula (was 0.10 + n*0.10).
        // sensitivity 1 = 10% body, 5 = 30% body required.
        const minBodyRatio = 0.05 + sweepSens * 0.05;
        const lastK = s.lastCandle;
        if (lastK) {
          const range = Math.max(1e-9, lastK.high - lastK.low);
          const body = Math.abs(lastK.close - lastK.open) / range;
          if (body < minBodyRatio) {
            logDebug(
              "clarity",
              `🌫️ ${s.baseAsset} مرفوض — جسم الشمعة ${(body * 100).toFixed(0)}% < الحد ${(minBodyRatio * 100).toFixed(0)}% (ضوضاء سعرية)`,
              { frame: s.timeframe, symbol: s.symbol },
            );
            incrementClarityRejected();
            continue;
          }
        }

        // V33+ — Judge Authority: reject trades the judge says "weak" or "insufficient"
        const judgeDecision = decideTradeAdmission(s.symbol, s.timeframe, s.direction, s.riskReward ?? 0);
        if (!judgeDecision.allowed) {
          if (s.riskReward >= SHIELD_MIN_RR) {
            trackShadowSignal({
              symbol: s.symbol,
              baseAsset: s.baseAsset,
              timeframe: s.timeframe,
              direction: s.direction,
              entry: s.entry,
              target1: s.target1,
              target2: s.target2,
              stopLoss: s.hardStopLoss,
              patternLabel: s.patternLabel,
              regimeLabel: s.regime.label,
              rejectionReason: `القاضي — ${judgeDecision.reason}`,
              confidence: s.confidence,
              riskReward: s.riskReward,
            });
          }
          logDebug(
            "skip",
            `⚖️ ${s.baseAsset} — القاضي يرفض — ${judgeDecision.reason}`,
            { frame: s.timeframe, symbol: s.symbol },
          );
          incrementJudgeRejected();
          continue;
        }

        // V35 — Kitchen Shield is the final authority.
        const decision = decideShieldAdmission(
          s.symbol, s.timeframe, s.direction, s.riskReward ?? 0,
          s.patternLabel, s.regime.label,
        );
        if (!decision.allowed) {
          // V34/V35 — Shadow Learning: even when the Shield rejects, silently
          // track the signal's hypothetical outcome so learning_memory keeps growing.
          if (s.riskReward >= SHIELD_MIN_RR) {
            trackShadowSignal({
              symbol: s.symbol,
              baseAsset: s.baseAsset,
              timeframe: s.timeframe,
              direction: s.direction,
              entry: s.entry,
              target1: s.target1,
              target2: s.target2,
              stopLoss: s.hardStopLoss,
              patternLabel: s.patternLabel,
              regimeLabel: s.regime.label,
              rejectionReason: `${decision.wisdomSource} — ${decision.reason}`,
              confidence: s.confidence,
              riskReward: s.riskReward,
            });
          }
          logDebug(
            "skip",
            `🛡️ ${s.baseAsset} — ${decision.wisdomSource} — ${decision.reason}`,
            { frame: s.timeframe, symbol: s.symbol },
          );
          incrementShieldRejected();
          continue;
        }

        const ttl = settings.dynamicTtl
          ? dynamicTtlMs(s.timeframe, s.atrPct)
          : TF_TTL_MS[s.timeframe];
        const recent = next.find(l =>
          l.symbol === s.symbol &&
          l.timeframe === s.timeframe &&
          l.outcome === "pending" &&
          (now - l.createdAt) < ttl
        );
        if (recent) {
          incrementDuplicateRejected();
          continue;
        }

        // V39 — Anti-repeat: refuse re-entry at a price level that just failed
        const repeat = isRepeatedFailedLevel(next, s.symbol, s.direction, s.entry, now);
        if (repeat.blocked) {
          logDebug("skip", `${repeat.reason} • ${s.baseAsset}`, { frame: s.timeframe, symbol: s.symbol });
          incrementAntiRepeatRejected();
          continue;
        }

        // اجتازت كل الـ Gates
        incrementAdmitted();
        incrementScanCycle();

        next.unshift({
          id: `${s.symbol}|${s.timeframe}|${now}`,
          symbol: s.symbol,
          baseAsset: s.baseAsset,
          timeframe: s.timeframe,
          direction: s.direction,
          createdAt: now,
          entry: s.entry,
          target1: s.target1,
          target2: s.target2,
          stopLoss: s.stopLoss,
          hardStopLoss: s.hardStopLoss,
          initialStopLoss: s.stopLoss,
          trailingActive: false,
          confidence: s.confidence,
          reasonLines: buildReasonLines(s, `${decision.wisdomSource} — ${decision.reason}`),
          patternLabel: s.patternLabel,
          rsi: s.rsi,
          volumeRatio: s.volumeRatio,
          netFlowPct: s.netFlowPct,
          fearGreed: s.fearGreed?.value ?? null,
          grade: s.quality.grade,
          qualityScore: s.quality.total,
          regimeLabel: s.regime.label,
          riskReward: s.riskReward,
          targetProbability: s.quality.targetProbability,
          outcome: "pending",
          wisdomSource: decision.wisdomSource,
          shieldReason: decision.reason,
          ttlMs: ttl,
        });
        changed = true;
      }

      // 2) Resolve pending using LIVE price (WebSocket) when available, falling back to scan price
      for (const l of next) {
        if (l.outcome !== "pending") continue;
        const live = getLivePriceSnapshot(l.symbol);
        const scan = currentSignals.find(s => s.symbol === l.symbol)?.price;
        const price = live ?? scan;
        if (price === undefined || price === null) {
          if (now - l.createdAt > l.ttlMs) {
            l.outcome = "expired"; l.resolvedAt = now; changed = true;
          }
          continue;
        }

        // Direction-aware management with partial T1 close
        if (l.direction === "short") {
          const pnlPct = ((l.entry - price) / l.entry) * 100;
          // Emergency exit BEFORE T1
          if (!l.partialClosedAt && pnlPct <= -1.5) {
            const flowNow = getNetFlowPctNow(l.symbol, currentSignals);
            if (flowNow !== null && flowNow > 40) {
              l.outcome = "emergencyExit"; l.resolvedAt = now; l.resolvedPrice = price; changed = true;
              continue;
            }
          }
          // V41-PRO — Lock-in entry at 50% of the way to T1 (was 75%).
          if (!l.beLocked && !l.partialClosedAt) {
            const dist = l.entry - l.target1; // positive for shorts
            if (dist > 0) {
              const trigger = l.entry - dist * 0.50;
              if (price <= trigger) {
                l.beLocked = true;
                const safeBE = feeSafeBE(l.entry, "short");
                if (l.stopLoss > safeBE) l.stopLoss = safeBE;
                changed = true;
              }
            }
          }
          // T1: book partial 50%, move SL → BE+fees
          if (!l.partialClosedAt && price <= l.target1) {
            l.partialClosedAt = now;
            l.partialClosePrice = l.target1;
            l.trailingActive = true;
            l.stopLoss = feeSafeBE(l.entry, "short");
            changed = true;
          }
          // V38 — After T1, when price reaches midpoint between T1 and T2,
          // raise SL to that midpoint to lock half the second leg.
          if (l.partialClosedAt && !l.midLocked) {
            const midpoint = (l.target1 + l.target2) / 2;
            if (price <= midpoint) {
              l.midLocked = true;
              if (l.stopLoss > midpoint) { l.stopLoss = midpoint; changed = true; }
            }
          }
          // V19: Stepwise trailing AFTER T1 — every 0.5% extra drop, ratchet SL down 0.25%
          if (l.partialClosedAt) {
            const movePastT1Pct = ((l.target1 - price) / l.target1) * 100;
            if (movePastT1Pct > 0) {
              const steps = Math.floor(movePastT1Pct / TRAIL_STEP_PCT);
              const newSL = l.entry * (1 - (steps * TRAIL_LOCK_PCT) / 100);
              // SL only moves DOWN for shorts (tighter)
              if (newSL < l.stopLoss) { l.stopLoss = newSL; changed = true; }
            }
          }
          // After partial: T2 = full win ; SL hit = secured T1 (stepwise locked profit)
          if (price <= l.target2) { l.outcome = "target2"; l.resolvedAt = now; l.resolvedPrice = price; changed = true; }
          else if (price >= l.stopLoss || price >= l.hardStopLoss) {
            l.outcome = l.partialClosedAt ? "target1" : "stopLoss";
            l.resolvedAt = now; l.resolvedPrice = price; changed = true;
          } else if (
            // V29 — Stagnation exit: 5+ candles passed and PnL still under 0.5%
            !l.partialClosedAt &&
            (now - l.createdAt) > STAGNATION_CANDLES * TF_MINUTES[l.timeframe] * 60_000 &&
            pnlPct < STAGNATION_MIN_PNL_PCT
          ) {
            l.outcome = "stagnation"; l.resolvedAt = now; l.resolvedPrice = price; changed = true;
          } else if (now - l.createdAt > l.ttlMs) {
            l.outcome = l.partialClosedAt ? "target1" : "expired";
            l.resolvedAt = now; l.resolvedPrice = price; changed = true;
          }
        } else {
          const pnlPct = ((price - l.entry) / l.entry) * 100;
          if (!l.partialClosedAt && pnlPct <= -1.5) {
            const flowNow = getNetFlowPctNow(l.symbol, currentSignals);
            if (flowNow !== null && flowNow < -40) {
              l.outcome = "emergencyExit"; l.resolvedAt = now; l.resolvedPrice = price; changed = true;
              continue;
            }
          }
          // V41-PRO — Lock-in entry at 50% of the way to T1 (was 75%).
          // Faster BE lock means fewer trades reverse into a loss after
          // almost reaching T1. The cost is occasionally locking BE on
          // a pullback that would have continued to T1, but this is far
          // outweighed by the protection against T1-failures.
          if (!l.beLocked && !l.partialClosedAt) {
            const dist = l.target1 - l.entry;
            if (dist > 0) {
              const trigger = l.entry + dist * 0.50;
              if (price >= trigger) {
                l.beLocked = true;
                const safeBE = feeSafeBE(l.entry, "long");
                if (l.stopLoss < safeBE) l.stopLoss = safeBE;
                changed = true;
              }
            }
          }
          if (!l.partialClosedAt && price >= l.target1) {
            l.partialClosedAt = now;
            l.partialClosePrice = l.target1;
            l.trailingActive = true;
            l.stopLoss = feeSafeBE(l.entry, "long");
            changed = true;
          }
          // V38 — After T1, when price reaches midpoint between T1 and T2,
          // raise SL to that midpoint to lock half the second leg.
          if (l.partialClosedAt && !l.midLocked) {
            const midpoint = (l.target1 + l.target2) / 2;
            if (price >= midpoint) {
              l.midLocked = true;
              if (l.stopLoss < midpoint) { l.stopLoss = midpoint; changed = true; }
            }
          }
          // V19: Stepwise trailing AFTER T1 — every 0.5% extra rise, ratchet SL up 0.25%
          if (l.partialClosedAt) {
            const movePastT1Pct = ((price - l.target1) / l.target1) * 100;
            if (movePastT1Pct > 0) {
              const steps = Math.floor(movePastT1Pct / TRAIL_STEP_PCT);
              const newSL = l.entry * (1 + (steps * TRAIL_LOCK_PCT) / 100);
              // SL only moves UP for longs (tighter)
              if (newSL > l.stopLoss) { l.stopLoss = newSL; changed = true; }
            }
          }
          if (price >= l.target2) { l.outcome = "target2"; l.resolvedAt = now; l.resolvedPrice = price; changed = true; }
          else if (price <= l.stopLoss || price <= l.hardStopLoss) {
            l.outcome = l.partialClosedAt ? "target1" : "stopLoss";
            l.resolvedAt = now; l.resolvedPrice = price; changed = true;
          } else if (
            // V29 — Stagnation exit
            !l.partialClosedAt &&
            (now - l.createdAt) > STAGNATION_CANDLES * TF_MINUTES[l.timeframe] * 60_000 &&
            pnlPct < STAGNATION_MIN_PNL_PCT
          ) {
            l.outcome = "stagnation"; l.resolvedAt = now; l.resolvedPrice = price; changed = true;
          } else if (now - l.createdAt > l.ttlMs) {
            l.outcome = l.partialClosedAt ? "target1" : "expired";
            l.resolvedAt = now; l.resolvedPrice = price; changed = true;
          }
        }
      }

      if (!changed) return prev;
      const trimmed = next.slice(0, MAX_LOG);
      save(trimmed);
      // V20: a trade just resolved → rebuild self-learning bucket cache
      refreshLearningCache();
      // V23 — publish "last resolved trade was a loss" flag for Kitchen-Shield
      const lastResolved = trimmed.find(l => l.outcome !== "pending");
      if (lastResolved) {
        const lost = lastResolved.outcome === "stopLoss" || lastResolved.outcome === "emergencyExit";
        setLastTradeWasLoss(lost);
      }
      // V30 — push every freshly-resolved trade to persistent cloud memory
      // so the bot's experience survives log clears and page refreshes.
      for (const l of trimmed) {
        if (l.resolvedAt && Date.now() - l.resolvedAt < 5_000) {
          void recordPersistentOutcome(
            l.id, l.patternLabel, l.regimeLabel || "—",
            l.direction, l.timeframe, l.outcome,
          );
        }
      }
      return trimmed;
    });
  }, [currentSignals, timeframe, refreshTick, settings.dynamicTtl]);

  const clear = useCallback(() => {
    // 🔴 V44 — حذف متكامل: State + localStorage + backup + Supabase
    setLog([]);
    save([]);
    // حذف backup المرتبط بالسجل
    try { localStorage.removeItem("sniper_signal_log_v2_backup"); } catch { /* ignore */ }
    try { localStorage.removeItem("sniper_learning_backup_v1"); } catch { /* ignore */ }
    // وضع Clear Marker لمنع استعادة السجلات المحذوفة
    try { localStorage.setItem("sniper_clear_marker", Date.now().toString()); } catch { /* ignore */ }
    // حذف fingerprint (اختياري — تنظيف)
    try { localStorage.removeItem("sniper_learning_fingerprints_v1"); } catch { /* ignore */ }
    // حذف جميع سجلات المستخدم من Supabase (إذا كان مسجل دخول)
    import("@/integrations/supabase/client").then(({ supabase }) => {
      // @ts-ignore — getSession متاحة في runtime رغم الخطأ في types
      (supabase.auth.getSession() as Promise<{ data: { session: { user: { id: string } } | null } }>)
        .then(({ data: sess }) => {
          const uid = (sess as unknown as { session: { user: { id: string } } | null })?.session?.user?.id;
          if (uid) {
            supabase.from("sniper_trades").delete().eq("user_id", uid).then(() => { /* graceful */ });
          }
        }).catch(() => { /* graceful */ });
    }).catch(() => { /* graceful */ });
  }, []);

  // V38 — Force-close a pending trade as a loss (called by Portfolio deletion).
  // Unifies portfolio ↔ sniper log ↔ risk stats: removing a trade in the
  // portfolio MUST translate to a Loss everywhere.
  const forceCloseAsLoss = useCallback((id: string) => {
    setLog(prev => {
      const next = prev.map(l => {
        if (l.id !== id || l.outcome !== "pending") return l;
        const live = getLivePriceSnapshot(l.symbol);
        return {
          ...l,
          outcome: "stopLoss" as SniperOutcome,
          resolvedAt: Date.now(),
          resolvedPrice: live ?? l.entry,
          forcedLoss: true,
        };
      });
      save(next);
      return next;
    });
  }, []);

  // V38 — Back-Check: on first mount (or reconnect) scan Binance candles
  // covering the offline window and resolve any pending trade whose
  // target / stop got hit while we were away. Prevents "trapped losses".
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const pendings = log.filter(l => l.outcome === "pending");
      if (pendings.length === 0) return;
      const now = Date.now();
      const updates: Array<{ id: string; outcome: SniperOutcome; price: number; ts: number }> = [];
      for (const l of pendings) {
        // Skip if it was created within the last 90s — live loop will cover it.
        if (now - l.createdAt < 90_000) continue;
        try {
          // 1m candles give the finest replay; cap at 1000 (~16h).
          const candles = await fetchKlinesCached(l.symbol, "1m", 1000);
          if (cancelled || !candles || candles.length === 0) continue;
          // Each candle: [openTime, o, h, l, c, ...]
          let outcome: SniperOutcome | null = null;
          let hitPrice = 0;
          let hitTs = 0;
          let beLocked = l.beLocked;
          let partialClosed = !!l.partialClosedAt;
          let dynamicSL = l.stopLoss;
          for (const k of candles) {
            const ts = Number(k[0]);
            if (ts < l.createdAt) continue;
            if (ts > now) break;
            const high = Number(k[2]);
            const low = Number(k[3]);
            if (l.direction === "long") {
              const safeBE = feeSafeBE(l.entry, "long");
              // V41-PRO parity with live loop: 50% lock-in to BE+fees
              if (!beLocked) {
                const dist = l.target1 - l.entry;
                if (dist > 0 && high >= l.entry + dist * 0.50) {
                  beLocked = true;
                  if (dynamicSL < safeBE) dynamicSL = safeBE;
                }
              }
              // Hard stop hit
              if (low <= l.hardStopLoss || (!partialClosed && low <= dynamicSL)) {
                outcome = "stopLoss"; hitPrice = dynamicSL; hitTs = ts; break;
              }
              // T1 hit → partial book
              if (!partialClosed && high >= l.target1) {
                partialClosed = true;
                dynamicSL = safeBE;
              }
              // After partial, SL hit = secured T1
              if (partialClosed && low <= dynamicSL) {
                outcome = "target1"; hitPrice = dynamicSL; hitTs = ts; break;
              }
              // T2 hit
              if (high >= l.target2) {
                outcome = "target2"; hitPrice = l.target2; hitTs = ts; break;
              }
            } else {
              const safeBE = feeSafeBE(l.entry, "short");
              if (!beLocked) {
                const dist = l.entry - l.target1;
                if (dist > 0 && low <= l.entry - dist * 0.50) {
                  beLocked = true;
                  if (dynamicSL > safeBE) dynamicSL = safeBE;
                }
              }
              if (high >= l.hardStopLoss || (!partialClosed && high >= dynamicSL)) {
                outcome = "stopLoss"; hitPrice = dynamicSL; hitTs = ts; break;
              }
              if (!partialClosed && low <= l.target1) {
                partialClosed = true;
                dynamicSL = safeBE;
              }
              if (partialClosed && high >= dynamicSL) {
                outcome = "target1"; hitPrice = dynamicSL; hitTs = ts; break;
              }
              if (low <= l.target2) {
                outcome = "target2"; hitPrice = l.target2; hitTs = ts; break;
              }
            }
          }
          if (outcome) {
            updates.push({ id: l.id, outcome, price: hitPrice, ts: hitTs });
            logDebug("backcheck", `🔁 ${l.baseAsset} ${l.timeframe} حُسمت أثناء الغياب: ${outcome}`, { symbol: l.symbol });
          }
        } catch { /* ignore — graceful */ }
      }
      if (cancelled || updates.length === 0) return;
      setLog(prev => {
        const map = new Map(updates.map(u => [u.id, u]));
        const next = prev.map(l => {
          const u = map.get(l.id);
          if (!u || l.outcome !== "pending") return l;
          return { ...l, outcome: u.outcome, resolvedAt: u.ts, resolvedPrice: u.price };
        });
        save(next);
        return next;
      });
    })();
    return () => { cancelled = true; };
    // Run once on mount + whenever the user reconnects (online event handled via window).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onOnline = () => setRefreshTick(t => t + 1);
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  const resolved = log.filter(l => l.outcome !== "pending" && l.outcome !== "expired");
  const wins = log.filter(l => l.outcome === "target1" || l.outcome === "target2").length;
  const losses = log.filter(l => l.outcome === "stopLoss" || l.outcome === "emergencyExit").length;
  const winRate = resolved.length > 0 ? Math.round((wins / resolved.length) * 100) : 0;

  return { log, clear, wins, losses, winRate, resolvedCount: resolved.length, forceCloseAsLoss };
}
