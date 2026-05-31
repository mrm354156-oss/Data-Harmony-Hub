// V33 Supreme — Debug Timeline Panel
// Live, scrolling event log: shows what the engine is doing right now.
import { forwardRef, useEffect, useState } from "react";
import { Activity, Trash2, Filter } from "lucide-react";
import { clearDebugEvents, getDebugEvents, subscribeDebug, type DebugCategory, type DebugEvent } from "@/lib/debugBus";

const CATS: { id: DebugCategory | "all"; label: string }[] = [
  { id: "all",      label: "الكل" },
  { id: "scan",     label: "مسح" },
  { id: "skip",     label: "تخطي" },
  { id: "judge",    label: "القاضي" },
  { id: "clarity",  label: "تنقية" },
  { id: "cooldown", label: "تبريد" },
  { id: "gc",       label: "تنظيف" },
  { id: "backcheck",label: "مزامنة" },
];

const CAT_STYLE: Record<DebugCategory, string> = {
  scan:     "bg-cyan-500/10 text-cyan-300 border-cyan-500/30",
  skip:     "bg-rose-500/10 text-rose-300 border-rose-500/30",
  judge:    "bg-amber-500/10 text-amber-300 border-amber-500/30",
  clarity:  "bg-violet-500/10 text-violet-300 border-violet-500/30",
  cooldown: "bg-blue-500/10 text-blue-300 border-blue-500/30",
  gc:       "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  info:     "bg-muted text-muted-foreground border-border",
  backcheck:"bg-indigo-500/10 text-indigo-300 border-indigo-500/30",
};

function fmt(ts: number) {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}`;
}

const DebugTimelinePanel = forwardRef<HTMLDivElement>((_props, ref) => {
  const [, force] = useState(0);
  const [filter, setFilter] = useState<DebugCategory | "all">("all");

  useEffect(() => subscribeDebug(() => force(t => t + 1)), []);

  const events: DebugEvent[] = getDebugEvents();
  const visible = filter === "all" ? events : events.filter(e => e.category === filter);

  return (
    <div ref={ref} className="rounded-xl border border-border bg-card/60 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Activity className="w-4 h-4 text-cyan-400" />
        <h3 className="text-sm font-bold">📜 سجل الأحداث (Debug Timeline)</h3>
        <span className="text-[10px] text-muted-foreground mr-auto">{events.length} حدث</span>
        <button
          onClick={() => { clearDebugEvents(); }}
          className="p-1 rounded hover:bg-secondary text-muted-foreground"
          title="مسح السجل"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-1 items-center">
        <Filter className="w-3 h-3 text-muted-foreground" />
        {CATS.map(c => (
          <button
            key={c.id}
            onClick={() => setFilter(c.id)}
            className={`text-[9px] px-2 py-0.5 rounded-md border font-bold transition-all ${
              filter === c.id
                ? "bg-cyan-500/20 text-cyan-200 border-cyan-400"
                : "bg-secondary text-muted-foreground border-border hover:border-cyan-400/40"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="text-[11px] text-muted-foreground py-3 text-center">
          لا توجد أحداث بعد — السجل ينتظر أول حركة من المحرك.
        </p>
      ) : (
        <div className="max-h-72 overflow-y-auto space-y-1 pr-0.5">
          {visible.map(e => (
            <div
              key={e.id}
              className={`text-[10px] px-2 py-1 rounded border leading-tight ${CAT_STYLE[e.category]}`}
            >
              <div className="flex items-center gap-1.5">
                <span className="font-mono opacity-70">{fmt(e.ts)}</span>
                {e.frame && <span className="font-bold">[{e.frame}]</span>}
                {e.symbol && <span className="font-mono">{e.symbol}</span>}
                <span className="mr-auto opacity-90">{e.message}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-[9px] text-muted-foreground/80 leading-relaxed border-t border-border pt-1.5">
        💡 يعرض كل قرارات المحرك لحظياً: الفريم، سبب تخطي العملة، حالة التبريد، نتائج فحص الـ 10,000 شمعة.
      </p>
    </div>
  );
});
DebugTimelinePanel.displayName = "DebugTimelinePanel";

export default DebugTimelinePanel;
