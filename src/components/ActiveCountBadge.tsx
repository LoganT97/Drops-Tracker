"use client";

import { useEffect, useState } from "react";

export default function ActiveCountBadge() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch("/api/activity", { cache: "no-store" });
        if (!response.ok) return;
        const result = await response.json() as { count?: number };
        if (!cancelled) setCount(result.count ?? 0);
      } catch {}
    };
    void load();
    const interval = window.setInterval(() => void load(), 30_000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, []);

  if (count === null) return null;
  return (
    <span className="active-count-badge" title={`${count} user${count === 1 ? "" : "s"} active in the last two minutes`}>
      <span aria-hidden="true">●</span> {count} active
    </span>
  );
}
