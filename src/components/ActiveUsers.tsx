"use client";

import { useEffect, useState } from "react";

type UserEntry = {
  id: string;
  username: string;
  avatarUrl: string | null;
  role: "ADMIN" | "MEMBER";
  lastLoginAt: string | null;
  lastActiveAt: string | null;
  createdAt: string;
};

export default function ActiveUsers({ onClose }: { onClose: () => void }) {
  const [users, setUsers] = useState<UserEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch("/api/users", { cache: "no-store" })
        .then((response) => response.ok ? response.json() : Promise.reject(new Error("Couldn't load users.")))
        .then((data) => { if (!cancelled) { setUsers(data); setError(null); } })
        .catch((reason) => { if (!cancelled) setError(reason.message); });
    };
    load();
    const interval = window.setInterval(load, 15_000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const onlineCount = users?.filter(isOnline).length ?? 0;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal users-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2>Active users</h2>
            <p className="muted">
              {users ? `${onlineCount} online now · ${users.length} authorized account${users.length === 1 ? "" : "s"}` : "Loading activity…"}
            </p>
          </div>
          <button className="ghost-btn" style={{ width: "auto" }} onClick={onClose}>Close</button>
        </div>

        {error && <p style={{ color: "var(--red)" }}>{error}</p>}
        {!users && !error && <div className="skeleton-list" aria-label="Loading active users"><span /><span /><span /></div>}
        {users?.length === 0 && <p className="muted">No users have logged in yet.</p>}
        {users && users.length > 0 && (
          <ul className="users-list">
            {users.map((user) => (
              <li key={user.id} className={isOnline(user) ? "online" : ""}>
                {user.avatarUrl
                  ? <img src={user.avatarUrl} alt="" />
                  : <span className="user-avatar-fallback">{user.username.slice(0, 1).toUpperCase()}</span>}
                <div className="user-summary">
                  <strong>{user.username}</strong>
                  <span>
                    {isOnline(user)
                      ? "Online now"
                      : `Last active: ${user.lastActiveAt ? new Date(user.lastActiveAt).toLocaleString() : "No activity recorded yet"}`}
                  </span>
                </div>
                <span className={`presence-dot ${isOnline(user) ? "online" : "offline"}`} aria-label={isOnline(user) ? "Online" : "Offline"} />
                <span className={`user-role ${user.role.toLowerCase()}`}>{user.role === "ADMIN" ? "Admin" : "Viewer"}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function isOnline(user: UserEntry): boolean {
  if (!user.lastActiveAt) return false;
  return Date.now() - new Date(user.lastActiveAt).getTime() < 120_000;
}
