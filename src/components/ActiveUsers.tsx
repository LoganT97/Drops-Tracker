"use client";

import { useEffect, useState } from "react";

type UserEntry = {
  id: string;
  username: string;
  avatarUrl: string | null;
  role: "ADMIN" | "MEMBER";
  lastLoginAt: string | null;
  createdAt: string;
};

export default function ActiveUsers({ onClose }: { onClose: () => void }) {
  const [users, setUsers] = useState<UserEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/users", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Couldn't load users.")))
      .then((data) => { if (!cancelled) setUsers(data); })
      .catch((reason) => { if (!cancelled) setError(reason.message); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal users-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2>Active users</h2>
            <p className="muted">{users ? `${users.length} authorized account${users.length === 1 ? "" : "s"}` : "Authorized accounts"}</p>
          </div>
          <button className="ghost-btn" style={{ width: "auto" }} onClick={onClose}>Close</button>
        </div>

        {error && <p style={{ color: "var(--red)" }}>{error}</p>}
        {!users && !error && <p className="muted">Loading…</p>}
        {users?.length === 0 && <p className="muted">No users have logged in yet.</p>}
        {users && users.length > 0 && (
          <ul className="users-list">
            {users.map((user) => (
              <li key={user.id}>
                {user.avatarUrl
                  ? <img src={user.avatarUrl} alt="" />
                  : <span className="user-avatar-fallback">{user.username.slice(0, 1).toUpperCase()}</span>}
                <div className="user-summary">
                  <strong>{user.username}</strong>
                  <span>Last login: {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : "Never"}</span>
                </div>
                <span className={`user-role ${user.role.toLowerCase()}`}>{user.role === "ADMIN" ? "Admin" : "Viewer"}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
