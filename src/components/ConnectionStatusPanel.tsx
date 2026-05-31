// Connection Status — WebSocket (Binance) + Supabase health, with full diagnostic checks.
import { useEffect, useMemo, useState } from "react";
import { Wifi, WifiOff, Database, Beaker, CheckCircle2, XCircle, AlertTriangle, Clock, ShieldCheck, KeyRound, Wrench } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getBinanceStreamStatus } from "@/hooks/useBinanceLivePrices";
import { logExecution } from "@/lib/sniperExecutionLog";
import { toast } from "sonner";

const REQUIRED_TABLES = ["daily_stats", "login_logs", "learning_memory", "realized_trades", "sniper_trades"] as const;
type RequiredTableName = typeof REQUIRED_TABLES[number];

type CheckStatus = "success" | "failed" | "skipped";
type CheckResult = { status: CheckStatus; reason: string };
type SessionDiagnostic = {
  hasSession: boolean;
  hasUserId: boolean;
  tokenValid: boolean;
  userId: string | null;
  expiresAt: string | null;
  reason: string;
};
type TableDiagnostic = {
  table: RequiredTableName;
  schema: CheckResult & { missingFields: string[]; checkedFields: string[] };
  read: CheckResult;
  write: CheckResult;
  rollback: CheckResult;
};
type DiagnosticRun = {
  id: string;
  ranAt: string;
  session: SessionDiagnostic;
  tables: TableDiagnostic[];
  ok: boolean;
};

type TableCheck = { table: RequiredTableName; ok: boolean; reason: string };
type DbError = { message?: string; code?: string };
type LooseTableClient = {
  select: (columns: string, options?: { head?: boolean; count?: "exact" }) => { limit: (count: number) => Promise<{ error: DbError | null; count?: number | null }> };
  insert: (payload: Record<string, unknown>) => Promise<{ error: DbError | null }>;
  delete: () => { eq: (column: string, value: unknown) => Promise<{ error: DbError | null }> };
};
type LooseDb = { from: (table: string) => LooseTableClient };

const HISTORY_KEY = "connection_diagnostic_history_v2";

const EXPECTED_COLUMNS: Record<RequiredTableName, string[]> = {
  daily_stats: ["id", "user_id", "day", "trades_count", "wins_count", "losses_count", "pnl_usdt", "pnl_pct", "circuit_breaker_tripped", "updated_at"],
  login_logs: ["id", "user_id", "email", "user_agent", "created_at"],
  learning_memory: ["id", "bucket_key", "pattern_label", "regime_label", "timeframe", "direction", "wins", "losses", "total", "last_outcome", "created_at", "updated_at"],
  realized_trades: ["id", "user_id", "symbol", "name_ar", "asset_type", "currency", "buy_price", "sell_price", "quantity", "realized_pl", "realized_pl_pct", "sold_at"],
  sniper_trades: ["id", "user_id", "signal_id", "symbol", "base_asset", "quote_asset", "timeframe", "direction", "entry", "target1", "target2", "stop_loss", "hard_stop_loss", "confidence", "pattern_label", "rsi", "volume_ratio", "net_flow_pct", "fear_greed", "outcome", "created_at", "updated_at"],
};

const db = supabase as unknown as LooseDb;

const uuid = () => {
  try { return crypto.randomUUID(); }
  catch { return `diag-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
};

const formatDbReason = (message?: string, code?: string) => {
  const raw = message || "خطأ غير معروف";
  const lower = raw.toLowerCase();
  if (code === "42P01" || lower.includes("does not exist") || lower.includes("not found")) return "الجدول غير موجود أو الاسم مختلف";
  if (code === "42703" || lower.includes("column") || lower.includes("schema cache")) return "حقل مفقود أو مخطط الأعمدة غير متطابق";
  if (code === "23505" || lower.includes("duplicate")) return "قيد فريد يمنع الإدخال التجريبي";
  if (code === "23502" || lower.includes("null value")) return "قيد NOT NULL: يوجد حقل إجباري غير مُرسل";
  if (code === "23514" || lower.includes("check constraint")) return "قيد CHECK يمنع القيمة التجريبية";
  if (code === "42501" || lower.includes("row-level security") || lower.includes("rls")) return "سياسات RLS تمنع العملية لهذا المستخدم";
  if (lower.includes("permission")) return "صلاحيات الجدول تمنع العملية";
  if (lower.includes("jwt") || lower.includes("auth") || lower.includes("unauthorized")) return "جلسة الدخول غير صالحة أو منتهية";
  return raw;
};

const resultFromError = (error: DbError | null | undefined, successReason: string): CheckResult => ({
  status: error ? "failed" : "success",
  reason: error ? formatDbReason(error.message, error.code) : successReason,
});

const buildTestPayload = (table: RequiredTableName, userId: string, email?: string) => {
  const id = uuid();
  const stamp = Date.now();
  const randomDay = new Date(Date.UTC(2090, 0, 1 + (stamp % 2500))).toISOString().slice(0, 10);

  if (table === "daily_stats") {
    return { id, user_id: userId, day: randomDay, trades_count: 0, wins_count: 0, losses_count: 0, pnl_usdt: 0, pnl_pct: 0, circuit_breaker_tripped: false };
  }
  if (table === "login_logs") {
    return { id, user_id: userId, email: email || "diagnostic@local.test", user_agent: `connection-diagnostic/${stamp}` };
  }
  if (table === "learning_memory") {
    return { id, bucket_key: `diagnostic-${userId}-${stamp}`, pattern_label: "DIAGNOSTIC", regime_label: "TEST", timeframe: "5m", direction: "long", wins: 0, losses: 0, total: 0, last_outcome: "diagnostic" };
  }
  if (table === "realized_trades") {
    return { id, user_id: userId, symbol: "BTCUSDT", name_ar: "اختبار الربط", asset_type: "crypto", currency: "USD", buy_price: 1, sell_price: 1, quantity: 1, realized_pl: 0, realized_pl_pct: 0 };
  }
  return {
    id,
    user_id: userId,
    signal_id: `diagnostic-${stamp}`,
    symbol: "BTCUSDT",
    base_asset: "BTC",
    quote_asset: "USDT",
    timeframe: "5m",
    direction: "long",
    entry: 1,
    target1: 1.01,
    target2: 1.02,
    stop_loss: 0.99,
    hard_stop_loss: 0.98,
    confidence: 1,
    pattern_label: "DIAGNOSTIC",
    rsi: 50,
    volume_ratio: 1,
    net_flow_pct: 0,
    fear_greed: 50,
    outcome: "pending",
  };
};

const diagnoseSession = async (): Promise<SessionDiagnostic> => {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  const session = sessionData.session;

  if (sessionError) {
    return { hasSession: false, hasUserId: false, tokenValid: false, userId: null, expiresAt: null, reason: formatDbReason(sessionError.message) };
  }
  if (!session) {
    return { hasSession: false, hasUserId: false, tokenValid: false, userId: null, expiresAt: null, reason: "لا توجد جلسة دخول محفوظة" };
  }

  const expiresAt = session.expires_at ? new Date(session.expires_at * 1000).toISOString() : null;
  if (session.expires_at && session.expires_at * 1000 <= Date.now()) {
    return { hasSession: true, hasUserId: !!session.user?.id, tokenValid: false, userId: session.user?.id ?? null, expiresAt, reason: "التوكن منتهي الصلاحية" };
  }

  const { data: userData, error: userError } = await supabase.auth.getUser();
  const userId = userData.user?.id ?? session.user?.id ?? null;
  if (userError) {
    return { hasSession: true, hasUserId: !!userId, tokenValid: false, userId, expiresAt, reason: formatDbReason(userError.message) };
  }
  if (!userId) {
    return { hasSession: true, hasUserId: false, tokenValid: false, userId: null, expiresAt, reason: "الجلسة موجودة لكن userId غير موجود" };
  }

  return { hasSession: true, hasUserId: true, tokenValid: true, userId, expiresAt, reason: "الجلسة صالحة والتوكن مقبول" };
};

const checkSchema = async (table: RequiredTableName): Promise<TableDiagnostic["schema"]> => {
  const checkedFields = EXPECTED_COLUMNS[table];
  const missingFields: string[] = [];
  let permissionError: string | null = null;

  await Promise.all(checkedFields.map(async (field) => {
    const { error } = await db.from(table).select(field, { head: true }).limit(1);
    if (!error) return;
    const reason = formatDbReason(error.message, error.code);
    if (reason.includes("حقل مفقود") || error.code === "42703") missingFields.push(field);
    else permissionError = permissionError || reason;
  }));

  if (missingFields.length > 0) {
    return { status: "failed", reason: `حقول مفقودة: ${missingFields.join(", ")}`, missingFields, checkedFields };
  }
  if (permissionError) {
    return { status: "failed", reason: permissionError, missingFields, checkedFields };
  }
  return { status: "success", reason: `المخطط مطابق (${checkedFields.length} حقل)`, missingFields, checkedFields };
};

const checkRead = async (table: RequiredTableName): Promise<CheckResult> => {
  const { error, count } = await db.from(table).select("*", { head: true, count: "exact" }).limit(1);
  return resultFromError(error, `قراءة متاحة${typeof count === "number" ? ` • عدد مرئي: ${count}` : ""}`);
};

const checkWriteRollback = async (table: RequiredTableName, session: SessionDiagnostic, email?: string): Promise<{ write: CheckResult; rollback: CheckResult }> => {
  if (!session.tokenValid || !session.userId) {
    const reason = `تم تخطي الكتابة: ${session.reason}`;
    return { write: { status: "skipped", reason }, rollback: { status: "skipped", reason } };
  }

  const payload = buildTestPayload(table, session.userId, email);
  const { error: insertError } = await db.from(table).insert(payload);
  const write = resultFromError(insertError, "نجح الإدخال التجريبي");
  if (insertError) {
    return { write, rollback: { status: "skipped", reason: "لم يتم تنفيذ التراجع لأن الإدخال فشل" } };
  }

  const { error: deleteError } = await db.from(table).delete().eq("id", payload.id);
  return { write, rollback: resultFromError(deleteError, deleteError ? "" : "تم حذف الصف التجريبي بنجاح") };
};

const runFullDiagnostic = async (): Promise<DiagnosticRun> => {
  const session = await diagnoseSession();
  const email = (await supabase.auth.getSession()).data.session?.user?.email ?? undefined;

  const tables = await Promise.all(REQUIRED_TABLES.map(async (table) => {
    const [schema, read] = await Promise.all([checkSchema(table), checkRead(table)]);
    const { write, rollback } = await checkWriteRollback(table, session, email);
    return { table, schema, read, write, rollback };
  }));

  const ok = session.tokenValid && tables.every((item) =>
    item.schema.status === "success" && item.read.status === "success" && item.write.status === "success" && item.rollback.status === "success"
  );

  return { id: uuid(), ranAt: new Date().toISOString(), session, tables, ok };
};

const checkRequiredTables = async (): Promise<TableCheck[]> => {
  const checks = await Promise.all(
    REQUIRED_TABLES.map(async (table) => {
      try {
        const [schema, read] = await Promise.all([checkSchema(table), checkRead(table)]);
        const ok = schema.status === "success" && read.status === "success";
        return { table, ok, reason: ok ? "متاح للقراءة والمخطط مطابق" : `${schema.reason} • ${read.reason}` };
      } catch (err) {
        return { table, ok: false, reason: err instanceof Error ? err.message : "تعذر الوصول للجدول" };
      }
    }),
  );

  return checks;
};

const loadHistory = (): DiagnosticRun[] => {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
};

const saveHistory = (history: DiagnosticRun[]) => {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 5))); } catch { /* ignore */ }
};

export default function ConnectionStatusPanel() {
  const [wsOk, setWsOk] = useState(false);
  const [dbOk, setDbOk] = useState<boolean | null>(null);
  const [dbDetails, setDbDetails] = useState<TableCheck[]>([]);
  const [history, setHistory] = useState<DiagnosticRun[]>(() => loadHistory());
  const [testing, setTesting] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [migrationReport, setMigrationReport] = useState<null | {
    ok: boolean; statementsRun?: number; report?: Record<string, { added: string[]; missingBefore: string[] }>;
    sql?: string; requiresManual?: boolean; error?: string; note?: string;
  }>(null);

  const latestRun = history[0];
  const failedCount = useMemo(() => latestRun?.tables.reduce((acc, item) => {
    return acc + [item.schema, item.read, item.write, item.rollback].filter((check) => check.status === "failed").length;
  }, latestRun.session.tokenValid ? 0 : 1), [latestRun]);

  useEffect(() => {
    const tick = () => {
      try {
        const st = getBinanceStreamStatus();
        setWsOk(!!st?.open);
      } catch { setWsOk(false); }
    };
    tick();
    const id = setInterval(tick, 2000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const ping = async () => {
      try {
        const checks = await checkRequiredTables();
        if (!cancelled) {
          setDbDetails(checks);
          setDbOk(checks.every((item) => item.ok));
        }
      } catch { if (!cancelled) setDbOk(false); }
    };
    ping();
    const id = setInterval(ping, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const runTest = async () => {
    setTesting(true);
    try {
      const run = await runFullDiagnostic();
      const next = [run, ...history].slice(0, 5);
      setHistory(next);
      saveHistory(next);
      setDbDetails(run.tables.map((item) => ({
        table: item.table,
        ok: item.schema.status === "success" && item.read.status === "success" && item.write.status === "success" && item.rollback.status === "success",
        reason: [item.schema, item.read, item.write, item.rollback].filter((check) => check.status !== "success").map((check) => check.reason).join(" • ") || "كل الفحوصات ناجحة",
      })));
      setDbOk(run.ok);

      if (run.ok) toast.success("✅ نجح فحص الجلسة والجداول والقراءة والكتابة والتراجع");
      else {
        const firstFailure = run.tables.flatMap((item) => [item.schema, item.read, item.write, item.rollback].map((check) => ({ table: item.table, check }))).find((item) => item.check.status === "failed");
        const description = !run.session.tokenValid
          ? run.session.reason
          : firstFailure ? `${firstFailure.table}: ${firstFailure.check.reason}` : "راجع سجل الفحص بالأسفل";
        toast.error("فشل فحص الربط التفصيلي", {
          description,
          duration: 9000,
          action: {
            label: "اعرض السبب",
            onClick: () => {
              document.getElementById("connection-diagnostic-detail")?.scrollIntoView({ behavior: "smooth", block: "center" });
            },
          },
        });
        logExecution({
          symbol: "—", baseAsset: firstFailure?.table ?? "diagnostic", timeframe: "—", direction: "long",
          status: firstFailure?.check.reason.includes("RLS") ? "blocked" : "error",
          reason: `فشل اختبار الربط: ${description}`,
        });
      }
    } finally {
      setTesting(false);
    }
  };

  const runMigration = async () => {
    setMigrating(true);
    try {
      const { data, error } = await supabase.functions.invoke("auto-migrate-schema");
      if (error) {
        toast.error("تعذر تشغيل الترحيل التلقائي", { description: error.message });
        setMigrationReport({ ok: false, error: error.message });
        return;
      }
      setMigrationReport(data);
      if (data?.ok) {
        toast.success(`✅ تم ترحيل ${data.statementsRun ?? 0} حقل`, { description: "جاري إعادة الفحص..." });
        const checks = await checkRequiredTables();
        setDbDetails(checks);
        setDbOk(checks.every((c) => c.ok));
      } else if (data?.requiresManual) {
        toast.warning("الترحيل يحتاج تنفيذ يدوي", {
          description: "انسخ SQL من التقرير ونفّذه في SQL Editor مرة واحدة.",
          duration: 10000,
        });
      } else {
        toast.error("فشل الترحيل", { description: data?.error ?? "خطأ غير معروف" });
      }
    } finally {
      setMigrating(false);
    }
  };

  return (
    <div className="p-3 rounded-xl border border-border bg-secondary/40 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <h3 className="font-cairo font-bold text-sm text-foreground">🛰️ حالة الاتصال</h3>
        <button
          onClick={runMigration}
          disabled={migrating}
          className="mr-auto flex items-center gap-1 px-2 py-1 rounded-md bg-cyan-500/15 text-cyan-300 text-[10px] font-bold hover:bg-cyan-500/25 disabled:opacity-50"
          title="إنشاء/ترحيل الحقول الناقصة لكل الجداول تلقائياً"
        >
          <Wrench className={`w-3 h-3 ${migrating ? "animate-spin" : ""}`} />
          {migrating ? "ترحيل…" : "ترحيل تلقائي"}
        </button>
        <button
          onClick={runTest}
          disabled={testing}
          className="flex items-center gap-1 px-2 py-1 rounded-md bg-gold/15 text-gold text-[10px] font-bold hover:bg-gold/25 disabled:opacity-50"
        >
          <Beaker className="w-3 h-3" />
          {testing ? "جاري…" : "اختبار شامل"}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <StatusPill
          label="WebSocket (Binance)"
          ok={wsOk}
          icon={wsOk ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
        />
        <StatusPill
          label="Supabase DB"
          ok={dbOk === true}
          pending={dbOk === null}
          icon={<Database className="w-3.5 h-3.5" />}
        />
      </div>

      {dbDetails.length > 0 && (
        <div className="space-y-1 border-t border-border/70 pt-2">
          {dbDetails.map((item) => (
            <div
              key={item.table}
              className={`flex items-start gap-2 rounded-lg border px-2 py-1.5 text-[10px] ${
                item.ok
                  ? "border-stock-green/30 bg-stock-green/5 text-stock-green"
                  : "border-stock-red/30 bg-stock-red/5 text-stock-red"
              }`}
            >
              {item.ok ? <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" /> : <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />}
              <div className="min-w-0 flex-1">
                <div className="font-bold leading-tight">{item.table}</div>
                <div className="break-words opacity-85">{item.reason}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {migrationReport && (
        <div className={`rounded-lg border p-2 text-[10px] space-y-1 ${migrationReport.ok ? "border-stock-green/40 bg-stock-green/5 text-stock-green" : "border-gold/40 bg-gold/5 text-gold"}`}>
          <div className="font-bold flex items-center gap-1.5">
            <Wrench className="w-3 h-3" />
            تقرير الترحيل {migrationReport.ok ? `(${migrationReport.statementsRun ?? 0} حقل تمت إضافته)` : migrationReport.requiresManual ? "(تنفيذ يدوي مطلوب)" : "(فشل)"}
          </div>
          {migrationReport.report && Object.entries(migrationReport.report).map(([t, info]) => (
            <div key={t} className="text-foreground/85">
              <b>{t}:</b> {info.added.length === 0 ? "لا حقول ناقصة" : `أُضيف ${info.added.join("، ")}`}
            </div>
          ))}
          {migrationReport.sql && (
            <details className="mt-1">
              <summary className="cursor-pointer text-cyan-300 font-bold">عرض SQL للتنفيذ اليدوي</summary>
              <pre className="mt-1 max-h-48 overflow-auto rounded bg-background/60 p-2 text-[9px] text-foreground/90 whitespace-pre-wrap">{migrationReport.sql}</pre>
              {migrationReport.note && <p className="text-[9px] opacity-80 mt-1">{migrationReport.note}</p>}
            </details>
          )}
          {migrationReport.error && !migrationReport.requiresManual && <div className="text-stock-red">{migrationReport.error}</div>}
        </div>
      )}

      {latestRun && (
        <div id="connection-diagnostic-detail" className="space-y-2 border-t border-border/70 pt-2">
          <div className="flex items-center gap-2 text-[11px] text-foreground font-bold">
            <Clock className="h-3.5 w-3.5 text-gold" />
            <span>آخر فحص: {new Date(latestRun.ranAt).toLocaleString("ar-EG")}</span>
            <span className={`mr-auto rounded-full px-2 py-0.5 text-[9px] ${latestRun.ok ? "bg-stock-green/15 text-stock-green" : "bg-stock-red/15 text-stock-red"}`}>
              {latestRun.ok ? "سليم" : `${failedCount} مشكلة`}
            </span>
          </div>

          <div className={`rounded-lg border p-2 text-[10px] ${latestRun.session.tokenValid ? "border-stock-green/30 bg-stock-green/5 text-stock-green" : "border-stock-red/30 bg-stock-red/5 text-stock-red"}`}>
            <div className="flex items-center gap-1.5 font-bold">
              {latestRun.session.tokenValid ? <ShieldCheck className="h-3 w-3" /> : <KeyRound className="h-3 w-3" />}
              تشخيص الجلسة
            </div>
            <div className="mt-1 grid grid-cols-2 gap-1 text-[9px] opacity-90">
              <span>Session: {latestRun.session.hasSession ? "موجودة" : "غير موجودة"}</span>
              <span>UserId: {latestRun.session.hasUserId ? "موجود" : "مفقود"}</span>
              <span>Token: {latestRun.session.tokenValid ? "صالح" : "غير صالح"}</span>
              <span>Expiry: {latestRun.session.expiresAt ? new Date(latestRun.session.expiresAt).toLocaleTimeString("ar-EG") : "—"}</span>
            </div>
            <div className="mt-1 break-words opacity-90">{latestRun.session.reason}</div>
          </div>

          <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
            {latestRun.tables.map((item) => (
              <div key={item.table} className="rounded-lg border border-border bg-background/30 p-2">
                <div className="mb-1.5 flex items-center gap-2 text-[10px] font-bold text-foreground">
                  <Database className="h-3 w-3 text-gold" />
                  {item.table}
                </div>
                <DiagnosticLine label="المخطط" result={item.schema} />
                <DiagnosticLine label="القراءة" result={item.read} />
                <DiagnosticLine label="الكتابة" result={item.write} />
                <DiagnosticLine label="التراجع" result={item.rollback} />
                {item.schema.missingFields.length > 0 && (
                  <div className="mt-1 rounded-md bg-stock-red/10 px-2 py-1 text-[9px] font-bold text-stock-red">
                    الحقول الناقصة: {item.schema.missingFields.join("، ")}
                  </div>
                )}
              </div>
            ))}
          </div>

          {history.length > 1 && (
            <div className="text-[9px] text-muted-foreground">
              سجل الفحوصات: {history.slice(1).map((run) => `${new Date(run.ranAt).toLocaleTimeString("ar-EG")} ${run.ok ? "✅" : "❌"}`).join("  •  ")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DiagnosticLine({ label, result }: { label: string; result: CheckResult }) {
  const color = result.status === "success"
    ? "text-stock-green"
    : result.status === "skipped"
      ? "text-muted-foreground"
      : "text-stock-red";
  const Icon = result.status === "success" ? CheckCircle2 : result.status === "skipped" ? AlertTriangle : XCircle;
  return (
    <div className={`flex items-start gap-1.5 py-0.5 text-[9px] ${color}`}>
      <Icon className="mt-0.5 h-3 w-3 shrink-0" />
      <span className="shrink-0 font-bold">{label}:</span>
      <span className="min-w-0 break-words opacity-90">{result.reason}</span>
    </div>
  );
}

function StatusPill({ label, ok, pending, icon }: {
  label: string; ok: boolean; pending?: boolean; icon: React.ReactNode;
}) {
  const color = pending
    ? "border-border bg-background/40 text-muted-foreground"
    : ok
      ? "border-stock-green/40 bg-stock-green/10 text-stock-green"
      : "border-stock-red/40 bg-stock-red/10 text-stock-red";
  return (
    <div className={`flex items-center gap-2 px-2 py-1.5 rounded-lg border ${color}`}>
      {icon}
      <div className="flex-1 min-w-0">
        <div className="text-[10px] opacity-80 truncate">{label}</div>
        <div className="text-[11px] font-bold flex items-center gap-1">
          {pending ? "…" : ok
            ? <><CheckCircle2 className="w-3 h-3" />متصل</>
            : <><XCircle className="w-3 h-3" />منقطع</>}
        </div>
      </div>
    </div>
  );
}
