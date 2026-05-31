// Sniper user-tunable settings persisted in localStorage + Supabase (cloud sync).
// V22: Dynamic TTL based on current ATR% / volatility instead of fixed per-timeframe.
// V23: Kitchen-Shield (درع بوابة المطبخ الذكي) — advanced confidence-gate logic.
// V24: Kitchen-Shield strictness multipliers are user-tunable from Settings.
// V40: Cloud-mirrored to public.sniper_settings (one row per user) for cross-device persistence.

import { supabase } from "@/integrations/supabase/client";

const KEY = "sniper_settings_v1";

export interface ShieldMultipliers {
  trapPenalty: number;
  rangePenalty: number;
  trendRelief: number;
  learningPenalty: number;
  veinPenalty: number;
}

export interface SniperSettings {
  dynamicTtl: boolean;
  kitchenShield: boolean;
  shieldMultipliers: ShieldMultipliers;
  scanLimit: number;
  autoFrameAllFrames: boolean;
  sweepSensitivity: number;
}

export const DEFAULT_SHIELD_MULTIPLIERS: ShieldMultipliers = {
  trapPenalty: 5,
  rangePenalty: 5,
  trendRelief: 2,
  learningPenalty: 4,
  veinPenalty: 3,
};

export const SCAN_LIMIT_MIN = 20;
export const SCAN_LIMIT_MAX = 180;
export const SCAN_LIMIT_DEFAULT = 50;
export const SWEEP_SENS_MIN = 1;
export const SWEEP_SENS_MAX = 5;
export const SWEEP_SENS_DEFAULT = 3;

const DEFAULTS: SniperSettings = {
  dynamicTtl: true,
  kitchenShield: true,
  shieldMultipliers: { ...DEFAULT_SHIELD_MULTIPLIERS },
  scanLimit: SCAN_LIMIT_DEFAULT,
  autoFrameAllFrames: false,
  sweepSensitivity: SWEEP_SENS_DEFAULT,
};

export function loadSniperSettings(): SniperSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS, shieldMultipliers: { ...DEFAULT_SHIELD_MULTIPLIERS } };
    const parsed = JSON.parse(raw) as Partial<SniperSettings>;
    return {
      ...DEFAULTS,
      ...parsed,
      shieldMultipliers: { ...DEFAULT_SHIELD_MULTIPLIERS, ...(parsed.shieldMultipliers ?? {}) },
    };
  } catch {
    return { ...DEFAULTS, shieldMultipliers: { ...DEFAULT_SHIELD_MULTIPLIERS } };
  }
}

export function saveSniperSettings(s: Partial<SniperSettings>) {
  const merged: SniperSettings = { ...loadSniperSettings(), ...s,
    shieldMultipliers: { ...DEFAULT_SHIELD_MULTIPLIERS, ...(s.shieldMultipliers ?? loadSniperSettings().shieldMultipliers) },
  };
  try { localStorage.setItem(KEY, JSON.stringify(merged)); } catch { /* ignore */ }
  try { window.dispatchEvent(new CustomEvent("sniper-settings-changed", { detail: merged })); } catch { /* ignore */ }
  setKitchenShieldEnabled(merged.kitchenShield);
  setShieldMultipliers(merged.shieldMultipliers);
  setSweepSensitivity(merged.sweepSensitivity);
  // Cloud sync (fire-and-forget)
  pushToCloud(merged);
}

async function pushToCloud(s: SniperSettings) {
  try {
    const { data: sess } = await supabase.auth.getSession();
    const uid = sess.session?.user.id;
    if (!uid) return;
    await supabase.from("sniper_settings").upsert({
      user_id: uid,
      dynamic_ttl: s.dynamicTtl,
      kitchen_shield: s.kitchenShield,
      shield_multipliers: s.shieldMultipliers as unknown as Record<string, number>,
      scan_limit: s.scanLimit,
      auto_frame_all_frames: s.autoFrameAllFrames,
      sweep_sensitivity: s.sweepSensitivity,
    }, { onConflict: "user_id" });
  } catch { /* offline — cache is the truth */ }
}

/** Pulls cloud settings into localStorage. Call once after auth. */
export async function hydrateSniperSettingsFromCloud(): Promise<void> {
  try {
    const { data: sess } = await supabase.auth.getSession();
    const uid = sess.session?.user.id;
    if (!uid) return;
    const { data, error } = await supabase
      .from("sniper_settings")
      .select("*")
      .eq("user_id", uid)
      .maybeSingle();
    if (error || !data) return;
    const merged: SniperSettings = {
      dynamicTtl: data.dynamic_ttl,
      kitchenShield: data.kitchen_shield,
      shieldMultipliers: { ...DEFAULT_SHIELD_MULTIPLIERS, ...(data.shield_multipliers as object) } as ShieldMultipliers,
      scanLimit: data.scan_limit,
      autoFrameAllFrames: data.auto_frame_all_frames,
      sweepSensitivity: data.sweep_sensitivity,
    };
    try { localStorage.setItem(KEY, JSON.stringify(merged)); } catch { /* ignore */ }
    setKitchenShieldEnabled(merged.kitchenShield);
    setShieldMultipliers(merged.shieldMultipliers);
    setSweepSensitivity(merged.sweepSensitivity);
    try { window.dispatchEvent(new CustomEvent("sniper-settings-changed", { detail: merged })); } catch { /* ignore */ }
  } catch { /* ignore */ }
}

// =================== Engine singletons (read by pure analysis functions) ===================
let _shieldEnabled = false;
export function setKitchenShieldEnabled(v: boolean) { _shieldEnabled = v; }
export function isKitchenShieldEnabled(): boolean { return _shieldEnabled; }

let _lastTradeWasLoss = false;
export function setLastTradeWasLoss(v: boolean) { _lastTradeWasLoss = v; }
export function getLastTradeWasLoss(): boolean { return _lastTradeWasLoss; }

let _shieldMultipliers: ShieldMultipliers = { ...DEFAULT_SHIELD_MULTIPLIERS };
export function setShieldMultipliers(m: ShieldMultipliers) { _shieldMultipliers = { ...m }; }
export function getShieldMultipliers(): ShieldMultipliers { return _shieldMultipliers; }

let _sweepSensitivity = SWEEP_SENS_DEFAULT;
export function setSweepSensitivity(n: number) {
  _sweepSensitivity = Math.max(SWEEP_SENS_MIN, Math.min(SWEEP_SENS_MAX, n | 0));
}
export function getSweepSensitivity(): number { return _sweepSensitivity; }

// Initialize singletons from storage at module load
try {
  const s = loadSniperSettings();
  _shieldEnabled = s.kitchenShield;
  _shieldMultipliers = { ...s.shieldMultipliers };
  _sweepSensitivity = s.sweepSensitivity;
} catch { /* ignore */ }

// Re-hydrate from cloud whenever auth state changes
try {
  supabase.auth.onAuthStateChange((_e, session) => {
    if (session?.user) hydrateSniperSettingsFromCloud();
  });
  // Initial hydrate (in case session already exists at module load)
  hydrateSniperSettingsFromCloud();
} catch { /* ignore */ }
