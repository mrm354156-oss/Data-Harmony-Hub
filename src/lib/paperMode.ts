// Paper Trading Mode — global switch. When enabled, the engine still
// generates and tracks signals but does NOT push trades to Supabase or
// any external broker. The current build never sends real Binance
// orders, so paper mode primarily controls cloud persistence + labelling.

const KEY = "sniper_paper_mode_v1";
const listeners = new Set<(v: boolean) => void>();

let _enabled: boolean = (() => {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
})();

export function isPaperMode(): boolean { return _enabled; }

export function setPaperMode(v: boolean) {
  _enabled = v;
  try { localStorage.setItem(KEY, v ? "1" : "0"); } catch { /* ignore */ }
  listeners.forEach((fn) => { try { fn(v); } catch {/*ignore*/} });
}

export function subscribePaperMode(fn: (v: boolean) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
