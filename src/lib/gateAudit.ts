/**
 * gateAudit.ts — V44
 * أداة تدقيق لحساب عدد الإشارات المرفوضة لكل Gate.
 * تخزن الأرقام في localStorage وتوفر دالة لطباعة التقرير.
 * لا تؤثر على سلوك النظام إطلاقاً.
 */

const STORAGE_KEY = "sniper_gate_audit_v1";

export interface GateAuditSnapshot {
    totalSignals: number;         // إجمالي الإشارات الناجحة الواردة
    clarityRejected: number;
    judgeRejected: number;
    shieldRejected: number;
    duplicateRejected: number;
    antiRepeatRejected: number;
    totalAdmitted: number;        // التي دخلت السجل فعلاً
    updatedAt: number;
    scanCycles: number;           // عدد دورات المسح
}

function load(): GateAuditSnapshot {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return fresh();
        return JSON.parse(raw) as GateAuditSnapshot;
    } catch {
        return fresh();
    }
}

function fresh(): GateAuditSnapshot {
    return {
        totalSignals: 0,
        clarityRejected: 0,
        judgeRejected: 0,
        shieldRejected: 0,
        duplicateRejected: 0,
        antiRepeatRejected: 0,
        totalAdmitted: 0,
        updatedAt: Date.now(),
        scanCycles: 0,
    };
}

function save(data: GateAuditSnapshot) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch { /* graceful */ }
}

export function incrementTotalSignals(): void {
    const data = load();
    data.totalSignals++;
    data.updatedAt = Date.now();
    save(data);
}

export function incrementClarityRejected(): void {
    const data = load();
    data.clarityRejected++;
    data.updatedAt = Date.now();
    save(data);
}

export function incrementJudgeRejected(): void {
    const data = load();
    data.judgeRejected++;
    data.updatedAt = Date.now();
    save(data);
}

export function incrementShieldRejected(): void {
    const data = load();
    data.shieldRejected++;
    data.updatedAt = Date.now();
    save(data);
}

export function incrementDuplicateRejected(): void {
    const data = load();
    data.duplicateRejected++;
    data.updatedAt = Date.now();
    save(data);
}

export function incrementAntiRepeatRejected(): void {
    const data = load();
    data.antiRepeatRejected++;
    data.updatedAt = Date.now();
    save(data);
}

export function incrementAdmitted(): void {
    const data = load();
    data.totalAdmitted++;
    data.updatedAt = Date.now();
    save(data);
}

export function incrementScanCycle(): void {
    const data = load();
    data.scanCycles++;
    data.updatedAt = Date.now();
    save(data);
}

export function resetAudit(): void {
    save(fresh());
}

export function getAuditData(): GateAuditSnapshot {
    return load();
}

export function printAuditReport(): string {
    const d = getAuditData();
    const total = d.totalSignals || 1; // تجنب القسمة على صفر

    const lines: string[] = [];
    lines.push("╔═══════════════════════════════════════════╗");
    lines.push("║       تقرير تدقيق البوابات — Runtime      ║");
    lines.push("╚═══════════════════════════════════════════╝");
    lines.push(`⏱  آخر تحديث: ${new Date(d.updatedAt).toLocaleString("ar-EG")}`);
    lines.push(`🔄  دورات المسح: ${d.scanCycles}`);
    lines.push("");
    lines.push(`📊  إجمالي الإشارات الواردة: ${d.totalSignals}`);
    lines.push(`✅  المقبولة في السجل: ${d.totalAdmitted}`);
    lines.push(`❌  الإجمالي المرفوض: ${d.totalSignals - d.totalAdmitted}`);
    lines.push(`    (${d.totalSignals > 0 ? ((d.totalSignals - d.totalAdmitted) / d.totalSignals * 100).toFixed(1) : 0
        }% رفض)`);
    lines.push("");

    const gates: Array<{ label: string; count: number }> = [
        { label: "Gate 1 - Clarity Filter", count: d.clarityRejected },
        { label: "Gate 2 - Judge Authority", count: d.judgeRejected },
        { label: "Gate 3 - Kitchen Shield", count: d.shieldRejected },
        { label: "Gate 4 - Duplicate Check", count: d.duplicateRejected },
        { label: "Gate 5 - Anti-Repeat", count: d.antiRepeatRejected },
    ];

    for (const gate of gates) {
        const pct = ((gate.count / total) * 100).toFixed(1);
        lines.push(`   ${gate.label}:`);
        lines.push(`      Rejected: ${gate.count}`);
        lines.push(`      Percent: ${pct}%`);
        lines.push("");
    }

    // التحليل
    const maxGate = gates.reduce((a, b) => a.count > b.count ? a : b);
    lines.push("📋  التحليل:");
    lines.push(`   - أكبر Gate رفضاً: ${maxGate.label} (${maxGate.count} إشارة)`);

    for (const gate of gates) {
        if ((gate.count / total) * 100 > 70) {
            lines.push(`   ⚠️  ${gate.label} يرفض أكثر من 70% من الإشارات!`);
        }
    }

    // هل هناك عنق زجاجة؟
    const sorted = [...gates].sort((a, b) => b.count - a.count);
    if (sorted[0].count > sorted[1].count * 2) {
        lines.push(`   🔴 ${sorted[0].label} هو عنق الزجاجة الرئيسي (أكثر من ضعف ثاني أكبر Gate)`);
    }

    lines.push("");
    lines.push("🔬  لماذا لا تظهر صفقات؟");
    if (d.totalSignals === 0) {
        lines.push("   - لم تصل أي إشارة بعد. النظام في انتظار أول دورة مسح.");
    } else if (d.totalAdmitted > 0) {
        lines.push(`   - ${d.totalAdmitted} صفقة دخلت السجل. النظام يعمل.`);
    } else {
        lines.push(`   - كل الإشارات (${d.totalSignals}) رُفضت.`);
        // حدد أي Gate مسؤولة عن الرفض الأكبر
        const topGate = sorted[0];
        lines.push(`   - ${topGate.label} رفض ${topGate.count} إشارة (${((topGate.count / total) * 100).toFixed(1)}%)`);
        lines.push(`   - الإشارات المرفوضة لا تصل للسجل أبداً.`);
        lines.push(`   - الحل: خفض SweepSensitivity أو تعطيل Kitchen Shield.`);
    }

    lines.push("═══════════════════════════════════════════");

    return lines.join("\n");
}

// دالة الطباعة المباشرة للـ console
export function logAuditReport(): void {
    // eslint-disable-next-line no-console
    console.log(printAuditReport());
}