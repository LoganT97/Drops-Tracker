import Link from "next/link";
import { signOut } from "@/auth";
import ActiveCountBadge from "@/components/ActiveCountBadge";

export default function AppHeader({
  current,
  user,
}: {
  current: "products" | "orders";
  user: { username: string; avatarUrl: string | null };
}) {
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <nav className="app-nav" aria-label="Main navigation">
          <Link className={current === "products" ? "on" : ""} href="/target">
            <SkuIcon />
            <span>SKU Tracker</span>
          </Link>
          <Link className={current === "orders" ? "on" : ""} href="/orders">
            <OrderIcon />
            <span>Order Tracker</span>
          </Link>
        </nav>
        <div className="header-account-cluster">
          <ActiveCountBadge />
          <details className="header-account">
            <summary>
              {user.avatarUrl
                ? <img src={user.avatarUrl} alt="" />
                : <span className="header-avatar-fallback">{user.username.slice(0, 1).toUpperCase()}</span>}
              <span>{user.username}</span>
            </summary>
            <div className="header-account-menu">
              <form
                action={async () => {
                  "use server";
                  await signOut({ redirectTo: "/login" });
                }}
              >
                <button type="submit">Log out</button>
              </form>
            </div>
          </details>
        </div>
      </div>
    </header>
  );
}

function SkuIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 5.5h16v13H4zM8 5.5v13M4 10h16M11.5 14h5" />
    </svg>
  );
}

function OrderIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m5 7 7-3 7 3-7 3-7-3Zm0 0v9l7 4 7-4V7M12 10v10" />
    </svg>
  );
}
