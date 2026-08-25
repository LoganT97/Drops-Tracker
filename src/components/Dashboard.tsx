"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { money, pct } from "@/lib/roi";
import { BRANDS, RETAILERS, type RetailerKey } from "@/lib/retailers";
import AddProduct from "./AddProduct";
import EditableCell from "./EditableCell";
import ProductDetail from "./ProductDetail";
import AuditHistory from "./AuditHistory";
import ActiveUsers from "./ActiveUsers";

export type Bucket = "negative" | "low" | "mid" | "high" | "unknown";
type SyncProgress = {
  active: boolean;
  percent: number;
  stage: string;
  processedGroups: number;
  totalGroups: number;
  error: string | null;
};

export type Row = {
  id: string;
  sku: string;
  productName: string;
  brand: string;
  imageUrl: string | null;
  productUrl: string | null;
  notes: string | null;
  prerelease: boolean;
  releaseDate: string | null;
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

type SortKey = "productName" | "sku" | "retailPrice" | "cost" | "marketPrice" | "grossRoi" | "netProfit";

const TILES: Array<{ key: Bucket | "all"; label: string; cls: string }> = [
  { key: "all", label: "All SKUs", cls: "all" },
  { key: "negative", label: "ROI below 0%", cls: "negative" },
  { key: "low", label: "ROI 0–50%", cls: "low" },
  { key: "mid", label: "ROI 50–99%", cls: "mid" },
  { key: "high", label: "ROI 100%+", cls: "high" },
];

const formatSkuList = (skus: string[]) => skus.join(" ,");

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

function releaseDateLabel(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
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
  const [viewMode, setViewMode] = useState<"admin" | "viewer">("admin");
  const effectiveCanEdit = canEdit && viewMode === "admin";
  const [roiFilters, setRoiFilters] = useState<Set<Bucket>>(new Set());
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "grossRoi", dir: "desc" });
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detailFor, setDetailFor] = useState<Row | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedBrands, setSelectedBrands] = useState<Set<string>>(new Set());
  const [minProfit, setMinProfit] = useState<number | null>(null);
  const [minRoiPercent, setMinRoiPercent] = useState<number | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const lastClicked = useRef<number | null>(null);
  const [savedField, setSavedField] = useState<string | null>(null);
  const [zipNote, setZipNote] = useState<string | null>(null);
  const [taxValue, setTaxValue] = useState((settings.taxRate * 100).toFixed(3));
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [auditOpen, setAuditOpen] = useState(false);
  const [usersOpen, setUsersOpen] = useState(false);

  useEffect(() => {
    if (!canEdit) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch("/api/tcg/sync/status", { cache: "no-store" });
        if (!response.ok) return;
        const progress: SyncProgress = await response.json();
        if (cancelled) return;
        if (progress.active || syncProgress?.active) setSyncProgress(progress);
        if (progress.active) setSyncing(true);
        else if (syncProgress?.active) setSyncing(false);
      } catch {
        // A transient status failure should not interrupt the actual sync.
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [canEdit, syncProgress?.active]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length, negative: 0, low: 0, mid: 0, high: 0 };
    rows.forEach((r) => { if (r.bucket in c) c[r.bucket]++; });
    return c;
  }, [rows]);
  const sliderRanges = useMemo(() => {
    const profits = rows.flatMap((r) => r.netProfit == null ? [] : [r.netProfit]);
    const rois = rows.flatMap((r) => r.grossRoi == null ? [] : [r.grossRoi * 100]);
    const profitMin = Math.floor(Math.min(...profits, 0));
    const profitMax = Math.max(profitMin + 1, Math.ceil(Math.max(...profits, 0)));
    const roiMin = Math.floor(Math.min(...rois, 0));
    const roiMax = Math.max(roiMin + 1, Math.ceil(Math.max(...rois, 0)));
    return { profitMin, profitMax, roiMin, roiMax };
  }, [rows]);
  const activeFilterCount = selectedBrands.size
    + (minProfit == null ? 0 : 1)
    + (minRoiPercent == null ? 0 : 1);

  const visible = useMemo(() => {
    let list = roiFilters.size === 0 ? [...rows] : rows.filter((r) => roiFilters.has(r.bucket));
    if (selectedBrands.size > 0) list = list.filter((r) => selectedBrands.has(r.brand));
    if (minProfit != null) list = list.filter((r) => r.netProfit != null && r.netProfit >= minProfit);
    if (minRoiPercent != null) {
      list = list.filter((r) => r.grossRoi != null && r.grossRoi * 100 >= minRoiPercent);
    }
    const query = searchQuery.trim().toLocaleLowerCase();
    if (query) {
      list = list.filter((r) =>
        r.productName.toLocaleLowerCase().includes(query)
        || r.sku.toLocaleLowerCase().includes(query)
        || r.brand.toLocaleLowerCase().includes(query),
      );
    }
    const { key, dir } = sort;
    return list.sort((a, b) => {
      const av = a[key], bv = b[key];
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = typeof av === "string"
        ? av.localeCompare(bv as string, undefined, { numeric: true, sensitivity: "base" })
        : (av as number) - (bv as number);
      return dir === "asc" ? cmp : -cmp;
    });
  }, [rows, roiFilters, sort, selectedBrands, minProfit, minRoiPercent, searchQuery]);

  function toggleRoiFilter(bucket: Bucket | "all") {
    if (bucket === "all") {
      setRoiFilters(new Set());
      return;
    }
    setRoiFilters((previous) => {
      const next = new Set(previous);
      next.has(bucket) ? next.delete(bucket) : next.add(bucket);
      return next;
    });
  }

  function toggleBrand(brand: string) {
    setSelectedBrands((prev) => {
      const next = new Set(prev);
      next.has(brand) ? next.delete(brand) : next.add(brand);
      return next;
    });
  }

  function clearFilters() {
    setSelectedBrands(new Set());
    setMinProfit(null);
    setMinRoiPercent(null);
  }

  function copySkuList() {
    const list = selected.size > 0 ? rows.filter((r) => selected.has(r.id)) : visible;
    navigator.clipboard.writeText(formatSkuList(list.map((r) => r.sku)));
    setCopied("filtered");
    setTimeout(() => setCopied(null), 1600);
  }

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

  function copySkus(bucket: Bucket | "all") {
    const list = bucket === "all" ? rows : rows.filter((r) => r.bucket === bucket);
    navigator.clipboard.writeText(formatSkuList(list.map((r) => r.sku)));
    setCopied(bucket);
    setTimeout(() => setCopied(null), 1600);
  }

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }));
  }

  function sortIndicator(key: SortKey) {
    return (
      <span className={`sort-indicator ${sort.key === key ? "active" : ""}`} aria-hidden="true">
        {sort.key === key ? (sort.dir === "desc" ? "▼" : "▲") : "↕"}
      </span>
    );
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
    setSyncProgress({ active: true, percent: 1, stage: "Starting sync…", processedGroups: 0, totalGroups: 0, error: null });

    let res: Response;
    let json: Record<string, unknown>;
    try {
      res = await fetch("/api/tcg/sync", { method: "POST" });
      const text = await res.text();
      json = text ? JSON.parse(text) : {};
    } catch {
      setSyncing(false);
      setSyncProgress((current) => current ? { ...current, active: false, error: "The sync request failed." } : null);
      setSyncNote("The sync request failed. Check the server console.");
      return;
    }
    setSyncing(false);

    if (!res.ok) {
      setSyncNote(typeof json.error === "string" ? json.error : "Sync failed.");
      return;
    }
    setSyncNote(
      json.skipped
        ? "Already up to date — TCGCSV refreshes once a day."
        : `Cached ${json.products ?? 0} products. Updated ${json.linkedUpdated ?? 0} of your SKUs.`,
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
      {canEdit && (
        <div className="admin-controls">
          <div className="admin-toolbar">
            <div className="admin-view-selector">
              <label htmlFor="admin-view-mode">View as</label>
              <select
                id="admin-view-mode"
                value={viewMode}
                onChange={(e) => setViewMode(e.target.value as "admin" | "viewer")}
              >
                <option value="admin">Admin View</option>
                <option value="viewer">Viewer View</option>
              </select>
            </div>
            <button className="ghost-btn audit-history-button" onClick={() => setAuditOpen(true)}>
              Audit History
            </button>
            <button className="ghost-btn active-users-button" onClick={() => setUsersOpen(true)}>
              Active Users
            </button>
            <button className="ghost-btn admin-sync-button" onClick={syncPrices} disabled={syncing}>
              {syncing ? "Syncing prices…" : "Scan TCGplayer prices"}
            </button>
          </div>
          {syncNote && <p className="admin-sync-note">{syncNote}</p>}
          {syncing && syncProgress && (
            <div className="sync-progress admin-sync-progress" aria-live="polite">
              <div className="sync-progress-head">
                <span>{syncProgress.stage}</span>
                <strong>{syncProgress.percent}%</strong>
              </div>
              <div className="sync-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={syncProgress.percent}>
                <span style={{ width: `${syncProgress.percent}%` }} />
              </div>
              {syncProgress.totalGroups > 0 && (
                <span className="sync-progress-count">
                  {syncProgress.processedGroups} of {syncProgress.totalGroups} sets processed
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {effectiveCanEdit && <AddProduct retailer={retailer} />}

      <div className="tiles">
        {TILES.map((t) => (
          <div
            key={t.key}
            className={`tile ${t.cls}`}
            aria-pressed={t.key === "all" ? roiFilters.size === 0 : roiFilters.has(t.key)}
          >
            <button
              onClick={() => toggleRoiFilter(t.key)}
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

      <div className="sku-tools-row">
        <label className="sku-search">
          <span className="sr-only">Search products or {RETAILERS[retailer].skuLabel}</span>
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={`Search products or ${RETAILERS[retailer].skuLabel}`}
          />
        </label>

        <button className="primary-btn sku-create-button" onClick={copySkuList}>
          {copied === "filtered" ? "Copied" : `Create SKU List (${selected.size > 0 ? selected.size : visible.length})`}
        </button>

        <div className={`sku-filters ${filtersOpen ? "open" : "collapsed"}`}>
          <div className="sku-filters-head">
            <button
              className="sku-filters-toggle"
              onClick={() => {
                setFiltersOpen((open) => !open);
                setSettingsOpen(false);
              }}
              aria-expanded={filtersOpen}
              aria-controls="sku-filter-options"
            >
              <span className="filter-chevron" aria-hidden="true">›</span>
              <span>Filters</span>
              {activeFilterCount > 0 && <span className="active-filter-count">{activeFilterCount}</span>}
            </button>
            {activeFilterCount > 0 && (
              <button className="filter-clear-inline" onClick={clearFilters}>Clear all</button>
            )}
          </div>

          {filtersOpen && (
            <div className="sku-filters-body" id="sku-filter-options">
              <div className="filter-group-label">Brand</div>
              <div className="brand-pills">
                {BRANDS.map((b) => (
                  <button
                    key={b}
                    className={`brand-pill ${selectedBrands.has(b) ? "on" : ""}`}
                    onClick={() => toggleBrand(b)}
                  >
                    {b}
                  </button>
                ))}
              </div>

              <div className="filter-sliders">
                <label className="filter-slider">
                  <span className="filter-slider-head">
                    <span>Minimum profit / box</span>
                    <output>{minProfit == null ? "Any" : money(minProfit)}</output>
                  </span>
                  <input
                    type="range"
                    min={sliderRanges.profitMin}
                    max={sliderRanges.profitMax}
                    step="1"
                    value={minProfit ?? sliderRanges.profitMin}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      setMinProfit(value === sliderRanges.profitMin ? null : value);
                    }}
                  />
                </label>

                <label className="filter-slider">
                  <span className="filter-slider-head">
                    <span>Minimum potential ROI</span>
                    <output>{minRoiPercent == null ? "Any" : `${minRoiPercent.toFixed(0)}%`}</output>
                  </span>
                  <input
                    type="range"
                    min={sliderRanges.roiMin}
                    max={sliderRanges.roiMax}
                    step="1"
                    value={minRoiPercent ?? sliderRanges.roiMin}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      setMinRoiPercent(value === sliderRanges.roiMin ? null : value);
                    }}
                  />
                </label>
              </div>
            </div>
          )}
        </div>

        <div className={`sku-filters sku-settings ${settingsOpen ? "open" : "collapsed"}`}>
          <div className="sku-filters-head">
            <button
              className="sku-filters-toggle"
              onClick={() => {
                setSettingsOpen((open) => !open);
                setFiltersOpen(false);
              }}
              aria-expanded={settingsOpen}
              aria-controls="sku-settings-options"
            >
              <span className="filter-chevron" aria-hidden="true">›</span>
              <span>Settings</span>
            </button>
          </div>

          {settingsOpen && (
            <div className="sku-filters-body settings-body" id="sku-settings-options">
              <div className="controls settings-controls">
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
                {pending && <span className="muted" style={{ fontSize: 13 }}>Saving…</span>}
              </div>

              {zipNote && <p className="settings-note">{zipNote}</p>}
              <p className="settings-note">
                TCGplayer prices last synced{" "}
                <span title={lastSyncedAt ? exact(lastSyncedAt) : "no sync has run yet"}>
                  {ago(lastSyncedAt)}
                </span>
                . TCGCSV rebuilds once a day.
              </p>
            </div>
          )}
        </div>

      </div>

      {error && <p style={{ color: "var(--red)", fontSize: 13 }}>{error}</p>}

      <div className="panel sku-table-panel">
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
              <th aria-sort={sort.key === "productName" ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} onClick={() => toggleSort("productName")}>
                Product {sortIndicator("productName")}
              </th>
              <th className="hide-sm">Brand</th>
              <th className="hide-sm" aria-sort={sort.key === "sku" ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} onClick={() => toggleSort("sku")}>
                {RETAILERS[retailer].skuLabel} {sortIndicator("sku")}
              </th>
              <th aria-sort={sort.key === "retailPrice" ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} onClick={() => toggleSort("retailPrice")}>
                Retail {sortIndicator("retailPrice")}
              </th>
              <th aria-sort={sort.key === "cost" ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} onClick={() => toggleSort("cost")}>
                Retail (+tax) {sortIndicator("cost")}
              </th>
              <th aria-sort={sort.key === "marketPrice" ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} onClick={() => toggleSort("marketPrice")}>
                Market value {sortIndicator("marketPrice")}
              </th>
              <th aria-sort={sort.key === "netProfit" ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} onClick={() => toggleSort("netProfit")}>
                Profit / box {sortIndicator("netProfit")}
              </th>
              <th aria-sort={sort.key === "grossRoi" ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} onClick={() => toggleSort("grossRoi")}>
                Potential ROI {sortIndicator("grossRoi")}
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
                    canEdit={effectiveCanEdit && !r.linked}
                    onSave={(v) => save(r.id, { imageUrl: v })}
                  />
                </td>
                <td>
                  <div className="product-name-cell">
                    <button className="name-link" onClick={() => setDetailFor(r)}>
                      {r.productName}
                    </button>
                    {r.prerelease && (
                      <div className="prerelease-meta">
                        <span className="prerelease-badge">Prerelease</span>
                        {r.releaseDate && <span className="prerelease-date">{releaseDateLabel(r.releaseDate)}</span>}
                      </div>
                    )}
                  </div>
                </td>
                <td className="hide-sm">
                  {effectiveCanEdit ? (
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
                  <EditableCell readOnly={!effectiveCanEdit} mono value={r.sku} onSave={(v) => save(r.id, { sku: v })} />
                </td>
                <td>
                  <EditableCell readOnly={!effectiveCanEdit} mono money value={r.retailPrice} onSave={(v) => save(r.id, { retailPrice: v })} />
                </td>
                <td className="num muted">{money(r.cost)}</td>
                <td>
                  <EditableCell
                    readOnly={!effectiveCanEdit || r.linked}
                    mono money value={r.marketPrice} placeholder={effectiveCanEdit ? "add" : "—"}
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
                  {effectiveCanEdit && (
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
              ? effectiveCanEdit
                ? `No ${RETAILERS[retailer].label} SKUs yet. Paste a product link above to add your first.`
                : `No ${RETAILERS[retailer].label} SKUs are being tracked yet.`
              : searchQuery.trim()
                ? "No SKUs match your search."
                : "No SKUs match the current filters."}
          </div>
        )}
      </div>

      {detailFor && (
        <ProductDetail
          row={detailFor}
          retailer={retailer}
          canEdit={effectiveCanEdit}
          onSave={save}
          onClose={() => setDetailFor(null)}
        />
      )}
      {auditOpen && <AuditHistory onClose={() => setAuditOpen(false)} />}
      {usersOpen && <ActiveUsers onClose={() => setUsersOpen(false)} />}
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
