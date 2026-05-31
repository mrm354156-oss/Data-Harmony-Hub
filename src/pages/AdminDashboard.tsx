import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Check, X, RefreshCw, Shield, Brain, TrendingUp, TrendingDown, Activity, GraduationCap, Cpu, BarChart3 } from "lucide-react";
import LearningStatsPanel from "@/components/LearningStatsPanel";
import type { ModelMetrics } from "@/ai/types";

// ─── Props ─────────────────────────────────────────────────────────────────

interface AIStats {
    totalSignals: number;
    passedSignals: number;
    trainingStats: {
        totalSamples: number;
        validSamples: number;
        lastTrainingAt: number;
        trainingCount: number;
        modelLoaded: boolean;
        modelMetrics: ModelMetrics | null;
    };
    usingMockData: boolean;
    isLoading: boolean;
}

interface PortfolioStats {
    balance: number;
    equity: number;
    totalPnl: number;
    totalPnlPct: number;
    wins: number;
    losses: number;
    winRate: number;
}

interface AdminDashboardProps {
    aiStats: AIStats;
    portfolioStats: PortfolioStats;
}

// ─── Pending User Types ────────────────────────────────────────────────────

interface PendingUser {
    id: string;
    email: string | null;
    display_name: string | null;
    created_at: string;
    status: string;
}

const ADMIN_EMAIL = "mmr136835@gmail.com";

// ─── Component ─────────────────────────────────────────────────────────────

const AdminDashboard = ({ aiStats, portfolioStats }: AdminDashboardProps) => {
    const { user, signOut } = useAuth();
    const [pendingUsers, setPendingUsers] = useState<PendingUser[]>([]);
    const [loading, setLoading] = useState(true);
    const [processing, setProcessing] = useState<string | null>(null);

    // Check if current user is admin
    useEffect(() => {
        if (user) {
            if (user.email !== ADMIN_EMAIL) {
                toast.error("غير مصرح لك بالدخول إلى لوحة التحكم");
            } else {
                fetchPendingUsers();
            }
        }
    }, [user]);

    const fetchPendingUsers = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from("profiles")
                .select("*")
                .eq("status", "pending")
                .order("created_at", { ascending: false });

            if (error) {
                console.error("Error fetching pending users:", error);
                toast.error("حدث خطأ أثناء جلب المستخدمين");
            } else {
                setPendingUsers(data || []);
            }
        } catch (err) {
            console.error("Error:", err);
            toast.error("حدث خطأ غير متوقع");
        } finally {
            setLoading(false);
        }
    };

    const handleApprove = async (userId: string, userEmail: string | null) => {
        setProcessing(userId);
        try {
            const { error } = await supabase
                .from("profiles")
                .update({ status: "active" })
                .eq("id", userId);

            if (error) {
                console.error("Error approving user:", error);
                toast.error("حدث خطأ أثناء الموافقة على المستخدم");
            } else {
                toast.success(`تمت الموافقة على ${userEmail || "المستخدم"} بنجاح! ✅`);
                setPendingUsers((prev) => prev.filter((u) => u.id !== userId));
            }
        } catch (err) {
            console.error("Error:", err);
            toast.error("حدث خطأ غير متوقع");
        } finally {
            setProcessing(null);
        }
    };

    const handleReject = async (userId: string, userEmail: string | null) => {
        setProcessing(userId);
        try {
            const { error } = await supabase
                .from("profiles")
                .update({ status: "rejected" })
                .eq("id", userId);

            if (error) {
                console.error("Error rejecting user:", error);
                toast.error("حدث خطأ أثناء رفض المستخدم");
            } else {
                toast.info(`تم رفض ${userEmail || "المستخدم"}`);
                setPendingUsers((prev) => prev.filter((u) => u.id !== userId));
            }
        } catch (err) {
            console.error("Error:", err);
            toast.error("حدث خطأ غير متوقع");
        } finally {
            setProcessing(null);
        }
    };

    const { trainingStats } = aiStats;
    const accuracy = trainingStats.modelMetrics?.accuracy ?? 0;
    const winRate = trainingStats.modelMetrics?.winRate ?? 0;
    const sharpe = trainingStats.modelMetrics?.sharpeRatio ?? 0;
    const f1Score = trainingStats.modelMetrics?.f1Score ?? 0;

    return (
        <div className="space-y-4" dir="rtl">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Shield className="w-6 h-6 text-gold" />
                    <h1 className="text-lg font-bold text-foreground font-cairo">
                        لوحة تحكم المشرف
                    </h1>
                    {aiStats.usingMockData && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-gold/20 text-gold font-bold animate-pulse">
                            🧪 محاكاة
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={fetchPendingUsers}
                        disabled={loading}
                        className="p-1.5 rounded-lg hover:bg-secondary transition-colors"
                        title="تحديث"
                    >
                        <RefreshCw className={`w-4 h-4 text-muted-foreground ${loading ? "animate-spin" : ""}`} />
                    </button>
                    <button
                        onClick={signOut}
                        className="px-3 py-1.5 text-[11px] rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors font-cairo"
                    >
                        تسجيل خروج
                    </button>
                </div>
            </div>

            {/* ─── AI Model Stats ─────────────────────────────────────────────── */}
            <div className="rounded-xl bg-card border border-border p-3 space-y-3">
                <div className="flex items-center gap-2">
                    <Brain className="w-5 h-5 text-purple-400" />
                    <h2 className="text-sm font-bold font-cairo">إحصائيات النماذج AI</h2>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300">
                        {trainingStats.modelLoaded ? "🟢 جاهز" : "🟡 يتعلم"}
                    </span>
                </div>

                <div className="grid grid-cols-4 gap-2 text-[10px]">
                    <div className="p-2 rounded-lg bg-purple-500/10 border border-purple-500/20 text-center">
                        <GraduationCap className="w-4 h-4 text-purple-400 mx-auto mb-1" />
                        <p className="text-muted-foreground">العينات</p>
                        <p className="font-bold text-foreground text-[13px]">{trainingStats.totalSamples}</p>
                    </div>
                    <div className="p-2 rounded-lg bg-stock-green/10 border border-stock-green/20 text-center">
                        <Activity className="w-4 h-4 text-stock-green mx-auto mb-1" />
                        <p className="text-muted-foreground">الدقة</p>
                        <p className="font-bold text-stock-green text-[13px]">{(accuracy * 100).toFixed(1)}%</p>
                    </div>
                    <div className="p-2 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-center">
                        <BarChart3 className="w-4 h-4 text-cyan-400 mx-auto mb-1" />
                        <p className="text-muted-foreground">Sharpe</p>
                        <p className={`font-bold text-[13px] ${sharpe >= 1 ? "text-stock-green" : "text-gold"}`}>
                            {sharpe.toFixed(2)}
                        </p>
                    </div>
                    <div className="p-2 rounded-lg bg-stock-green/10 border border-stock-green/20 text-center">
                        <Cpu className="w-4 h-4 text-stock-green mx-auto mb-1" />
                        <p className="text-muted-foreground">F1 Score</p>
                        <p className="font-bold text-stock-green text-[13px]">{(f1Score * 100).toFixed(1)}%</p>
                    </div>
                </div>

                <div className="grid grid-cols-3 gap-2 text-[10px]">
                    <div className="p-2 rounded-lg bg-card/60 border border-border text-center">
                        <p className="text-muted-foreground">إشارات AI</p>
                        <p className="font-bold text-foreground text-[13px]">{aiStats.totalSignals}</p>
                    </div>
                    <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-center">
                        <TrendingUp className="w-3.5 h-3.5 text-emerald-400 mx-auto mb-0.5" />
                        <p className="text-muted-foreground">الممررة</p>
                        <p className="font-bold text-emerald-400 text-[13px]">{aiStats.passedSignals}</p>
                    </div>
                    <div className="p-2 rounded-lg bg-card/60 border border-border text-center">
                        <p className="text-muted-foreground">التدريب</p>
                        <p className="font-bold text-foreground text-[13px]">#{trainingStats.trainingCount}</p>
                    </div>
                </div>

                {trainingStats.modelMetrics && (
                    <div className="bg-purple-500/5 border border-purple-500/20 rounded-lg p-2.5 text-[10px]">
                        <p className="text-muted-foreground">
                            <span className="text-purple-300 font-bold">النموذج:</span>{" "}
                            v{trainingStats.modelMetrics.modelVersion}
                            {" • "}
                            <span className="text-purple-300 font-bold">Win Rate:</span>{" "}
                            <span className={winRate >= 0.5 ? "text-stock-green" : "text-stock-red"}>
                                {(winRate * 100).toFixed(1)}%
                            </span>
                            {" • "}
                            <span className="text-purple-300 font-bold">آخر تدريب:</span>{" "}
                            {new Date(trainingStats.lastTrainingAt).toLocaleString("ar-EG")}
                        </p>
                    </div>
                )}
            </div>

            {/* ─── Virtual Portfolio Stats ────────────────────────────────────── */}
            <div className="rounded-xl bg-card border border-border p-3 space-y-2">
                <h2 className="text-sm font-bold font-cairo flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-gold" /> إحصائيات المحفظة الافتراضية
                </h2>
                <div className="grid grid-cols-4 gap-2 text-[10px]">
                    <div className="p-2 rounded-lg bg-secondary/40 border border-border text-center">
                        <p className="text-muted-foreground">الرصيد</p>
                        <p className="font-bold text-foreground">${portfolioStats.balance.toFixed(2)}</p>
                    </div>
                    <div className="p-2 rounded-lg bg-secondary/40 border border-border text-center">
                        <p className="text-muted-foreground">الأسهم</p>
                        <p className="font-bold text-foreground">${portfolioStats.equity.toFixed(2)}</p>
                    </div>
                    <div className={`p-2 rounded-lg border text-center ${portfolioStats.totalPnl >= 0
                        ? "bg-stock-green/10 border-stock-green/30"
                        : "bg-stock-red/10 border-stock-red/30"
                        }`}>
                        <p className="text-muted-foreground">الربح</p>
                        <p className={`font-bold ${portfolioStats.totalPnl >= 0 ? "text-stock-green" : "text-stock-red"}`}>
                            {portfolioStats.totalPnl >= 0 ? "+" : ""}${portfolioStats.totalPnl.toFixed(2)}
                        </p>
                    </div>
                    <div className={`p-2 rounded-lg border text-center ${portfolioStats.totalPnlPct >= 0
                        ? "bg-stock-green/10 border-stock-green/30"
                        : "bg-stock-red/10 border-stock-red/30"
                        }`}>
                        <p className="text-muted-foreground">% الربح</p>
                        <p className={`font-bold ${portfolioStats.totalPnlPct >= 0 ? "text-stock-green" : "text-stock-red"}`}>
                            {portfolioStats.totalPnlPct >= 0 ? "+" : ""}{portfolioStats.totalPnlPct.toFixed(2)}%
                        </p>
                    </div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-[10px]">
                    <div className="p-2 rounded-lg bg-card/60 border border-border text-center">
                        <p className="text-muted-foreground">صفقات رابحة</p>
                        <p className="font-bold text-stock-green text-[13px]">{portfolioStats.wins}</p>
                    </div>
                    <div className="p-2 rounded-lg bg-card/60 border border-border text-center">
                        <p className="text-muted-foreground">صفقات خاسرة</p>
                        <p className="font-bold text-stock-red text-[13px]">{portfolioStats.losses}</p>
                    </div>
                    <div className="p-2 rounded-lg bg-card/60 border border-border text-center">
                        <p className="text-muted-foreground">نسبة الفوز</p>
                        <p className={`font-bold text-[13px] ${portfolioStats.winRate >= 0.5 ? "text-stock-green" : "text-stock-red"}`}>
                            {(portfolioStats.winRate * 100).toFixed(1)}%
                        </p>
                    </div>
                </div>
            </div>

            {/* ─── Learning Stats Panel ────────────────────────────────────────── */}
            <LearningStatsPanel />

            {/* ─── Pending Users ────────────────────────────────────────────────── */}
            <div className="rounded-xl bg-card border border-border overflow-hidden">
                <div className="p-3 border-b border-border">
                    <div className="flex items-center justify-between">
                        <h2 className="text-sm font-bold font-cairo">المستخدمون في انتظار الموافقة</h2>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-gold/15 text-gold font-bold">
                            {pendingUsers.length}
                        </span>
                    </div>
                </div>

                {loading ? (
                    <div className="p-6 text-center">
                        <div className="animate-spin w-6 h-6 border-2 border-gold border-t-transparent rounded-full mx-auto mb-2" />
                        <p className="text-xs text-muted-foreground font-cairo">جاري التحميل...</p>
                    </div>
                ) : pendingUsers.length === 0 ? (
                    <div className="p-6 text-center">
                        <Shield className="w-8 h-8 text-muted-foreground mx-auto mb-2 opacity-50" />
                        <p className="text-sm text-muted-foreground font-cairo">لا يوجد مستخدمون في انتظار المراجعة 🎉</p>
                    </div>
                ) : (
                    <div className="divide-y divide-border">
                        {pendingUsers.map((user) => (
                            <div key={user.id} className="p-3 hover:bg-secondary/30 transition-colors">
                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                    <div className="min-w-0 flex-1">
                                        <p className="text-xs font-mono font-bold text-foreground truncate" dir="ltr">
                                            {user.email || "—"}
                                        </p>
                                        <p className="text-[10px] text-muted-foreground">
                                            {user.display_name || "—"} •{" "}
                                            {new Date(user.created_at).toLocaleDateString("ar-EG", {
                                                year: "numeric",
                                                month: "short",
                                                day: "numeric",
                                            })}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <button
                                            onClick={() => handleApprove(user.id, user.email)}
                                            disabled={processing === user.id}
                                            className="flex items-center gap-1 px-2.5 py-1 text-[10px] rounded-lg bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 border border-emerald-500/30 transition-colors disabled:opacity-50"
                                        >
                                            <Check className="w-3 h-3" />
                                            موافقة
                                        </button>
                                        <button
                                            onClick={() => handleReject(user.id, user.email)}
                                            disabled={processing === user.id}
                                            className="flex items-center gap-1 px-2.5 py-1 text-[10px] rounded-lg bg-red-500/10 text-red-600 hover:bg-red-500/20 border border-red-500/30 transition-colors disabled:opacity-50"
                                        >
                                            <X className="w-3 h-3" />
                                            رفض
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Info */}
            <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-600 dark:text-amber-400 font-cairo">
                هذه اللوحة تعرض إحصائيات النماذج AI والمستخدمين المنتظرين. البيانات تُحدَّث كل 30 ثانية.
            </div>
        </div>
    );
};

export default AdminDashboard;