"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { money, pct } from "@/lib/roi";
import { BRANDS, RETAILERS, type RetailerKey } from "@/lib/retailers";
import AddProduct from "./AddProduct";
import EditableCell from "./EditableCell";
import ProductDetail from "./ProductDetail";

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
  /** True when market price is fed by the nightly TCGplayer sync. */
  linked: boolean;
  /** When this row's price last changed. */
  pricedAt: string;
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

/** "3 hours ago", "2 days ago" — enough precision for daily price data. */
function ago(iso: string | null): string {
  if (!iso) return "never";
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 90) return "just now";
  const mins = secs / 60;
  if (mins < 60) return `${Math.round(mins)} min ago`;
  const hours = mins / 60;
  if (hours < 24) return `${Math.round(hours)} hour${Math.round(hours) === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function exact(iso: string): string {
  return new Date(iso).toLocaleString();
}

export default function Dashboard({
  retailer,
  rows,
  settings,
  canEdit,
  lastSyncedAt,
}: {
  retailer: RetailerKey;
  rows: Row[];
  settings: { taxRate: number; feePct: number; shippingCost: number; postalCode: string };
  /** ADMIN only. Viewers get the same numbers, just not the pencil. */
  canEdit: boolean;
  /** Last successful TCGplayer sync, for the freshness line. */
  lastSyncedAt: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [filter, setFilter] = useState<Bucket | "all">("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "grossRoi", dir: "desc" });
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detailFor, setDetailFor] = useState<Row | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const lastClicked = useRef<number | null>(null);
  const [savedField, setSavedField] = useState<string | null>(null);
  const [zipNote, setZipNote] = useState<string | null>(null);
  const [taxValue, setTaxValue] = useState((settings.taxRate * 100).toFixed(3));
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);

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

  /**
   * Row selection for copying. Shift-click extends from the last click, so you
   * can grab a run of rows without clicking each one.
   */
  function toggleRow(index: number, id: string, shift: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);

      if (shift && lastClicked.current !== null) {
        const [from, to] = [lastClicked.current, index].sort((a, b) => a - b);
        const turningOn = !prev.has(id);
        for (let i = from; i <= to; i++) {
          const rowId = visible[i]?.id;
          if (!rowId) continue;
          if (turningOn) next.add(rowId);
          else next.delete(rowId);
        }
      } else {
        next.has(id) ? next.delete(id) : next.add(id);
      }

      return next;
    });
    lastClicked.current = index;
  }

  const allVisibleSelected = visible.length > 0 && visible.every((r) => selected.has(r.id));

  function toggleAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) visible.forEach((r) => next.delete(r.id));
      else visible.forEach((r) => next.add(r.id));
      return next;
    });
    lastClicked.current = null;
  }

  function copySelected() {
    const skus = rows.filter((r) => selected.has(r.id)).map((r) => r.sku);
    navigator.clipboard.writeText(skus.join("\n"));
    setCopied("selected");
    setTimeout(() => setCopied(null), 1600);
  }

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

  /** Pull fresh TCGplayer prices. Only refetches if TCGCSV has rebuilt. */
  async function syncPrices() {
    setSyncing(true);
    setSyncNote(null);
    const res = await fetch("/api/tcg/sync", { method: "POST" });
    const json = await res.json();
    setSyncing(false);

    if (!res.ok) {
      setSyncNote(json.error ?? "Sync failed.");
      return;
    }
    setSyncNote(
      json.skipped
        ? "Already up to date — TCGCSV refreshes once a day."
        : `Cached ${json.products} products. Updated ${json.linkedUpdated} of your SKUs.`,
    );
    startTransition(() => router.refresh());
  }

  /**
   * Settings live on the user's row, so they persist across sessions, devices,
   * and both boards. Saved on blur or Enter, with a per-field confirmation so
   * it's obvious the value stuck.
   */
  async function saveSettings(field: string, patch: Record<string, number>) {
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      setError("Couldn't save that setting.");
      return;
    }
    setSavedField(field);
    setTimeout(() => setSavedField((f) => (f === field ? null : f)), 1800);
    startTransition(() => router.refresh());
  }

  /**
   * Look a tax rate up from a ZIP or Canadian postal code and fill the tax
   * field in. It's a convenience, not a lock — the rate stays editable, because
   * ZIP boundaries and tax boundaries don't line up and the dataset will
   * occasionally be wrong for a specific store.
   */
  async function lookupZip(code: string) {
    setZipNote(null);
    await saveSettings("zip", { postalCode: code } as never);

    if (!code.trim()) return;

    const res = await fetch(`/api/tax-rate?code=${encodeURIComponent(code)}`);
    if (!res.ok) {
      setZipNote((await res.json()).error ?? "Couldn't find that code.");
      return;
    }

    const found = await res.json();
    setTaxValue((found.rate * 100).toFixed(3));
    await saveSettings("tax", { taxRate: found.rate });
    setZipNote(
      found.unusual
        ? `${found.label} — ${(found.rate * 100).toFixed(3)}%. That's unusually high (special district); check against your receipt.`
        : `${found.label} — ${(found.rate * 100).toFixed(3)}%`,
    );
  }

  /** Enter should commit too — blurring fires the same save path. */
  const commitOnEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") e.currentTarget.blur();
  };

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
          <label htmlFor="zip">
            ZIP / postal code {savedField === "zip" && <span className="saved-tick">saved</span>}
          </label>
          <input
            id="zip"
            style={{ minWidth: 110 }}
            placeholder="60601 or M5V"
            defaultValue={settings.postalCode}
            onKeyDown={commitOnEnter}
            onBlur={(e) => lookupZip(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="tax">
            Sales tax % {savedField === "tax" && <span className="saved-tick">saved</span>}
          </label>
          <input
            id="tax" type="number" step="0.001"
            value={taxValue}
            onChange={(e) => setTaxValue(e.target.value)}
            onKeyDown={commitOnEnter}
            onBlur={(e) => saveSettings("tax", { taxRate: Number(e.target.value) / 100 })}
          />
        </div>
        <div className="field">
          <label htmlFor="fee">
            Marketplace fee % {savedField === "fee" && <span className="saved-tick">saved</span>}
          </label>
          <input
            id="fee" type="number" step="0.01"
            defaultValue={(settings.feePct * 100).toFixed(2)}
            onKeyDown={commitOnEnter}
            onBlur={(e) => saveSettings("fee", { marketplaceFeePct: Number(e.target.value) / 100 })}
          />
        </div>
        {canEdit && (
          <button className="ghost-btn" style={{ width: "auto" }} onClick={syncPrices} disabled={syncing}>
            {syncing ? "Syncing prices…" : "Sync TCGplayer prices"}
          </button>
        )}
        {pending && <span className="muted" style={{ fontSize: 13 }}>Saving…</span>}
      </div>

      {zipNote && <p className="muted" style={{ fontSize: 12 }}>{zipNote}</p>}

      <p className="muted" style={{ fontSize: 12, marginTop: -8 }}>
        TCGplayer prices last synced{" "}
        <span title={lastSyncedAt ? exact(lastSyncedAt) : "no sync has run yet"}>
          {ago(lastSyncedAt)}
        </span>
        . TCGCSV rebuilds once a day.
      </p>

      {syncNote && <p className="muted" style={{ fontSize: 13 }}>{syncNote}</p>}

      {error && <p style={{ color: "var(--red)", fontSize: 13 }}>{error}</p>}

      {selected.size > 0 && (
        <div className="select-bar">
          <span>
            <strong className="num">{selected.size}</strong> selected
          </span>
          <button className="primary-btn" style={{ padding: "7px 14px" }} onClick={copySelected}>
            {copied === "selected" ? "Copied" : "Copy selected SKUs"}
          </button>
          <button className="ghost-btn" style={{ width: "auto" }} onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      )}

      <div className="panel">
        <table>
          <thead>
            <tr>
              <th className="pick-col">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={toggleAllVisible}
                  aria-label="Select all visible SKUs"
                />
              </th>
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
            {visible.map((r, i) => (
              <tr key={r.id} className={selected.has(r.id) ? "picked" : ""}>
                <td className="pick-col">
                  <input
                    type="checkbox"
                    checked={selected.has(r.id)}
                    onChange={() => {}}
                    onClick={(e) => toggleRow(i, r.id, e.shiftKey)}
                    aria-label={`Select ${r.productName}`}
                  />
                </td>
                <td>
                  <ImageCell
                    url={r.imageUrl}
                    name={r.productName}
                    canEdit={canEdit && !r.linked}
                    onSave={(v) => save(r.id, { imageUrl: v })}
                  />
                </td>
                <td>
                  <button className="name-link" onClick={() => setDetailFor(r)}>
                    {r.productName}
                  </button>
                </td>
                <td className="hide-sm">
                  {canEdit ? (
                    <select
                      className="cell-brand"
                      value={r.brand}
                      onChange={(e) => save(r.id, { brand: e.target.value })}
                    >
                      {/* A row saved under an old brand keeps showing it until
                          someone picks a current one, rather than silently
                          displaying the wrong game. */}
                      {!(BRANDS as readonly string[]).includes(r.brand) && (
                        <option value={r.brand} disabled>{r.brand} (retired)</option>
                      )}
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
                  <EditableCell readOnly={!canEdit} mono money value={r.retailPrice} onSave={(v) => save(r.id, { retailPrice: v })} />
                </td>
                <td className="num muted">{money(r.cost)}</td>
                <td>
                  <EditableCell
                    readOnly={!canEdit || r.linked}
                    mono money value={r.marketPrice} placeholder={canEdit ? "add" : "—"}
                    onSave={(v) => save(r.id, { marketPrice: v })}
                  />
                  {r.linked && (
                    <span
                      className="linked-dot"
                      title={`From TCGplayer — unlink to edit by hand. Price set ${exact(r.pricedAt)}.`}
                    >
                      ●
                    </span>
                  )}
                  <span className="priced-at" title={exact(r.pricedAt)}>{ago(r.pricedAt)}</span>
                </td>
                <td className={`num profit ${(r.netProfit ?? 0) >= 0 ? "pos" : "neg"}`}>
                  {money(r.netProfit)}
                </td>
                <td><span className={`roi-pill ${r.bucket}`}>{pct(r.grossRoi)}</span></td>
                <td style={{ whiteSpace: "nowrap" }}>
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

      {detailFor && (
        <ProductDetail
          row={detailFor}
          retailer={retailer}
          canEdit={canEdit}
          onSave={save}
          onClose={() => setDetailFor(null)}
        />
      )}
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
    return url ? <img className="thumb" src={url} alt={name} /> : <span className="thumb" />;
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
