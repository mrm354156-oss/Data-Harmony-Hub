// Auto-Migration — adds any missing columns to the diagnostic tables.
// Uses the service-role key to execute idempotent ALTER TABLE statements.
// Returns a before/after schema diff per table.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, range, accept, accept-language, cache-control, pragma",
};

// Required columns per table (PG type expressions). The values match what
// the client diagnostic & sync code expect to be able to write.
const SCHEMA: Record<string, Record<string, string>> = {
  daily_stats: {
    user_id: "uuid",
    day: "date",
    trades_count: "integer default 0",
    wins_count: "integer default 0",
    losses_count: "integer default 0",
    pnl_usdt: "numeric default 0",
    pnl_pct: "numeric default 0",
    circuit_breaker_tripped: "boolean default false",
    updated_at: "timestamptz default now()",
  },
  login_logs: {
    user_id: "uuid",
    email: "text",
    user_agent: "text",
    created_at: "timestamptz default now()",
  },
  learning_memory: {
    bucket_key: "text",
    pattern_label: "text",
    regime_label: "text",
    timeframe: "text",
    direction: "text",
    wins: "integer default 0",
    losses: "integer default 0",
    total: "integer default 0",
    last_outcome: "text",
    created_at: "timestamptz default now()",
    updated_at: "timestamptz default now()",
  },
  profiles: {
    id: "uuid",
    email: "text",
    display_name: "text",
    status: "text default 'pending'",
    created_at: "timestamptz default now()",
    updated_at: "timestamptz default now()",
  },
  realized_trades: {
    user_id: "uuid",
    symbol: "text",
    name_ar: "text",
    asset_type: "text",
    currency: "text",
    buy_price: "numeric",
    sell_price: "numeric",
    quantity: "numeric",
    realized_pl: "numeric",
    realized_pl_pct: "numeric",
    sold_at: "timestamptz default now()",
  },
  sniper_trades: {
    user_id: "uuid",
    signal_id: "text",
    symbol: "text",
    base_asset: "text",
    quote_asset: "text",
    timeframe: "text",
    direction: "text",
    entry: "numeric",
    target1: "numeric",
    target2: "numeric",
    stop_loss: "numeric",
    hard_stop_loss: "numeric",
    confidence: "numeric",
    pattern_label: "text",
    rsi: "numeric",
    volume_ratio: "numeric",
    net_flow_pct: "numeric",
    fear_greed: "numeric",
    outcome: "text default 'pending'",
    created_at: "timestamptz default now()",
    updated_at: "timestamptz default now()",
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (!url || !serviceKey) {
      return json({ ok: false, error: "Service role key not configured" }, 500);
    }
    const sb = createClient(url, serviceKey);

    const before = await snapshotSchema(sb);
    const statements: string[] = [];
    const report: Record<string, { added: string[]; missingBefore: string[] }> = {};

    for (const [table, cols] of Object.entries(SCHEMA)) {
      const existing = before[table] ?? [];
      const missing = Object.keys(cols).filter((c) => !existing.includes(c));
      report[table] = { added: [], missingBefore: missing };
      for (const c of missing) {
        statements.push(`ALTER TABLE public.${table} ADD COLUMN IF NOT EXISTS ${c} ${cols[c]};`);
        report[table].added.push(c);
      }
    }

    if (statements.length > 0) {
      // Try the standard SQL RPC. If it does not exist, return the SQL for manual execution.
      const sql = statements.join("\n");
      const { error } = await sb.rpc("exec_sql" as never, { sql } as never);
      if (error) {
        return json({
          ok: false,
          requiresManual: true,
          sql,
          report,
          error: error.message,
          note: "أنشئ دالة exec_sql(text) أو نفّذ هذا الـ SQL يدوياً مرة واحدة في SQL Editor.",
        });
      }
    }

    const after = await snapshotSchema(sb);
    return json({ ok: true, statementsRun: statements.length, before, after, report });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

async function snapshotSchema(sb: ReturnType<typeof createClient>): Promise<Record<string, string[]>> {
  const tables = Object.keys(SCHEMA);
  const out: Record<string, string[]> = {};
  for (const t of tables) {
    const { data, error } = await sb
      .from("information_schema.columns" as never)
      .select("column_name")
      .eq("table_schema", "public")
      .eq("table_name", t);
    if (error) { out[t] = []; continue; }
    out[t] = (data as { column_name: string }[]).map((r) => r.column_name);
  }
  return out;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}