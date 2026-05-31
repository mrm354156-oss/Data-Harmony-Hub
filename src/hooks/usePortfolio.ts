import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";

export interface PortfolioItem {
  id: string;
  user_id: string;
  symbol: string;
  name_ar: string;
  buy_price: number;
  quantity: number;
  added_at: string;
  asset_type: string;
  currency: string;
}

export function usePortfolio(user: User | null) {
  const queryClient = useQueryClient();

  const query = useQuery<PortfolioItem[]>({
    queryKey: ["portfolio", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("portfolio_items")
        .select("*")
        .order("added_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as PortfolioItem[];
    },
  });

  const addItem = useMutation({
    mutationFn: async (item: { symbol: string; name_ar: string; buy_price: number; quantity: number; asset_type?: string; currency?: string }) => {
      if (!user) throw new Error("User not authenticated");
      const { error } = await supabase.from("portfolio_items").insert({
        user_id: user.id,
        symbol: item.symbol,
        name_ar: item.name_ar,
        buy_price: item.buy_price,
        quantity: item.quantity,
        asset_type: item.asset_type || "stock",
        currency: item.currency || "EGP",
      });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["portfolio", user?.id] }),
  });

  const updateItem = useMutation({
    mutationFn: async ({ id, buy_price, quantity }: { id: string; buy_price: number; quantity: number }) => {
      const { error } = await supabase.from("portfolio_items").update({ buy_price, quantity }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["portfolio", user?.id] }),
  });

  const removeItem = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("portfolio_items").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["portfolio", user?.id] }),
  });

  return { portfolio: query.data ?? [], isLoading: query.isLoading, addItem, updateItem, removeItem };
}
