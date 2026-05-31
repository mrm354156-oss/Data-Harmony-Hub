import { useState, useEffect } from "react";
import { Clock } from "lucide-react";

const LiveClock = () => {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const cairoTime = time.toLocaleTimeString("ar-EG", {
    timeZone: "Africa/Cairo",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  const cairoDate = time.toLocaleDateString("ar-EG", {
    timeZone: "Africa/Cairo",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="flex items-center gap-3 text-sm text-muted-foreground">
      <Clock className="w-4 h-4 text-gold" />
      <span className="font-cairo font-semibold text-gold">{cairoTime}</span>
      <span className="hidden sm:inline">•</span>
      <span className="hidden sm:inline">{cairoDate}</span>
    </div>
  );
};

export default LiveClock;
