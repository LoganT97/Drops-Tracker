"use client";

import { useEffect, useMemo, useState } from "react";
import type { Row } from "./Dashboard";
import { useToast } from "./ToastProvider";
import LoadingSpinner from "./LoadingSpinner";

type Progress = { active: boolean; percent: number; stage: string } | null;
type UntrackedGroup = { sku: string; dates: string[] };

export default function AdminPanel({
  rows,
  syncing,
  backfilling,
  syncNote,
  backfillNote,
  syncProgress,
  backfillProgress,
  onSync,
  onBackfill,
  onOpenAudit,
  onImportDrops,
  onOpenProduct,
  onDataChanged,
  onClose,
}: {
  rows: Row[];
  syncing: boolean;
  backfilling: boolean;
  syncNote: string | null;
  backfillNote: string | null;
  syncProgress: Progress;
  backfillProgress: Progress;
  onSync: () => void;
  onBackfill: () => void;
  onOpenAudit: () => void;
  onImportDrops: () => void;
  onOpenProduct: (row: Row) => void;
  onDataChanged: () => void;
  onClose: () => void;
}) {
  const { showToast } = useToast();
  const [groups, setGroups] = useState<UntrackedGroup[] | null>(null);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [workingSku, setWorkingSku] = useState<string | null>(null);

  const health = useMemo(() => rows.map((row) => ({ row, issues: productIssues(row) }))
    .filter((entry) => entry.issues.length > 0), [rows]);

  async function loadUntracked() {
    setError(null);
    const response = await fetch("/api/admin/untracked-drops", { cache: "no-store" });
    const json = await response.json();
    if (!response.ok) throw new Error(json.error ?? "Couldn't load unmatched TCINs.");
    setGroups(json.groups);
    setSelections((current) => {
      const next = { ...current };
      for (const group of json.groups as UntrackedGroup[]) {
        const exact = rows.find((row) => row.sku === group.sku);
        if (exact && !next[group.sku]) next[group.sku] = exact.id;
      }
      return next;
    });
  }

  useEffect(() => { void loadUntracked().catch((cause) => setError(cause.message)); }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function resolve(sku: string) {
    const productId = selections[sku];
    if (!productId) return setError("Choose the product these dates belong to.");
    setWorkingSku(sku);
    setError(null);
    const response = await fetch("/api/admin/untracked-drops", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sku, productId }),
    });
    const json = await response.json();
    setWorkingSku(null);
    if (!response.ok) return setError(json.error ?? "Couldn't connect that TCIN.");
    showToast(`${sku} connected and its drop dates were applied.`);
    await loadUntracked();
    onDataChanged();
  }

  async function dismiss(sku: string) {
    if (!confirm(`Delete the saved drop dates for untracked TCIN ${sku}?`)) return;
    setWorkingSku(sku);
    const response = await fetch("/api/admin/untracked-drops", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sku }),
    });
    setWorkingSku(null);
    if (!response.ok) return setError("Couldn't dismiss that TCIN.");
    showToast(`${sku} dismissed.`, "info");
    await loadUntracked();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal admin-panel-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2>Admin panel</h2>
            <p className="muted">Catalog maintenance, imports, history, and price tools.</p>
          </div>
          <button className="ghost-btn compact-btn" onClick={onClose}>Close</button>
        </div>

        {error && <p className="admin-panel-error">{error}</p>}

        <div className="admin-panel-content">
          <section className="admin-panel-section admin-tools-section">
            <div className="admin-section-head">
              <div><h3>Tools & history</h3><p>Imports, catalog history, and TCGplayer price maintenance.</p></div>
            </div>
            <div className="admin-tool-grid">
              <button className="admin-tool-card" onClick={onImportDrops}><strong>Import drop dates</strong><span>Paste alerts or load a Discord export.</span></button>
              <button className="admin-tool-card" onClick={onOpenAudit}><strong>Audit history</strong><span>Review the 100 latest catalog changes.</span></button>
              <button className="admin-tool-card" onClick={onSync} disabled={syncing}><strong>{syncing && <LoadingSpinner label="Scanning prices" />} {syncing ? "Scanning prices…" : "Scan TCGplayer prices"}</strong><span>Refresh linked products from TCGCSV.</span></button>
              <button className="admin-tool-card" onClick={onBackfill} disabled={backfilling}><strong>{backfilling && <LoadingSpinner label="Backfilling prices" />} {backfilling ? "Backfilling…" : "Backfill all prices"}</strong><span>Load 30 days of available price history.</span></button>
            </div>
            {(syncNote || backfillNote) && <div className="admin-tool-notes">{syncNote && <p>{syncNote}</p>}{backfillNote && <p>{backfillNote}</p>}</div>}
            {syncing && syncProgress && <ProgressBar progress={syncProgress} />}
            {backfilling && backfillProgress && <ProgressBar progress={backfillProgress} />}
          </section>

          <section className="admin-panel-section">
            <div className="admin-section-head">
              <div><h3>Product health</h3><p>Products that may need admin attention.</p></div>
              <strong>{health.length} flagged</strong>
            </div>
            {health.length === 0 ? <p className="admin-empty">Every product looks healthy.</p> : (
              <ol className="health-list">
                {health.map(({ row, issues }) => (
                  <li key={row.id}>
                    <button onClick={() => onOpenProduct(row)}>
                      <span><strong>{row.productName}</strong><small>TCIN {row.sku}</small></span>
                      <span className="health-issues">{issues.map((issue) => <em key={issue}>{issue}</em>)}</span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className="admin-panel-section">
            <div className="admin-section-head">
              <div><h3>Untracked TCINs</h3><p>Connect imported dates to a product or dismiss them.</p></div>
              <strong>{groups?.length ?? 0} unresolved</strong>
            </div>
            {groups === null ? <div className="skeleton-list" aria-label="Loading unresolved TCINs"><span /><span /><span /></div> : groups.length === 0 ? <p className="admin-empty">No unresolved TCINs.</p> : (
              <ol className="untracked-list">
                {groups.map((group) => (
                  <li key={group.sku}>
                    <div className="untracked-summary"><strong>{group.sku}</strong><span>{group.dates.length} date{group.dates.length === 1 ? "" : "s"} · latest {formatDate(group.dates[0])}</span></div>
                    <select value={selections[group.sku] ?? ""} onChange={(event) => setSelections((current) => ({ ...current, [group.sku]: event.target.value }))}>
                      <option value="">Choose product…</option>
                      {rows.map((row) => <option key={row.id} value={row.id}>{row.productName} · {row.sku}</option>)}
                    </select>
                    <button className="primary-btn compact-btn" disabled={workingSku === group.sku || !selections[group.sku]} onClick={() => void resolve(group.sku)}>{workingSku === group.sku && <LoadingSpinner label="Connecting TCIN" />} Connect</button>
                    <button className="ghost-btn compact-btn" disabled={workingSku === group.sku} onClick={() => void dismiss(group.sku)}>Dismiss</button>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function ProgressBar({ progress }: { progress: NonNullable<Progress> }) {
  return <div className="sync-progress admin-panel-progress"><div className="sync-progress-head"><span>{progress.stage}</span><strong>{progress.percent}%</strong></div><div className="sync-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent}><span style={{ width: `${progress.percent}%` }} /></div></div>;
}

function productIssues(row: Row) {
  const issues: string[] = [];
  if (!row.linked) issues.push("No TCGplayer link");
  if (!row.imageUrl) issues.push("Missing image");
  if (row.marketPrice == null) issues.push("Missing market price");
  if (!row.releaseDate) issues.push("No release date");
  if (Date.now() - new Date(row.pricedAt).getTime() > 48 * 60 * 60 * 1000) issues.push("Stale price");
  return issues;
}

function formatDate(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
