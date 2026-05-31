import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { SniperRawSymbol, SniperFearGreed, SniperTimeframe, SniperKline, SniperFlow } from "@/lib/sniperEngine";
import { loadSniperSettings, SCAN_LIMIT_DEFAULT } from "@/lib/sniperSettings";
import { logDebug } from "@/lib/debugBus";
import { touchSymbol, registerMemoryCleaner } from "@/lib/memoryGC";
import { generateMockScan } from "@/lib/mockMarketData";

// Per-symbol memory (browser-side): rolling flow snapshot + shield arm timestamp
const flowMemory = new Map<string, { prevFlow: SniperFlow | null; prevTs: number }>();
const shieldMemory = new Map<string, number>(); // `${symbol}|${tf}` → armedAt
let cachedFng: { value: number; classification: string; ts: number } | null = null;
const lastGoodScan = new Map<SniperTimeframe, SniperScanResponse>();

// V33 Supreme — Garbage Collection: prune flow + shield memory for dormant symbols.
registerMemoryCleaner((active) => {
  let pruned = 0;
  for (const sym of flowMemory.keys()) {
    if (!active.has(sym)) { flowMemory.delete(sym); pruned++; }
  }
  for (const key of shieldMemory.keys()) {
    const sym = key.split("|")[0];
    if (!active.has(sym)) { shieldMemory.delete(key); pruned++; }
  }
  return pruned;
});

async function fetchFearGreed(): Promise<SniperFearGreed | null> {
  const now = Date.now();
  // V39 — Refresh F&G every 2 minutes (was 10) to stay aligned with the
  // value shown on Binance/CoinMarketCap which both pull from alternative.me.
  if (cachedFng && now - cachedFng.ts < 2 * 60 * 1000) {
    return { value: cachedFng.value, classification: cachedFng.classification };
  }
  try {
    const r = await fetch(`https://api.alternative.me/fng/?limit=1&_=${Math.floor(now / 60000)}`);
    if (!r.ok) return null;
    const j = await r.json();
    const d = j?.data?.[0];
    if (!d) return null;
    cachedFng = { value: +d.value, classification: d.value_classification, ts: now };
    return { value: cachedFng.value, classification: cachedFng.classification };
  } catch { return null; }
}

export interface SniperScanResponse {
  timeframe: SniperTimeframe;
  fearGreed: SniperFearGreed | null;
  scannedAt: string;
  symbols: SniperRawSymbol[];
  totalScanned: number;
}

async function scanClientSide(
  timeframe: SniperTimeframe,
  scanLimit: number,
  onProgress?: (done: number, total: number) => void,
): Promise<SniperScanResponse> {
  const fng = await fetchFearGreed();
  onProgress?.(0, scanLimit);
  logDebug("scan", `🚀 بدء مسح ${scanLimit} عملة على فريم ${timeframe} • بيانات محاكاة (بدون Edge Functions)`, { frame: timeframe });

  // V44 — استخدام mock data بدلاً من binanceProxy (Edge Functions تستنزف quota)
  const mockResult = generateMockScan(timeframe, scanLimit, "all");
  const symbols = mockResult.symbols.map((s, i) => {
    const now = Date.now();
    const sym = s.symbol;
    touchSymbol(sym);
    const shieldKey = `${sym}|${timeframe}`;
    let shieldStartedAt = shieldMemory.get(shieldKey);
    if (!shieldStartedAt || now - shieldStartedAt > 120_000) {
      shieldStartedAt = now;
      shieldMemory.set(shieldKey, shieldStartedAt);
    }
    return { ...s, shieldStartedAt };
  });

  onProgress?.(symbols.length, scanLimit);
  logDebug("scan", `✅ انتهى المسح • ${symbols.length} عملة جاهزة للتحليل`, { frame: timeframe });

  const response = {
    timeframe,
    fearGreed: fng ?? mockResult.fearGreed,
    scannedAt: new Date().toISOString(),
    symbols,
    totalScanned: scanLimit,
  };

  if (symbols.length > 0) {
    lastGoodScan.set(timeframe, response);
    try { localStorage.setItem(`sniper.lastGoodScan.${timeframe}`, JSON.stringify(response)); } catch { /* ignore */ }
    return response;
  }

  const fallback = lastGoodScan.get(timeframe) ?? readLastGoodScan(timeframe);
  if (fallback) {
    logDebug("skip", `🛟 استخدام آخر مسح ناجح مؤقتاً بدل إخفاء العملات أثناء تعثر الشبكة`, { frame: timeframe });
    return { ...fallback, fearGreed: fng ?? fallback.fearGreed, scannedAt: new Date().toISOString() };
  }

  return response;
}

function readLastGoodScan(timeframe: SniperTimeframe): SniperScanResponse | null {
  try {
    const raw = localStorage.getItem(`sniper.lastGoodScan.${timeframe}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SniperScanResponse;
    if (!parsed?.symbols?.length) return null;
    lastGoodScan.set(timeframe, parsed);
    return parsed;
  } catch { return null; }
}

export function useSniperScan(timeframe: SniperTimeframe, enabled: boolean = true) {
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [scanLimit, setScanLimit] = useState<number>(() => loadSniperSettings().scanLimit ?? SCAN_LIMIT_DEFAULT);

  useEffect(() => {
    const onChange = () => setScanLimit(loadSniperSettings().scanLimit ?? SCAN_LIMIT_DEFAULT);
    window.addEventListener("sniper-settings-changed", onChange);
    return () => window.removeEventListener("sniper-settings-changed", onChange);
  }, []);

  const query = useQuery<SniperScanResponse>({
    queryKey: ["sniper-scan-client", timeframe, scanLimit],
    queryFn: () => scanClientSide(timeframe, scanLimit, (done, total) => setProgress({ done, total })),
    placeholderData: keepPreviousData,
    refetchInterval: enabled ? 90_000 : false,
    staleTime: 60_000,
    retry: 1,
    enabled,
  });

  return { ...query, progress };
}