"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { money, pct } from "@/lib/roi";
import { BRANDS, RETAILERS, type RetailerKey } from "@/lib/retailers";
import AddProduct from "./AddProduct";
import EditableCell from "./EditableCell";

export type Bucket = "negative" | "low" | "mid" | "high" | "unknown";

export type Row = {
  id: string;
  sku: string;
  productName: string;
  brand: string;
  imageUrl: string | null;
  productUrl: string | null;
  notes: string | null;
  retailPrice: number | null;
  marketPrice: number | null;
  cost: number | null;
  grossProfit: number | null;
  grossRoi: number | null;
  netProfit: number | null;
  netRoi: number | null;
  bucket: Bucket;
};

type SortKey = "productName" | "retailPrice" | "cost" | "marketPrice" | "grossRoi" | "netProfit";

const TILES: Array<{ key: Bucket | "all"; label: string; cls: string }> = [
  { key: "all", label: "All SKUs", cls: "all" },
  { key: "negative", label: "ROI below 0%", cls: "negative" },
  { key: "low", label: "ROI 0–50%", cls: "low" },
  { key: "mid", label: "ROI 50–99%", cls: "mid" },
  { key: "high", label: "ROI 100%+", cls: "high" },
];

export default function Dashboard({
  retailer,
  rows,
  settings,
  canEdit,
}: {
  retailer: RetailerKey;
  rows: Row[];
  settings: { taxRate: number; feePct: number; shippingCost: number };
  /** ADMIN only. Viewers get the same numbers, just not the pencil. */
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [filter, setFilter] = useState<Bucket | "all">("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "grossRoi", dir: "desc" });
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length, negative: 0, low: 0, mid: 0, high: 0 };
    rows.forEach((r) => { if (r.bucket in c) c[r.bucket]++; });
    return c;
  }, [rows]);

  const visible = useMemo(() => {
    const list = filter === "all" ? [...rows] : rows.filter((r) => r.bucket === filter);
    const { key, dir } = sort;
    return list.sort((a, b) => {
      const av = a[key], bv = b[key];
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return dir === "asc" ? cmp : -cmp;
    });
  }, [rows, filter, sort]);

  function copySkus(bucket: Bucket | "all") {
    const list = bucket === "all" ? rows : rows.filter((r) => r.bucket === bucket);
    navigator.clipboard.writeText(list.map((r) => r.sku).join("\n"));
    setCopied(bucket);
    setTimeout(() => setCopied(null), 1600);
  }

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }));
  }

  async function save(id: string, patch: Record<string, unknown>) {
    setError(null);
    const res = await fetch(`/api/products/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      setError((await res.json()).error ?? "That change didn't save.");
      return false;
    }
    startTransition(() => router.refresh());
    return true;
  }

  async function remove(id: string, name: string) {
    if (!confirm(`Stop tracking ${name}?`)) return;
    await fetch(`/api/products/${id}`, { method: "DELETE" });
    startTransition(() => router.refresh());
  }

  async function saveSettings(patch: Record<string, number>) {
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    startTransition(() => router.refresh());
  }

  return (
    <>
      {canEdit && <AddProduct retailer={retailer} />}

      <div className="tiles">
        {TILES.map((t) => (
          <div key={t.key} className={`tile ${t.cls}`} aria-pressed={filter === t.key}>
            <button
              onClick={() => setFilter(t.key)}
              style={{ all: "unset", cursor: "pointer", display: "block", width: "100%" }}
            >
              <div className="label">{t.label}</div>
              <div className="count">{counts[t.key] ?? 0}</div>
            </button>
            <button className="ghost-btn" onClick={() => copySkus(t.key)}>
              {copied === t.key ? "Copied" : "Copy all SKUs"}
            </button>
          </div>
        ))}
      </div>

      <div className="controls">
        <div className="field">
          <label htmlFor="tax">Sales tax %</label>
          <input
            id="tax" type="number" step="0.001"
            defaultValue={(settings.taxRate * 100).toFixed(3)}
            onBlur={(e) => saveSettings({ taxRate: Number(e.target.value) / 100 })}
          />
        </div>
        <div className="field">
          <label htmlFor="fee">Marketplace fee %</label>
          <input
            id="fee" type="number" step="0.01"
            defaultValue={(settings.feePct * 100).toFixed(2)}
            onBlur={(e) => saveSettings({ marketplaceFeePct: Number(e.target.value) / 100 })}
          />
        </div>
        <div className="field">
          <label htmlFor="ship">Ship cost per box</label>
          <input
            id="ship" type="number" step="0.01"
            defaultValue={settings.shippingCost.toFixed(2)}
            onBlur={(e) => saveSettings({ shippingCost: Number(e.target.value) })}
          />
        </div>
        {pending && <span className="muted" style={{ fontSize: 13 }}>Saving…</span>}
      </div>

      {error && <p style={{ color: "var(--red)", fontSize: 13 }}>{error}</p>}

      <div className="panel">
        <table>
          <thead>
            <tr>
              <th />
              <th onClick={() => toggleSort("productName")}>Product</th>
              <th className="hide-sm">Brand</th>
              <th className="hide-sm">{RETAILERS[retailer].skuLabel}</th>
              <th onClick={() => toggleSort("retailPrice")}>Retail</th>
              <th onClick={() => toggleSort("cost")}>Retail (+tax)</th>
              <th onClick={() => toggleSort("marketPrice")}>Market value</th>
              <th onClick={() => toggleSort("netProfit")}>Profit / box</th>
              <th onClick={() => toggleSort("grossRoi")}>
                Potential ROI {sort.key === "grossRoi" ? (sort.dir === "desc" ? "▼" : "▲") : ""}
              </th>
              <th />
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.id}>
                <td>
                  <ImageCell
                    url={r.imageUrl}
                    name={r.productName}
                    canEdit={canEdit}
                    onSave={(v) => save(r.id, { imageUrl: v })}
                  />
                </td>
                <td>
                  <EditableCell
                    readOnly={!canEdit}
                    value={r.productName}
                    onSave={(v) => save(r.id, { productName: v })}
                  />
                  {r.productUrl && (
                    <a className="row-link" href={r.productUrl} target="_blank" rel="noreferrer">
                      open ↗
                    </a>
                  )}
                </td>
                <td className="hide-sm">
                  {canEdit ? (
                    <select
                      className="cell-brand"
                      value={(BRANDS as readonly string[]).includes(r.brand) ? r.brand : "Other"}
                      onChange={(e) => save(r.id, { brand: e.target.value })}
                    >
                      {BRANDS.map((b) => <option key={b} value={b}>{b}</option>)}
                    </select>
                  ) : (
                    <span className="muted">{r.brand}</span>
                  )}
                </td>
                <td className="hide-sm">
                  <EditableCell readOnly={!canEdit} mono value={r.sku} onSave={(v) => save(r.id, { sku: v })} />
                </td>
                <td>
                  <EditableCell
                    readOnly={!canEdit}
                    mono money
                    value={r.retailPrice}
                    onSave={(v) => save(r.id, { retailPrice: v })}
                  />
                </td>
                <td className="num muted">{money(r.cost)}</td>
                <td>
                  <EditableCell
                    readOnly={!canEdit}
                    mono money
                    value={r.marketPrice}
                    placeholder={canEdit ? "add" : "—"}
                    onSave={(v) => save(r.id, { marketPrice: v })}
                  />
                </td>
                <td className={`num profit ${(r.netProfit ?? 0) >= 0 ? "pos" : "neg"}`}>
                  {money(r.netProfit)}
                </td>
                <td><span className={`roi-pill ${r.bucket}`}>{pct(r.grossRoi)}</span></td>
                <td>
                  {canEdit && (
                    <button
                      className="row-remove"
                      onClick={() => remove(r.id, r.productName)}
                      aria-label={`Stop tracking ${r.productName}`}
                    >
                      ×
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {visible.length === 0 && (
          <div className="empty">
            {rows.length === 0
              ? canEdit
                ? `No ${RETAILERS[retailer].label} SKUs yet. Paste a product link above to add your first.`
                : `No ${RETAILERS[retailer].label} SKUs are being tracked yet.`
              : "No SKUs in this ROI range."}
          </div>
        )}
      </div>
    </>
  );
}

/** Thumbnail that doubles as a paste target for an image address. */
function ImageCell({
  url,
  name,
  canEdit,
  onSave,
}: {
  url: string | null;
  name: string;
  canEdit: boolean;
  onSave: (v: string | null) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);

  if (!canEdit) {
    return url
      ? <img className="thumb" src={url} alt={name} />
      : <span className="thumb" />;
  }

  if (editing) {
    return (
      <input
        autoFocus
        className="cell-input"
        style={{ minWidth: 150 }}
        defaultValue={url ?? ""}
        placeholder="Paste image address"
        onBlur={async (e) => { await onSave(e.target.value.trim() || null); setEditing(false); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setEditing(false);
        }}
      />
    );
  }

  return (
    <button
      className="thumb-btn"
      onClick={() => setEditing(true)}
      title={url ? "Change image" : "Right-click the product photo → Copy image address, then paste here"}
    >
      {url ? <img className="thumb" src={url} alt={name} /> : <span className="thumb empty-thumb">+</span>}
    </button>
  );
}