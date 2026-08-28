"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const ORDER_NAV = [
  { href: "/orders", label: "Dashboard", icon: "▦" },
  { href: "/orders/tracking", label: "Tracking", icon: "◇" },
  { href: "/orders/accounts", label: "Accounts", icon: "✉" },
  { href: "/orders/settings", label: "Settings", icon: "⚙" },
];

export default function OrderTrackerShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="order-app-shell">
      <aside className="order-sidebar" aria-label="Order Tracker navigation">
        <nav>
          {ORDER_NAV.map((item) => {
            const active = item.href === "/orders"
              ? pathname === item.href
              : pathname.startsWith(item.href);
            return (
              <Link key={item.href} href={item.href} className={active ? "active" : ""}>
                <i aria-hidden="true">{item.icon}</i>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>
      <div className="order-page-content">{children}</div>
    </div>
  );
}
