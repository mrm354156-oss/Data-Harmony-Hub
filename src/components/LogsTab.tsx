import { ClipboardList } from "lucide-react";
import SniperExecutionLogPanel from "@/components/SniperExecutionLogPanel";
import SmartJudgePanel from "@/components/SmartJudgePanel";
import LearningStatsPanel from "@/components/LearningStatsPanel";
import DebugTimelinePanel from "@/components/DebugTimelinePanel";
import ShadowLogPanel from "@/components/ShadowLogPanel";
import RiskPanel from "@/components/RiskPanel";
import ConnectionStatusPanel from "@/components/ConnectionStatusPanel";
import type { SniperSignal, SniperFearGreed } from "@/lib/sniperEngine";
import type { LoggedSniperSignal } from "@/hooks/useSniperLog";

interface LogsTabProps {
    signals: SniperSignal[];
    fng: SniperFearGreed | null;
    log: LoggedSniperSignal[];
    isCloudAuthed: boolean;
}

const LogsTab = ({ signals, fng, log, isCloudAuthed }: LogsTabProps) => {
    return (
        <div className="space-y-4">
            <div className="flex items-center gap-2">
                <ClipboardList className="w-5 h-5 text-gold" />
                <h2 className="font-cairo font-bold text-lg text-foreground">📋 السجلات والتقارير</h2>
            </div>

            <SniperExecutionLogPanel />
            <SmartJudgePanel signals={signals} fng={fng} />
            <LearningStatsPanel />
            <DebugTimelinePanel />
            <ShadowLogPanel />
            <RiskPanel log={log} isCloudAuthed={isCloudAuthed} />
            <ConnectionStatusPanel />
        </div>
    );
};

export default LogsTab;