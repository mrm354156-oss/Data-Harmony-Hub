import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface CryptoData {
  id: string;
  symbol: string;
  name: string;
  image: string;
  currentPrice: number;
  marketCap: number;
  marketCapRank: number;
  totalVolume: number;
  high24h: number;
  low24h: number;
  priceChange24h: number;
  priceChangePercent24h: number;
  priceChangePercent1h: number;
  priceChangePercent7d: number;
  circulatingSupply: number;
  ath: number;
  athChangePercent: number;
}

interface FetchResponse {
  cryptos: CryptoData[];
  lastFetch: string;
  error?: string;
}

export function useCryptoPrices() {
  return useQuery<FetchResponse>({
    queryKey: ["crypto-prices"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke<FetchResponse>("fetch-crypto-prices");

      if (error) {
        throw new Error("فشل جلب بيانات العملات الرقمية: " + error.message);
      }

      if (!data || !data.cryptos || data.cryptos.length === 0) {
        throw new Error("لم يتم استلام بيانات العملات الرقمية");
      }

      return data;
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
    retry: 3,
  });
}
