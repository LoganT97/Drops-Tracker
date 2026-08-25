"use client";

import { useEffect } from "react";

const INTERVAL_MS = 30_000;

export default function ActivityHeartbeat() {
  useEffect(() => {
    const ping = () => {
      if (document.visibilityState !== "visible") return;
      void fetch("/api/activity", { method: "POST", keepalive: true });
    };

    ping();
    const interval = window.setInterval(ping, INTERVAL_MS);
    window.addEventListener("focus", ping);
    document.addEventListener("visibilitychange", ping);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", ping);
      document.removeEventListener("visibilitychange", ping);
    };
  }, []);

  return null;
}
