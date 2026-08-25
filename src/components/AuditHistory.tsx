"use client";

import { useEffect, useState } from "react";

type AuditEntry = {
  id: string;
  actorName: string;
  action: string;
  changes: Record<string, { from: unknown; to: unknown }> | null;
  createdAt: string;
  product: { productName: string; sku: string; retailer: string };
};

export default function AuditHistory({ onClose }: { onClose: () => void }) {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/audit", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Couldn't load audit history.")))
      .then((data) => { if (!cancelled) setEntries(data); })
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
      <div className="modal audit-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2>Audit history</h2>
            <p className="muted">The 100 most recent admin changes across all products.</p>
          </div>
          <button className="ghost-btn" style={{ width: "auto" }} onClick={onClose}>Close</button>
        </div>

        {error && <p style={{ color: "var(--red)" }}>{error}</p>}
        {!entries && !error && <p className="muted">Loading…</p>}
        {entries?.length === 0 && <p className="muted">No recorded admin changes yet.</p>}
        {entries && entries.length > 0 && (
          <ol className="audit-list">
            {entries.map((entry) => (
              <li key={entry.id}>
                <div className="audit-entry-head">
                  <div>
                    <strong>{entry.product.productName}</strong>
                    <span className="audit-product-meta">{entry.product.retailer} · {entry.product.sku}</span>
                  </div>
                  <time title={new Date(entry.createdAt).toLocaleString()}>
                    {new Date(entry.createdAt).toLocaleString()}
                  </time>
                </div>
                <div className="audit-action"><strong>{entry.actorName}</strong> {entry.action} this item</div>
                {entry.changes && <p>{formatAuditChanges(entry.changes)}</p>}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

const LABELS: Record<string, string> = {
  productName: "name",
  sku: "TCIN",
  retailPrice: "retail price",
  marketPrice: "market price",
  imageUrl: "image",
  productUrl: "product link",
  prerelease: "prerelease status",
  releaseDate: "release date",
  tcgProductId: "TCGplayer link",
  active: "tracking status",
};

function formatAuditChanges(changes: AuditEntry["changes"]): string {
  if (!changes) return "";
  return Object.entries(changes)
    .map(([field, value]) => `${LABELS[field] ?? field}: ${formatValue(value.from)} → ${formatValue(value.to)}`)
    .join(" · ");
}

function formatValue(value: unknown): string {
  if (value == null || value === "") return "none";
  if (value === true) return "yes";
  if (value === false) return "no";
  return String(value);
}
