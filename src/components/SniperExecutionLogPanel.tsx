// Sniper Execution Log Panel — detailed audit trail of every attempt to
// open / sync a trade with reason, Binance response (if any), DB error code.
import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, AlertTriangle, FlaskConical, Trash2, Database, ShieldAlert } from "lucide-react";
import { getExecutionLog, subscribeExecutionLog, clearExecutionLog, type ExecutionAttempt } from "@/lib/sniperExecutionLog";

const statusMeta: Record<ExecutionAttempt["status"], { label: string; cls: string; Icon: typeof CheckCircle2 }> = {
  allowed:  { label: "مسموح",   cls: "border-stock-green/40 bg-stock-green/10 text-stock-green", Icon: CheckCircle2 },
  synced:   { label: "تم الحفظ", cls: "border-stock-green/40 bg-stock-green/10 text-stock-green", Icon: Database },
  resolved: { label: "أُغلقت",   cls: "border-foreground/30 bg-foreground/5 text-foreground",   Icon: CheckCircle2 },
  blocked:  { label: "محظور",   cls: "border-gold/40 bg-gold/10 text-gold",                     Icon: ShieldAlert },
  error:    { label: "خطأ",     cls: "border-stock-red/40 bg-stock-red/10 text-stock-red",      Icon: XCircle },
  paper:    { label: "محاكاة",  cls: "border-cyan-400/40 bg-cyan-500/10 text-cyan-300",         Icon: FlaskConical },
};

export default function SniperExecutionLogPanel() {
  const [log, setLog] = useState<ExecutionAttempt[]>(() => getExecutionLog());
  useEffect(() => subscribeExecutionLog(() => setLog([...getExecutionLog()])), []);

  const counts = log.reduce<Record<string, number>>((acc, e) => {
    acc[e.status] = (acc[e.status] ?? 0) + 1; return acc;
  }, {});

  return (
    <div id="sniper-execution-log" className="p-3 rounded-xl border border-border bg-secondary/40 space-y-2">
      <div className="flex items-center gap-2">
        <h3 className="font-cairo font-bold text-sm text-foreground">📜 سجل تنفيذ القناص</h3>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-background/60 text-muted-foreground">{log.length}/100</span>
        <button
          onClick={() => clearExecutionLog()}
          className="mr-auto flex items-center gap-1 px-2 py-1 rounded-md bg-stock-red/15 text-stock-red text-[10px] font-bold hover:bg-stock-red/25"
        >
          <Trash2 className="w-3 h-3" /> مسح
        </button>
      </div>

      <div className="flex flex-wrap gap-1 text-[9px]">
        {Object.entries(statusMeta).map(([k, m]) => (
          <span key={k} className={`px-1.5 py-0.5 rounded border font-bold ${m.cls}`}>
            {m.label}: {counts[k] ?? 0}
          </span>
        ))}
      </div>

      <div className="space-y-1 max-h-72 overflow-y-auto pr-1">
        {log.length === 0 ? (
          <p className="text-[10px] text-muted-foreground text-center py-4">
            لا توجد محاولات بعد. سيظهر هنا كل قرار من القناص (نجاح/منع/خطأ/محاكاة) مع السبب ووقت التنفيذ.
          </p>
        ) : log.map((e) => {
          const m = statusMeta[e.status];
          const Icon = m.Icon;
          return (
            <div key={e.id} className={`rounded-md border px-2 py-1.5 text-[10px] ${m.cls}`}>
              <div className="flex items-start gap-1.5">
                <Icon className="w-3 h-3 mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 font-bold">
                    <span>{m.label}</span>
                    <span className="text-foreground/80">{e.baseAsset} • {e.timeframe} • {e.direction === "long" ? "شراء" : "بيع"}</span>
                    <span className="mr-auto text-[9px] opacity-75">{new Date(e.ts).toLocaleTimeString("ar-EG")}</span>
                  </div>
                  <div className="opacity-90 break-words">{e.reason}</div>
                  {(e.dbCode || e.dbMessage) && (
                    <div className="mt-0.5 flex items-start gap-1 text-[9px] opacity-80">
                      <AlertTriangle className="w-2.5 h-2.5 mt-0.5 shrink-0" />
                      <span>DB {e.dbCode ?? ""}: {e.dbMessage ?? ""}</span>
                    </div>
                  )}
                  {e.binanceResponse && (
                    <div className="mt-0.5 text-[9px] opacity-80">Binance: {e.binanceResponse}</div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
