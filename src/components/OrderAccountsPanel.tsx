"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ToastProvider";

type GmailAccount = {
  email: string;
  lastSyncedAt: string | null;
  historyScanned: number;
  historyBackfilledAt: string | null;
  error: string | null;
};

function dateTime(value: string | null) {
  return value ? new Date(value).toLocaleString() : "Not yet";
}

export default function OrderAccountsPanel({ gmail }: { gmail: GmailAccount | null }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [disconnecting, setDisconnecting] = useState(false);
  const [, startTransition] = useTransition();

  async function disconnect() {
    if (!window.confirm("Disconnect Gmail? Imported orders will remain in your account.")) return;
    setDisconnecting(true);
    const response = await fetch("/api/gmail/disconnect", { method: "DELETE" });
    setDisconnecting(false);
    if (!response.ok) {
      showToast("Couldn't disconnect Gmail.", "error");
      return;
    }
    showToast("Gmail disconnected. Imported orders were kept.");
    startTransition(() => router.refresh());
  }

  return (
    <main className="orders-shell order-subpage">
      <div className="orders-heading">
        <div><h1>Accounts</h1><p>Manage the Gmail account used to import Target orders.</p></div>
      </div>

      {gmail ? (
        <section className="order-account-card">
          <div className="order-account-identity">
            <span>G</span>
            <div><strong>{gmail.email}</strong><small><i /> Connected</small></div>
          </div>
          <dl>
            <div><dt>Last scanned</dt><dd>{dateTime(gmail.lastSyncedAt)}</dd></div>
            <div><dt>Historical emails checked</dt><dd>{gmail.historyScanned.toLocaleString()}</dd></div>
            <div><dt>Two-year backfill</dt><dd>{gmail.historyBackfilledAt ? "Complete" : "In progress"}</dd></div>
            <div><dt>Last error</dt><dd className={gmail.error ? "neg" : ""}>{gmail.error ?? "None"}</dd></div>
          </dl>
          <div className="order-account-actions">
            <a className="ghost-btn" href="/api/gmail/connect">Reconnect Gmail</a>
            <button className="ghost-btn danger-text" onClick={() => void disconnect()} disabled={disconnecting}>
              {disconnecting ? "Disconnecting…" : "Disconnect Gmail"}
            </button>
          </div>
        </section>
      ) : (
        <section className="gmail-empty panel order-account-empty">
          <div className="gmail-mark">G</div>
          <div><h2>Connect Gmail</h2><p>Link a Gmail account to import Target confirmations and shipping updates.</p></div>
          <a className="primary-btn gmail-connect-button" href="/api/gmail/connect">Connect Gmail</a>
        </section>
      )}
    </main>
  );
}
