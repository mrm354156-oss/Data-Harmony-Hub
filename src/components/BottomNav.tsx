import { Briefcase, Bell, Crosshair, ShieldCheck, Shield, ClipboardList } from "lucide-react";

export type TabType = "sniper" | "shields" | "portfolio" | "alerts" | "admin" | "logs";

interface BottomNavProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
  userEmail?: string | null;
}

const ADMIN_EMAIL = "mmr136835@gmail.com";

const BottomNav = ({ activeTab, onTabChange, userEmail }: BottomNavProps) => {
  const tabs = [
    { id: "sniper" as TabType, label: "القناص", icon: Crosshair },
    { id: "shields" as TabType, label: "الدروع", icon: ShieldCheck },
    { id: "portfolio" as TabType, label: "محفظتي", icon: Briefcase },
    { id: "alerts" as TabType, label: "تنبيهات", icon: Bell },
    { id: "logs" as TabType, label: "السجلات", icon: ClipboardList },
  ];

  return (
    <nav className="fixed bottom-0 inset-x-0 z-40 bg-card/90 backdrop-blur-xl border-t border-border">
      <div className="max-w-lg mx-auto flex items-center justify-around py-2">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`flex flex-col items-center gap-2 px-4 py-2 rounded-xl transition-all ${isActive
                ? "text-gold"
                : "text-muted-foreground hover:text-foreground"
                }`}
            >
              <tab.icon className={`w-5 h-5 ${isActive ? "animate-pulse-gold" : ""}`} />
              <span className="text-[10px] font-cairo font-semibold">{tab.label}</span>
            </button>
          );
        })}

        {/* Admin Tab – only rendered for the admin email */}
        {userEmail === ADMIN_EMAIL && (
          <button
            onClick={() => onTabChange("admin")}
            className={`flex flex-col items-center gap-2 px-4 py-2 rounded-xl transition-all ${activeTab === "admin"
              ? "text-gold"
              : "text-muted-foreground hover:text-foreground"
              }`}
          >
            <Shield className={`w-5 h-5 ${activeTab === "admin" ? "animate-pulse-gold" : ""}`} />
            <span className="text-[10px] font-cairo font-semibold">لوحة التحكم</span>
          </button>
        )}
      </div>
    </nav>
  );
};

export default BottomNav;
