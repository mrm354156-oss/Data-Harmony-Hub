export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      daily_stats: {
        Row: {
          circuit_breaker_tripped: boolean
          day: string
          id: string
          losses_count: number
          pnl_pct: number
          pnl_usdt: number
          trades_count: number
          updated_at: string
          user_id: string
          wins_count: number
        }
        Insert: {
          circuit_breaker_tripped?: boolean
          day?: string
          id?: string
          losses_count?: number
          pnl_pct?: number
          pnl_usdt?: number
          trades_count?: number
          updated_at?: string
          user_id: string
          wins_count?: number
        }
        Update: {
          circuit_breaker_tripped?: boolean
          day?: string
          id?: string
          losses_count?: number
          pnl_pct?: number
          pnl_usdt?: number
          trades_count?: number
          updated_at?: string
          user_id?: string
          wins_count?: number
        }
        Relationships: []
      }
      learning_memory: {
        Row: {
          bucket_key: string
          created_at: string
          direction: string
          id: string
          last_outcome: string | null
          losses: number
          pattern_label: string
          regime_label: string
          timeframe: string
          total: number
          updated_at: string
          wins: number
        }
        Insert: {
          bucket_key: string
          created_at?: string
          direction: string
          id?: string
          last_outcome?: string | null
          losses?: number
          pattern_label: string
          regime_label: string
          timeframe: string
          total?: number
          updated_at?: string
          wins?: number
        }
        Update: {
          bucket_key?: string
          created_at?: string
          direction?: string
          id?: string
          last_outcome?: string | null
          losses?: number
          pattern_label?: string
          regime_label?: string
          timeframe?: string
          total?: number
          updated_at?: string
          wins?: number
        }
        Relationships: []
      }
      login_logs: {
        Row: {
          created_at: string
          email: string
          id: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      portfolio_items: {
        Row: {
          added_at: string
          asset_type: string
          buy_price: number
          currency: string
          id: string
          name_ar: string
          quantity: number
          symbol: string
          user_id: string
        }
        Insert: {
          added_at?: string
          asset_type?: string
          buy_price: number
          currency?: string
          id?: string
          name_ar: string
          quantity: number
          symbol: string
          user_id: string
        }
        Update: {
          added_at?: string
          asset_type?: string
          buy_price?: number
          currency?: string
          id?: string
          name_ar?: string
          quantity?: number
          symbol?: string
          user_id?: string
        }
        Relationships: []
      }
      price_alerts: {
        Row: {
          created_at: string
          direction: string
          id: string
          is_triggered: boolean
          name_ar: string
          symbol: string
          target_price: number
          triggered_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          direction: string
          id?: string
          is_triggered?: boolean
          name_ar: string
          symbol: string
          target_price: number
          triggered_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          direction?: string
          id?: string
          is_triggered?: boolean
          name_ar?: string
          symbol?: string
          target_price?: number
          triggered_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      realized_trades: {
        Row: {
          asset_type: string
          buy_price: number
          currency: string
          id: string
          name_ar: string
          quantity: number
          realized_pl: number
          realized_pl_pct: number
          sell_price: number
          sold_at: string
          symbol: string
          user_id: string
        }
        Insert: {
          asset_type?: string
          buy_price: number
          currency?: string
          id?: string
          name_ar: string
          quantity: number
          realized_pl: number
          realized_pl_pct: number
          sell_price: number
          sold_at?: string
          symbol: string
          user_id: string
        }
        Update: {
          asset_type?: string
          buy_price?: number
          currency?: string
          id?: string
          name_ar?: string
          quantity?: number
          realized_pl?: number
          realized_pl_pct?: number
          sell_price?: number
          sold_at?: string
          symbol?: string
          user_id?: string
        }
        Relationships: []
      }
      risk_settings: {
        Row: {
          circuit_breaker_enabled: boolean
          created_at: string
          max_concurrent_trades: number
          max_daily_loss_pct: number
          max_daily_losses: number
          risk_per_trade_pct: number
          updated_at: string
          user_id: string
          virtual_balance_usdt: number
        }
        Insert: {
          circuit_breaker_enabled?: boolean
          created_at?: string
          max_concurrent_trades?: number
          max_daily_loss_pct?: number
          max_daily_losses?: number
          risk_per_trade_pct?: number
          updated_at?: string
          user_id: string
          virtual_balance_usdt?: number
        }
        Update: {
          circuit_breaker_enabled?: boolean
          created_at?: string
          max_concurrent_trades?: number
          max_daily_loss_pct?: number
          max_daily_losses?: number
          risk_per_trade_pct?: number
          updated_at?: string
          user_id?: string
          virtual_balance_usdt?: number
        }
        Relationships: []
      }
      sniper_settings: {
        Row: {
          auto_frame_all_frames: boolean
          dynamic_ttl: boolean
          kitchen_shield: boolean
          scan_limit: number
          shield_multipliers: Json
          sweep_sensitivity: number
          updated_at: string
          user_id: string
        }
        Insert: {
          auto_frame_all_frames?: boolean
          dynamic_ttl?: boolean
          kitchen_shield?: boolean
          scan_limit?: number
          shield_multipliers?: Json
          sweep_sensitivity?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          auto_frame_all_frames?: boolean
          dynamic_ttl?: boolean
          kitchen_shield?: boolean
          scan_limit?: number
          shield_multipliers?: Json
          sweep_sensitivity?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      sniper_trades: {
        Row: {
          base_asset: string
          confidence: number
          created_at: string
          direction: string
          entry: number
          fear_greed: number | null
          hard_stop_loss: number
          id: string
          net_flow_pct: number | null
          outcome: string
          pattern_label: string | null
          pnl_pct: number | null
          pnl_usdt: number | null
          position_size_usdt: number | null
          quality_grade: string | null
          quality_score: number | null
          regime_label: string | null
          resolved_at: string | null
          resolved_price: number | null
          risk_reward: number | null
          rsi: number | null
          signal_id: string
          stop_loss: number
          symbol: string
          target_probability: number | null
          target1: number
          target2: number
          timeframe: string
          updated_at: string
          user_id: string
          volume_ratio: number | null
        }
        Insert: {
          base_asset: string
          confidence: number
          created_at?: string
          direction: string
          entry: number
          fear_greed?: number | null
          hard_stop_loss: number
          id?: string
          net_flow_pct?: number | null
          outcome?: string
          pattern_label?: string | null
          pnl_pct?: number | null
          pnl_usdt?: number | null
          position_size_usdt?: number | null
          quality_grade?: string | null
          quality_score?: number | null
          regime_label?: string | null
          resolved_at?: string | null
          resolved_price?: number | null
          risk_reward?: number | null
          rsi?: number | null
          signal_id: string
          stop_loss: number
          symbol: string
          target_probability?: number | null
          target1: number
          target2: number
          timeframe: string
          updated_at?: string
          user_id: string
          volume_ratio?: number | null
        }
        Update: {
          base_asset?: string
          confidence?: number
          created_at?: string
          direction?: string
          entry?: number
          fear_greed?: number | null
          hard_stop_loss?: number
          id?: string
          net_flow_pct?: number | null
          outcome?: string
          pattern_label?: string | null
          pnl_pct?: number | null
          pnl_usdt?: number | null
          position_size_usdt?: number | null
          quality_grade?: string | null
          quality_score?: number | null
          regime_label?: string | null
          resolved_at?: string | null
          resolved_price?: number | null
          risk_reward?: number | null
          rsi?: number | null
          signal_id?: string
          stop_loss?: number
          symbol?: string
          target_probability?: number | null
          target1?: number
          target2?: number
          timeframe?: string
          updated_at?: string
          user_id?: string
          volume_ratio?: number | null
        }
        Relationships: []
      }
      virtual_portfolio_state: {
        Row: {
          balance: number
          partial_ids: Json
          processed_ids: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          balance?: number
          partial_ids?: Json
          processed_ids?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          balance?: number
          partial_ids?: Json
          processed_ids?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      virtual_portfolio_trades: {
        Row: {
          base_asset: string
          closed_at: string
          direction: string
          entry: number
          exit_price: number
          id: string
          opened_at: string
          outcome: string
          partial_booked: boolean
          partial_pnl: number | null
          pnl: number
          pnl_pct: number
          size: number
          symbol: string
          user_id: string
        }
        Insert: {
          base_asset: string
          closed_at: string
          direction: string
          entry: number
          exit_price: number
          id: string
          opened_at: string
          outcome: string
          partial_booked?: boolean
          partial_pnl?: number | null
          pnl: number
          pnl_pct: number
          size: number
          symbol: string
          user_id: string
        }
        Update: {
          base_asset?: string
          closed_at?: string
          direction?: string
          entry?: number
          exit_price?: number
          id?: string
          opened_at?: string
          outcome?: string
          partial_booked?: boolean
          partial_pnl?: number | null
          pnl?: number
          pnl_pct?: number
          size?: number
          symbol?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      record_learning_outcome: {
        Args: {
          _bucket_key: string
          _direction: string
          _outcome: string
          _pattern_label: string
          _regime_label: string
          _timeframe: string
        }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
  | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
  ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
    DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
  : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
    DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
  ? R
  : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
    DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] &
    DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
  ? R
  : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
  | keyof DefaultSchema["Tables"]
  | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
  ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
  : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
    Insert: infer I
  }
  ? I
  : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
    Insert: infer I
  }
  ? I
  : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
  | keyof DefaultSchema["Tables"]
  | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
  ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
  : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
    Update: infer U
  }
  ? U
  : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
    Update: infer U
  }
  ? U
  : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
  | keyof DefaultSchema["Enums"]
  | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
  ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
  : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
  | keyof DefaultSchema["CompositeTypes"]
  | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
  ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
  : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
