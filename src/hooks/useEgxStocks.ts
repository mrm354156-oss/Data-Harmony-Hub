import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Stock } from "@/data/stocks";

interface FetchResponse {
  stocks: Stock[];
  lastFetch: string;
  source?: string;
  error?: string;
  count?: number;
}

export function useEgxStocks() {
  return useQuery<FetchResponse>({
    queryKey: ["egx-stocks"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke<FetchResponse>("fetch-egx-stocks");

      if (error) {
        throw new Error("فشل الاتصال بالسيرفر: " + (error.message || "خطأ غير معروف"));
      }

      if (!data || !data.stocks || data.stocks.length === 0) {
        throw new Error("لم يتم استلام بيانات من سيرفر الكريبتو");
      }

      if (data.error) {
        throw new Error(data.error);
      }

      return data;
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
  });
}
