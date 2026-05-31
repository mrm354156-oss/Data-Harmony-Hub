// Daily Stats Panel — Sniper tab
// Pulls today's row from Supabase `daily_stats` and auto-refreshes every 30s.
import { useEffect, useState } from "react";
import { TrendingUp, TrendingDown, Target, Activity } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface DailyStats {
  trades_count: number;
  wins_count: number;
  losses_count: number;
  pnl_usdt: number;
  pnl_pct: number;
}

const today = () => new Date().toISOString().slice(0, 10);

export default function DailyStatsPanel() {
  const [stats, setStats] = useState<DailyStats | null>(null);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user.id;
      if (!uid) { setAuthed(false); setStats(null); return; }
      setAuthed(true);
      const { data } = await supabase
        .from("daily_stats")
        .select("trades_count,wins_count,losses_count,pnl_usdt,pnl_pct")
        .eq("user_id", uid)
        .eq("day", today())
        .maybeSingle();
      if (!cancelled) {
        setStats(data ? {
          trades_count: data.trades_count ?? 0,
          wins_count: data.wins_count ?? 0,
          losses_count: data.losses_count ?? 0,
          pnl_usdt: Number(data.pnl_usdt ?? 0),
          pnl_pct: Number(data.pnl_pct ?? 0),
        } : { trades_count: 0, wins_count: 0, losses_count: 0, pnl_usdt: 0, pnl_pct: 0 });
      }
    };
    load();
    const id = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  if (!authed) {
    return (
      <div className="p-3 rounded-xl border border-border bg-secondary/40">
        <p className="text-[11px] text-muted-foreground text-center">
          🔐 سجّل دخول لعرض إحصائيات اليوم المتزامنة عبر الأجهزة
        </p>
      </div>
    );
  }

  const s = stats ?? { trades_count: 0, wins_count: 0, losses_count: 0, pnl_usdt: 0, pnl_pct: 0 };
  const winRate = s.trades_count > 0 ? Math.round((s.wins_count / s.trades_count) * 100) : 0;
  const pnlPos = s.pnl_usdt >= 0;

  return (
    <div className="p-3 rounded-xl border border-gold/30 bg-gold/5 space-y-2">
      <div className="flex items-center gap-2">
        <Activity className="w-4 h-4 text-gold" />
        <h3 className="font-cairo font-bold text-sm text-foreground">📊 إحصائيات اليوم</h3>
        <span className="text-[10px] text-muted-foreground mr-auto">
          {new Date().toLocaleDateString("ar-EG")}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Cell label="صفقات اليوم" value={s.trades_count} icon={<Target className="w-3 h-3 text-gold" />} />
        <Cell
          label="معدل النجاح"
          value={`${winRate}%`}
          sub={`${s.wins_count}W / ${s.losses_count}L`}
          icon={<TrendingUp className="w-3 h-3 text-stock-green" />}
        />
        <Cell
          label="صافي P/L"
          value={`${pnlPos ? "+" : ""}${s.pnl_usdt.toFixed(2)}$`}
          sub={`${pnlPos ? "+" : ""}${s.pnl_pct.toFixed(2)}%`}
          icon={pnlPos
            ? <TrendingUp className="w-3 h-3 text-stock-green" />
            : <TrendingDown className="w-3 h-3 text-stock-red" />}
          color={pnlPos ? "text-stock-green" : "text-stock-red"}
        />
      </div>
    </div>
  );
}

function Cell({ label, value, sub, icon, color }: {
  label: string; value: string | number; sub?: string;
  icon: React.ReactNode; color?: string;
}) {
  return (
    <div className="p-2 rounded-lg bg-background/60 border border-border">
      <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
        {icon}<span>{label}</span>
      </div>
      <div className={`font-bold text-sm mt-0.5 ${color ?? "text-foreground"}`}>{value}</div>
      {sub && <div className="text-[9px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
