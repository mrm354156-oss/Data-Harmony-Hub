import { useQuery } from "@tanstack/react-query";

const FALLBACK_RATE = 50;

export const useExchangeRate = () => {
  const query = useQuery({
    queryKey: ["usd-egp-rate"],
    queryFn: async () => {
      // Try exchangerate.host first (free, no key)
      try {
        const res = await fetch("https://api.exchangerate.host/latest?base=USD&symbols=EGP");
        const data = await res.json();
        const rate = data?.rates?.EGP;
        if (rate && rate > 0) return rate as number;
      } catch (e) {
        console.warn("exchangerate.host failed", e);
      }
      // Fallback: open.er-api.com (free, no key)
      try {
        const res = await fetch("https://open.er-api.com/v6/latest/USD");
        const data = await res.json();
        const rate = data?.rates?.EGP;
        if (rate && rate > 0) return rate as number;
      } catch (e) {
        console.warn("open.er-api.com failed", e);
      }
      return FALLBACK_RATE;
    },
    staleTime: 1000 * 60 * 60, // 1 hour
    refetchInterval: 1000 * 60 * 60,
    refetchOnWindowFocus: false,
  });

  return {
    rate: query.data ?? FALLBACK_RATE,
    isLoading: query.isLoading,
    isLive: !!query.data && query.data !== FALLBACK_RATE,
  };
};
