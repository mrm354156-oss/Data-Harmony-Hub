import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";

export interface PriceAlert {
  id: string;
  user_id: string;
  symbol: string;
  name_ar: string;
  target_price: number;
  direction: "above" | "below";
  is_triggered: boolean;
  created_at: string;
  triggered_at: string | null;
}

export function usePriceAlerts(user: User | null) {
  const queryClient = useQueryClient();

  const query = useQuery<PriceAlert[]>({
    queryKey: ["price_alerts", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("price_alerts")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as PriceAlert[];
    },
  });

  const addAlert = useMutation({
    mutationFn: async (alert: { symbol: string; name_ar: string; target_price: number; direction: string }) => {
      const { error } = await supabase.from("price_alerts").insert({
        user_id: user!.id,
        ...alert,
      });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["price_alerts"] }),
  });

  const removeAlert = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("price_alerts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["price_alerts"] }),
  });

  const triggerAlert = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("price_alerts")
        .update({ is_triggered: true, triggered_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["price_alerts"] }),
  });

  return { alerts: query.data ?? [], isLoading: query.isLoading, addAlert, removeAlert, triggerAlert };
}
