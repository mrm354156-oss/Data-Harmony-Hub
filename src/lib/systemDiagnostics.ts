/**
 * systemDiagnostics.ts — V44
 * 
 * أداة تشخيص لتتبع حالة النظام بالكامل.
 * تسجل حالة كل مكون في كل دورة مسح لتوضيح سبب عدم ظهور صفقات جديدة.
 * 
 * المكونات المراقبة:
 * 1. Scanner State — هل الماسح شغال؟
 * 2. Analysis Engine State — هل التحليل شغال؟
 * 3. Decision Core State — هل محرك القرار شغال؟
 * 4. Trade Admission State — هل قبول الصفقات مسموح؟
 * 5. Risk Management State — هل مدير المخاطر يمنع؟
 */

import { logDebug } from "@/lib/debugBus";

export interface DiagnosticSnapshot {
    timestamp: number;
    scanner: {
        running: boolean;
        enabled: boolean;
        scanLimit: number;
        timeframe: string;
    };
    analysis: {
        running: boolean;
        signalsGenerated: number;
        signalsPassed: number;
        shieldEnabled: boolean;
        sweepSensitivity: number;
    };
    decision: {
        running: boolean;
        signalsSentToLog: number;
    };
    tradeAdmission: {
        allowed: boolean;
        judgeBlocked: number;
        shieldBlocked: number;
        antiRepeatBlocked: number;
        clarityBlocked: number;
        duplicateBlocked: number;
    };
    risk: {
        blockActive: boolean;
        lastTradeWasLoss: boolean;
        metaPenalty: number;
        mood: string;
    };
}

let snapshot: DiagnosticSnapshot = {
    timestamp: Date.now(),
    scanner: { running: false, enabled: true, scanLimit: 50, timeframe: "5m" },
    analysis: { running: false, signalsGenerated: 0, signalsPassed: 0, shieldEnabled: true, sweepSensitivity: 3 },
    decision: { running: false, signalsSentToLog: 0 },
    tradeAdmission: { allowed: true, judgeBlocked: 0, shieldBlocked: 0, antiRepeatBlocked: 0, clarityBlocked: 0, duplicateBlocked: 0 },
    risk: { blockActive: false, lastTradeWasLoss: false, metaPenalty: 0, mood: "normal" },
};

export function getDiagnosticSnapshot(): DiagnosticSnapshot {
    return { ...snapshot, timestamp: Date.now() };
}

export function updateScannerState(state: Partial<DiagnosticSnapshot["scanner"]>) {
    snapshot.scanner = { ...snapshot.scanner, ...state, running: true };
    snapshot.timestamp = Date.now();
}

export function updateAnalysisState(state: Partial<DiagnosticSnapshot["analysis"]>) {
    snapshot.analysis = { ...snapshot.analysis, ...state, running: true };
    snapshot.timestamp = Date.now();
}

export function updateDecisionState(state: Partial<DiagnosticSnapshot["decision"]>) {
    snapshot.decision = { ...snapshot.decision, ...state, running: true };
    snapshot.timestamp = Date.now();
}

export function updateTradeAdmission(state: Partial<DiagnosticSnapshot["tradeAdmission"]>) {
    snapshot.tradeAdmission = { ...snapshot.tradeAdmission, ...state };
    snapshot.timestamp = Date.now();
}

export function updateRiskState(state: Partial<DiagnosticSnapshot["risk"]>) {
    snapshot.risk = { ...snapshot.risk, ...state };
    snapshot.timestamp = Date.now();
}

export function resetDiagnostics() {
    snapshot = {
        timestamp: Date.now(),
        scanner: { running: false, enabled: true, scanLimit: 50, timeframe: "5m" },
        analysis: { running: false, signalsGenerated: 0, signalsPassed: 0, shieldEnabled: true, sweepSensitivity: 3 },
        decision: { running: false, signalsSentToLog: 0 },
        tradeAdmission: { allowed: true, judgeBlocked: 0, shieldBlocked: 0, antiRepeatBlocked: 0, clarityBlocked: 0, duplicateBlocked: 0 },
        risk: { blockActive: false, lastTradeWasLoss: false, metaPenalty: 0, mood: "normal" },
    };
}

/**
 * اطبع تشخيص كامل في الـ console مع debugBus
 */
export function printDiagnosticReport(cycleLabel?: string) {
    const s = getDiagnosticSnapshot();
    const header = cycleLabel ? `🔬 تشخيص النظام — ${cycleLabel}` : "🔬 تشخيص النظام";

    logDebug("diagnostic", `\n╔═══════════════════════════════════════╗`);
    logDebug("diagnostic", `║ ${header.padEnd(38)}║`);
    logDebug("diagnostic", `╚═══════════════════════════════════════╝`);

    logDebug("diagnostic", `⏱  التوقيت: ${new Date(s.timestamp).toLocaleTimeString("ar-EG")}`);

    // Scanner
    logDebug("diagnostic", `\n📡 Scanner Running    = ${s.scanner.running ? "✅ TRUE" : "❌ FALSE"}`);
    logDebug("diagnostic", `   Scanner Enabled     = ${s.scanner.enabled}`);
    logDebug("diagnostic", `   Scan Limit          = ${s.scanner.scanLimit}`);
    logDebug("diagnostic", `   Timeframe           = ${s.scanner.timeframe}`);

    // Analysis
    logDebug("diagnostic", `\n⚙️  Analysis Running   = ${s.analysis.running ? "✅ TRUE" : "❌ FALSE"}`);
    logDebug("diagnostic", `   Signals Generated   = ${s.analysis.signalsGenerated}`);
    logDebug("diagnostic", `   Signals Passed      = ${s.analysis.signalsPassed}`);
    logDebug("diagnostic", `   Shield Enabled      = ${s.analysis.shieldEnabled}`);
    logDebug("diagnostic", `   Sweep Sensitivity   = ${s.analysis.sweepSensitivity}`);

    // Decision
    logDebug("diagnostic", `\n🧠 Decision Running   = ${s.decision.running ? "✅ TRUE" : "❌ FALSE"}`);
    logDebug("diagnostic", `   Signals Sent to Log = ${s.decision.signalsSentToLog}`);

    // Trade Admission
    const totalBlocked = s.tradeAdmission.judgeBlocked + s.tradeAdmission.shieldBlocked +
        s.tradeAdmission.antiRepeatBlocked + s.tradeAdmission.clarityBlocked +
        s.tradeAdmission.duplicateBlocked;
    logDebug("diagnostic", `\n🚦 Trade Admission Allowed = ${s.tradeAdmission.allowed ? "✅ TRUE" : "❌ FALSE"}`);
    logDebug("diagnostic", `   Judge Blocked       = ${s.tradeAdmission.judgeBlocked}`);
    logDebug("diagnostic", `   Shield Blocked      = ${s.tradeAdmission.shieldBlocked}`);
    logDebug("diagnostic", `   Anti-Repeat Blocked = ${s.tradeAdmission.antiRepeatBlocked}`);
    logDebug("diagnostic", `   Clarity Blocked     = ${s.tradeAdmission.clarityBlocked}`);
    logDebug("diagnostic", `   Duplicate Blocked   = ${s.tradeAdmission.duplicateBlocked}`);
    logDebug("diagnostic", `   Total Blocked       = ${totalBlocked}`);

    // Risk
    logDebug("diagnostic", `\n🛡️  Risk Block Active   = ${s.risk.blockActive ? "✅ TRUE (قيد التشغيل)" : "❌ FALSE"}`);
    logDebug("diagnostic", `   Last Trade Was Loss = ${s.risk.lastTradeWasLoss}`);
    logDebug("diagnostic", `   Meta Penalty        = ${s.risk.metaPenalty}`);
    logDebug("diagnostic", `   Risk Mood           = ${s.risk.mood}`);

    // الخلاصة
    logDebug("diagnostic", `\n📋 الخلاصة:`);
    if (!s.scanner.running) {
        logDebug("diagnostic", `   ❌ الماسح متوقف — لا يتم جمع بيانات جديدة`);
    } else if (s.analysis.signalsGenerated === 0) {
        logDebug("diagnostic", `   ❌ التحليل شغال لكن لم يولد أي إشارات — السوق ما فيهاش فرص`);
    } else if (s.analysis.signalsPassed === 0) {
        logDebug("diagnostic", `   ❌ تم توليد ${s.analysis.signalsGenerated} إشارة لكن لم تجتز Filters كلها`);
    } else if (totalBlocked === s.analysis.signalsPassed) {
        logDebug("diagnostic", `   ❌ كل الإشارات الناجحة (${s.analysis.signalsPassed}) تم حجبها بواسطة Admission Gates`);
        if (s.tradeAdmission.judgeBlocked > 0) logDebug("diagnostic", `      - القاضي (Judge) حجب ${s.tradeAdmission.judgeBlocked}`);
        if (s.tradeAdmission.shieldBlocked > 0) logDebug("diagnostic", `      - درع المطبخ (Shield) حجب ${s.tradeAdmission.shieldBlocked}`);
        if (s.tradeAdmission.antiRepeatBlocked > 0) logDebug("diagnostic", `      - مانع التكرار (Anti-Repeat) حجب ${s.tradeAdmission.antiRepeatBlocked}`);
        if (s.tradeAdmission.clarityBlocked > 0) logDebug("diagnostic", `      - وضوح الشمعة (Clarity) حجب ${s.tradeAdmission.clarityBlocked}`);
        if (s.tradeAdmission.duplicateBlocked > 0) logDebug("diagnostic", `      - التكرار (Duplicate) حجب ${s.tradeAdmission.duplicateBlocked}`);
    } else if (s.decision.signalsSentToLog > 0) {
        logDebug("diagnostic", `   ✅ ${s.decision.signalsSentToLog} إشارة وصلت للسجل — بانتظار تحقيق الأهداف`);
    } else {
        logDebug("diagnostic", `   ⚠️  حالة غير متوقعة — راجع التفاصيل أعلاه`);
    }
    logDebug("diagnostic", `\n═══════════════════════════════════════\n`);
}