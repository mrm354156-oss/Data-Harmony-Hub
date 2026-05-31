// V27 — Trade Sync Hook
// طبقة persistence خفيفة: تحفظ الصفقات في Supabase بدون التأثير على المنطق الحالي.
// - useSniperLog يستمر بالعمل مع localStorage كما هو
// - هذا الـ hook فقط يراقب التغيرات ويحفظها في DB
// - الفشل الشبكي لا يكسر النظام (graceful degradation)

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { LoggedSniperSignal } from "@/hooks/useSniperLog";
import { loadRiskSettings, calculatePositionSize } from "@/lib/riskManager";
import { logExecution } from "@/lib/sniperExecutionLog";
import { isPaperMode } from "@/lib/paperMode";

type DbError = { code?: string; message?: string };
type LooseSniperTradeClient = {
  upsert: (payload: Record<string, unknown>, options?: { onConflict?: string }) => Promise<{ error: DbError | null }>;
};
const sniperTradesDb = supabase.from("sniper_trades") as unknown as LooseSniperTradeClient;

export function useTradeSync(log: LoggedSniperSignal[]) {
  const [userId, setUserId] = useState<string | null>(null);
  const syncedIds = useRef<Set<string>>(new Set());
  const resolvedIds = useRef<Set<string>>(new Set());

  // Track auth state
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUserId(data.session?.user.id ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUserId(session?.user.id ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Sync new + resolved trades
  useEffect(() => {
    if (!userId) return;
    const risk = loadRiskSettings();

    const paper = isPaperMode();

    (async () => {
      for (const t of log) {
        // Insert new trades
        if (!syncedIds.current.has(t.id) && t.outcome === "pending") {
          const { positionUsdt } = calculatePositionSize(
            risk.virtualBalance,
            risk.riskPerTradePct,
            t.entry,
            t.stopLoss,
          );
          const baseLog = {
            symbol: t.symbol, baseAsset: t.baseAsset, timeframe: t.timeframe, direction: t.direction,
          } as const;

          if (paper) {
            syncedIds.current.add(t.id);
            logExecution({ ...baseLog, status: "paper", reason: `وضع المحاكاة: تم تسجيل الإشارة محلياً فقط (حجم افتراضي ${positionUsdt.toFixed(2)} USDT)` });
            continue;
          }

          try {
            const payload = {
              user_id: userId,
              signal_id: t.id,
              symbol: t.symbol,
              base_asset: t.baseAsset,
              quote_asset: "USDT",
              timeframe: t.timeframe,
              direction: t.direction,
              entry: t.entry,
              target1: t.target1,
              target2: t.target2,
              stop_loss: t.stopLoss,
              hard_stop_loss: t.hardStopLoss,
              confidence: t.confidence,
              quality_grade: t.grade ?? null,
              quality_score: t.qualityScore ?? null,
              regime_label: t.regimeLabel ?? null,
              pattern_label: t.patternLabel,
              rsi: t.rsi,
              volume_ratio: t.volumeRatio,
              net_flow_pct: t.netFlowPct,
              fear_greed: t.fearGreed,
              risk_reward: t.riskReward ?? null,
              target_probability: t.targetProbability ?? null,
              position_size_usdt: positionUsdt,
              outcome: "pending",
            };
            const { error } = await sniperTradesDb.upsert(payload, { onConflict: "user_id,signal_id" });
            if (error && error.code === "42703") {
              // Column not found — retry without the offending column(s)
              let fallbackPayload = { ...payload } as Record<string, unknown>;
              const msg = String(error.message).toLowerCase();
              if (msg.includes("quote_asset")) {
                const { quote_asset: _qa, ...rest } = fallbackPayload;
                fallbackPayload = rest;
              }
              if (msg.includes("position_size_usdt")) {
                const { position_size_usdt: _ps, ...rest } = fallbackPayload;
                fallbackPayload = rest;
              }
              const retry = await (supabase.from("sniper_trades") as unknown as LooseSniperTradeClient).upsert(fallbackPayload, { onConflict: "user_id,signal_id" });
              if (!retry.error) {
                syncedIds.current.add(t.id);
                logExecution({ ...baseLog, status: "synced", reason: "تم الحفظ في Supabase (بدون بعض الأعمدة غير الموجودة)" });
              } else {
                logExecution({ ...baseLog, status: "error", reason: "فشل حفظ الصفقة في Supabase", dbCode: retry.error.code, dbMessage: retry.error.message });
              }
              continue;
            }
            if (error && error.code === "42P10") {
              // No unique/exclusion constraint for ON CONFLICT target.
              // Fallback path: update existing row first, else plain insert.
              const exists = await supabase
                .from("sniper_trades")
                .select("id")
                .eq("user_id", userId)
                .eq("signal_id", t.id)
                .maybeSingle();

              if (!exists.error && exists.data?.id) {
                const updateRes = await supabase
                  .from("sniper_trades")
                  .update(payload)
                  .eq("id", exists.data.id);

                if (!updateRes.error) {
                  syncedIds.current.add(t.id);
                  logExecution({ ...baseLog, status: "synced", reason: "تم تحديث الصفقة في Supabase (fallback بدون upsert)" });
                } else {
                  logExecution({ ...baseLog, status: "error", reason: "فشل تحديث الصفقة في Supabase", dbCode: updateRes.error.code, dbMessage: updateRes.error.message });
                }
                continue;
              }

              type InsertResult = { data?: unknown; error?: DbError | null };
              const insertRes = await (supabase.from("sniper_trades") as unknown as { insert: (value: Record<string, unknown>) => Promise<InsertResult> }).insert(payload);
              if (!insertRes.error) {
                syncedIds.current.add(t.id);
                logExecution({ ...baseLog, status: "synced", reason: "تم حفظ الصفقة في Supabase (fallback insert بدون upsert)" });
              } else {
                logExecution({ ...baseLog, status: "error", reason: "فشل حفظ الصفقة في Supabase", dbCode: insertRes.error.code, dbMessage: insertRes.error.message });
              }
              continue;
            }
            if (!error) {
              syncedIds.current.add(t.id);
              logExecution({ ...baseLog, status: "synced", reason: `تم حفظ الصفقة (حجم ${positionUsdt.toFixed(2)} USDT)` });
            } else {
              const blocked = error.code === "42501" || String(error.message).toLowerCase().includes("row-level security");
              logExecution({
                ...baseLog,
                status: blocked ? "blocked" : "error",
                reason: blocked ? "سياسة RLS منعت كتابة الصفقة" : "فشل حفظ الصفقة في Supabase",
                dbCode: error.code, dbMessage: error.message,
              });
            }
          } catch (err) {
            logExecution({ ...baseLog, status: "error", reason: err instanceof Error ? err.message : "خطأ غير متوقع أثناء الحفظ" });
          }
        }

        // Update resolved trades
        if (t.outcome !== "pending" && !resolvedIds.current.has(t.id)) {
          const pnlPct = t.resolvedPrice
            ? t.direction === "long"
              ? ((t.resolvedPrice - t.entry) / t.entry) * 100
              : ((t.entry - t.resolvedPrice) / t.entry) * 100
            : 0;
          if (paper) {
            resolvedIds.current.add(t.id);
            logExecution({
              symbol: t.symbol, baseAsset: t.baseAsset, timeframe: t.timeframe, direction: t.direction,
              status: "resolved", reason: `محاكاة: أُغلقت بنتيجة ${t.outcome} (${pnlPct.toFixed(2)}%)`,
            });
            continue;
          }
          try {
            const updatePayload: Record<string, unknown> = {
              outcome: t.outcome,
              resolved_at: t.resolvedAt ? new Date(t.resolvedAt).toISOString() : new Date().toISOString(),
              resolved_price: t.resolvedPrice ?? null,
              pnl_pct: pnlPct,
            };
            let { error } = await supabase
              .from("sniper_trades")
              .update(updatePayload)
              .eq("user_id", userId)
              .eq("signal_id", t.id);
            // Retry without resolved_price if column doesn't exist
            if (error && error.code === "42703" && String(error.message).toLowerCase().includes("resolved_price")) {
              const { resolved_price: _rp, ...rest } = updatePayload;
              type UpdateResult = { error?: DbError | null };
              const retryResult = await (supabase.from("sniper_trades") as unknown as { update: (value: Record<string, unknown>) => Promise<UpdateResult>; eq: (column: string, value: unknown) => unknown })
                .update(rest)
                .eq("user_id", userId)
                .eq("signal_id", t.id) as UpdateResult;
              error = retryResult.error;
            }
            if (!error) {
              resolvedIds.current.add(t.id);
              logExecution({
                symbol: t.symbol, baseAsset: t.baseAsset, timeframe: t.timeframe, direction: t.direction,
                status: "resolved", reason: `أُغلقت بنتيجة ${t.outcome} (${pnlPct.toFixed(2)}%)`,
              });
              // Update daily stats
              const isWin = t.outcome === "target1" || t.outcome === "target2";
              const isLoss = t.outcome === "stopLoss" || t.outcome === "emergencyExit";
              if (isWin || isLoss) {
                await updateDailyStat(userId, isWin, isLoss, pnlPct, risk.virtualBalance);
              }
            } else {
              logExecution({
                symbol: t.symbol, baseAsset: t.baseAsset, timeframe: t.timeframe, direction: t.direction,
                status: "error", reason: "فشل تحديث نتيجة الصفقة",
                dbCode: error.code, dbMessage: error.message,
              });
            }
          } catch (err) {
            logExecution({
              symbol: t.symbol, baseAsset: t.baseAsset, timeframe: t.timeframe, direction: t.direction,
              status: "error", reason: err instanceof Error ? err.message : "خطأ في التحديث",
            });
          }
        }
      }
    })();
  }, [log, userId]);

  return { userId, isAuthed: !!userId };
}

async function updateDailyStat(
  userId: string,
  isWin: boolean,
  isLoss: boolean,
  pnlPct: number,
  balance: number,
) {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const pnlUsdt = (balance * pnlPct) / 100;
  try {
    // Read existing
    const { data: existing } = await supabase
      .from("daily_stats")
      .select("*")
      .eq("user_id", userId)
      .eq("day", today)
      .maybeSingle();

    if (existing) {
      await supabase
        .from("daily_stats")
        .update({
          trades_count: (existing.trades_count ?? 0) + 1,
          wins_count: (existing.wins_count ?? 0) + (isWin ? 1 : 0),
          losses_count: (existing.losses_count ?? 0) + (isLoss ? 1 : 0),
          pnl_usdt: Number(existing.pnl_usdt ?? 0) + pnlUsdt,
          pnl_pct: Number(existing.pnl_pct ?? 0) + pnlPct,
        })
        .eq("id", existing.id);
    } else {
      await supabase.from("daily_stats").insert({
        user_id: userId,
        day: today,
        trades_count: 1,
        wins_count: isWin ? 1 : 0,
        losses_count: isLoss ? 1 : 0,
        pnl_usdt: pnlUsdt,
        pnl_pct: pnlPct,
      });
    }
  } catch { /* ignore */ }
}
