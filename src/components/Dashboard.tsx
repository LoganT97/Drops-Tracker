"use client";

import { Fragment, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { money, pct } from "@/lib/roi";
import { BRANDS, RETAILERS, type RetailerKey } from "@/lib/retailers";
import AddProduct from "./AddProduct";
import EditableCell from "./EditableCell";
import ProductDetail from "./ProductDetail";
import AuditHistory from "./AuditHistory";
import ActiveUsers from "./ActiveUsers";
import ImportDrops from "./ImportDrops";
import AdminPanel from "./AdminPanel";
import WatchlistHeart from "./WatchlistHeart";
import { useToast } from "./ToastProvider";
import LoadingSpinner from "./LoadingSpinner";

export type Bucket = "negative" | "low" | "mid" | "high" | "unknown";
type SyncProgress = {
  active: boolean;
  percent: number;
  stage: string;
  processedGroups: number;
  totalGroups: number;
  error: string | null;
};
type BackfillProgress = {
  active: boolean;
  percent: number;
  stage: string;
  processedDays: number;
  totalDays: number;
  snapshots: number;
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
  history: Array<{ date: string; marketPrice: number | null; retailPrice: number | null }>;
  dropDates: string[];
  lastDropDate: string | null;
  watched: boolean;
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

type SortKey = "productName" | "sku" | "lastDropDate" | "retailPrice" | "cost" | "marketPrice" | "grossRoi" | "netProfit";

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

function compactDate(date: string | null): string {
  if (!date) return "—";
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
    month: "numeric",
    day: "numeric",
    year: "2-digit",
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
  const { showToast } = useToast();
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
  const [backfilling, setBackfilling] = useState(false);
  const [backfillProgress, setBackfillProgress] = useState<BackfillProgress | null>(null);
  const [backfillNote, setBackfillNote] = useState<string | null>(null);
  const [dropImportOpen, setDropImportOpen] = useState(false);
  const [adminPanelOpen, setAdminPanelOpen] = useState(false);
  const [watchlistOnly, setWatchlistOnly] = useState(false);
  const [watchedIds, setWatchedIds] = useState<Set<string>>(() => new Set(rows.filter((row) => row.watched).map((row) => row.id)));
  const [watchBusyIds, setWatchBusyIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    setWatchedIds(new Set(rows.filter((row) => row.watched).map((row) => row.id)));
  }, [rows]);

  useEffect(() => {
    if (!canEdit || !syncing) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch("/api/tcg/sync/status", { cache: "no-store" });
        if (!response.ok) return;
        const progress: SyncProgress = await response.json();
        if (cancelled) return;
        setSyncProgress(progress);
        if (!progress.active) setSyncing(false);
      } catch {}
    };
    const timer = window.setInterval(() => void poll(), 1000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [canEdit, syncing]);

  useEffect(() => {
    if (!canEdit || !backfilling) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch("/api/tcg/backfill/status", { cache: "no-store" });
        if (!response.ok) return;
        const progress: BackfillProgress = await response.json();
        if (cancelled) return;
        setBackfillProgress(progress);
        if (!progress.active) setBackfilling(false);
      } catch {}
    };
    const timer = window.setInterval(() => void poll(), 1000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [canEdit, backfilling]);

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
    if (watchlistOnly) list = list.filter((row) => watchedIds.has(row.id));
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
  }, [rows, roiFilters, sort, selectedBrands, minProfit, minRoiPercent, searchQuery, watchlistOnly, watchedIds]);

  function toggleRoiFilter(bucket: Bucket | "all") {
    if (bucket === "all") {
      setRoiFilters(new Set());
      setWatchlistOnly(false);
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
    showToast(`${list.length} SKU${list.length === 1 ? "" : "s"} copied.`);
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
    showToast(`${list.length} SKU${list.length === 1 ? "" : "s"} copied.`);
    setTimeout(() => setCopied(null), 1600);
  }

  function copyWatchlist() {
    const list = rows.filter((row) => watchedIds.has(row.id));
    navigator.clipboard.writeText(formatSkuList(list.map((row) => row.sku)));
    setCopied("watchlist");
    showToast(`${list.length} watchlist SKU${list.length === 1 ? "" : "s"} copied.`);
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
      const message = (await res.json()).error ?? "That change didn't save.";
      setError(message);
      showToast(message, "error");
      return false;
    }
    showToast("Product updated.");
    startTransition(() => router.refresh());
    return true;
  }

  async function remove(id: string, name: string) {
    if (!confirm(`Stop tracking ${name}?`)) return;
    const response = await fetch(`/api/products/${id}`, { method: "DELETE" });
    if (!response.ok) return showToast("Couldn't remove that product.", "error");
    showToast(`${name} removed.`);
    startTransition(() => router.refresh());
  }

  async function toggleWatchlist(id: string) {
    if (watchBusyIds.has(id)) return;
    const watched = !watchedIds.has(id);
    setWatchBusyIds((current) => new Set(current).add(id));
    setWatchedIds((current) => {
      const next = new Set(current);
      watched ? next.add(id) : next.delete(id);
      return next;
    });
    try {
      const response = await fetch(`/api/watchlist/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ watched }),
      });
      if (response.ok) {
        showToast(watched ? "Added to your watchlist." : "Removed from your watchlist.");
        return;
      }
      throw new Error();
    } catch {
      setWatchedIds((current) => {
        const next = new Set(current);
        watched ? next.delete(id) : next.add(id);
        return next;
      });
      setError("Couldn't update your watchlist.");
      showToast("Couldn't update your watchlist.", "error");
    } finally {
      setWatchBusyIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
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
      showToast("The TCGplayer sync request failed.", "error");
      return;
    }
    setSyncing(false);

    if (!res.ok) {
      const message = typeof json.error === "string" ? json.error : "Sync failed.";
      setSyncNote(message);
      showToast(message, "error");
      return;
    }
    setSyncNote(
      json.skipped
        ? "Already up to date — TCGCSV refreshes once a day."
        : `Cached ${json.products ?? 0} products. Updated ${json.linkedUpdated ?? 0} of your SKUs.`,
    );
    showToast(json.skipped ? "TCGplayer prices are already current." : "TCGplayer prices updated.");
    startTransition(() => router.refresh());
  }

  async function backfillAllPrices() {
    setBackfilling(true);
    setBackfillNote(null);
    setBackfillProgress({ active: true, percent: 1, stage: "Preparing backfill…", processedDays: 0, totalDays: 30, snapshots: 0, error: null });
    try {
      const response = await fetch("/api/tcg/backfill", { method: "POST" });
      const text = await response.text();
      const result = text ? JSON.parse(text) as { snapshots?: number; error?: string } : {};
      setBackfilling(false);
      if (!response.ok) {
        const message = result.error ?? "Price-history backfill failed.";
        setBackfillNote(message);
        showToast(message, "error");
        return;
      }
      setBackfillNote(`Imported ${result.snapshots ?? 0} historical price points. Temporary files were deleted.`);
      showToast(`Imported ${result.snapshots ?? 0} historical price points.`);
      startTransition(() => router.refresh());
    } catch {
      setBackfilling(false);
      setBackfillNote("The backfill request failed. Check the server console.");
      showToast("The price-history backfill request failed.", "error");
    }
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
      showToast("Couldn't save that setting.", "error");
      return;
    }
    setSavedField(field);
    showToast("Setting saved.");
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
            <button className="ghost-btn active-users-button" onClick={() => setUsersOpen(true)}>
              Active Users
            </button>
            <button className="admin-panel-button" onClick={() => setAdminPanelOpen(true)}>
              Admin Panel
            </button>
          </div>
        </div>
      )}

      {effectiveCanEdit && <AddProduct retailer={retailer} />}

      <div className="tiles">
        {TILES.map((t) => (
          <Fragment key={t.key}>
            <div
              className={`tile ${t.cls}`}
              aria-pressed={t.key === "all" ? roiFilters.size === 0 && !watchlistOnly : roiFilters.has(t.key)}
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

            {t.key === "all" && (
              <div className="tile watchlist" aria-pressed={watchlistOnly}>
                <button
                  onClick={() => setWatchlistOnly((current) => !current)}
                  style={{ all: "unset", cursor: "pointer", display: "block", width: "100%" }}
                >
                  <div className="label"><WatchlistHeart filled /> My Watchlist</div>
                  <div className="count">{watchedIds.size}</div>
                </button>
                <button className="ghost-btn" onClick={copyWatchlist} disabled={watchedIds.size === 0}>
                  {copied === "watchlist" ? "Copied" : "Copy watchlist"}
                </button>
              </div>
            )}
          </Fragment>
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

      <div className={`panel sku-table-panel ${effectiveCanEdit ? "admin-table" : "viewer-table"}`}>
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
              <th className="watch-col"><span className="sr-only">Watchlist</span></th>
              <th className="image-col" />
              <th className="product-col" aria-sort={sort.key === "productName" ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} onClick={() => toggleSort("productName")}>
                Product {sortIndicator("productName")}
              </th>
              <th className="hide-sm brand-col">Brand</th>
              <th className="hide-sm sku-col" aria-sort={sort.key === "sku" ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} onClick={() => toggleSort("sku")}>
                {RETAILERS[retailer].skuLabel} {sortIndicator("sku")}
              </th>
              <th className="last-drop-col" aria-sort={sort.key === "lastDropDate" ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} onClick={() => toggleSort("lastDropDate")}>
                Last drop {sortIndicator("lastDropDate")}
              </th>
              <th className="retail-col" aria-sort={sort.key === "retailPrice" ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} onClick={() => toggleSort("retailPrice")}>
                Retail {sortIndicator("retailPrice")}
              </th>
              <th className="cost-col" aria-sort={sort.key === "cost" ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} onClick={() => toggleSort("cost")}>
                Retail (+tax) {sortIndicator("cost")}
              </th>
              <th className="market-col" aria-sort={sort.key === "marketPrice" ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} onClick={() => toggleSort("marketPrice")}>
                Market value {sortIndicator("marketPrice")}
              </th>
              <th className="profit-col" aria-sort={sort.key === "netProfit" ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} onClick={() => toggleSort("netProfit")}>
                Profit / box {sortIndicator("netProfit")}
              </th>
              <th className="roi-col" aria-sort={sort.key === "grossRoi" ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} onClick={() => toggleSort("grossRoi")}>
                Potential ROI {sortIndicator("grossRoi")}
              </th>
              {effectiveCanEdit && <th className="row-actions-col" />}
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
                <td className="watch-col">
                  <button
                    className={`watch-button ${watchedIds.has(r.id) ? "on" : ""}`}
                    onClick={() => void toggleWatchlist(r.id)}
                    aria-label={`${watchedIds.has(r.id) ? "Remove" : "Add"} ${r.productName} ${watchedIds.has(r.id) ? "from" : "to"} watchlist`}
                    title={watchedIds.has(r.id) ? "Remove from watchlist" : "Add to watchlist"}
                  >
                    {watchBusyIds.has(r.id)
                      ? <LoadingSpinner label="Updating watchlist" />
                      : <WatchlistHeart filled={watchedIds.has(r.id)} />}
                  </button>
                </td>
                <td className="image-col">
                  <ImageCell
                    url={r.imageUrl}
                    name={r.productName}
                    canEdit={effectiveCanEdit && !r.linked}
                    onSave={(v) => save(r.id, { imageUrl: v })}
                  />
                </td>
                <td className="product-col">
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
                <td className="hide-sm brand-col">
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
                <td className="hide-sm sku-col">
                  <EditableCell readOnly={!effectiveCanEdit} mono value={r.sku} onSave={(v) => save(r.id, { sku: v })} />
                </td>
                <td className="last-drop-col num muted" title={r.lastDropDate ? new Date(`${r.lastDropDate}T00:00:00`).toLocaleDateString() : "No imported drops"}>
                  {compactDate(r.lastDropDate)}
                </td>
                <td className="retail-col">
                  <EditableCell readOnly={!effectiveCanEdit} mono money value={r.retailPrice} onSave={(v) => save(r.id, { retailPrice: v })} />
                </td>
                <td className="cost-col num muted">{money(r.cost)}</td>
                <td className="market-col">
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
                <td className={`profit-col num profit ${(r.netProfit ?? 0) >= 0 ? "pos" : "neg"}`}>
                  {money(r.netProfit)}
                </td>
                <td className="roi-col"><span className={`roi-pill ${r.bucket}`}>{pct(r.grossRoi)}</span></td>
                {effectiveCanEdit && (
                  <td className="row-actions-col" style={{ whiteSpace: "nowrap" }}>
                    <button
                      className="row-remove"
                      onClick={() => remove(r.id, r.productName)}
                      aria-label={`Stop tracking ${r.productName}`}
                    >
                      ×
                    </button>
                  </td>
                )}
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
                : watchlistOnly
                  ? "Your watchlist is empty. Select a heart beside any product to add it."
                : "No SKUs match the current filters."}
          </div>
        )}
      </div>

      {detailFor && (
        <ProductDetail
          row={detailFor}
          retailer={retailer}
          canEdit={effectiveCanEdit}
          watched={watchedIds.has(detailFor.id)}
          watchBusy={watchBusyIds.has(detailFor.id)}
          onToggleWatchlist={() => toggleWatchlist(detailFor.id)}
          onSave={save}
          onClose={() => setDetailFor(null)}
        />
      )}
      {auditOpen && <AuditHistory onClose={() => setAuditOpen(false)} />}
      {usersOpen && <ActiveUsers onClose={() => setUsersOpen(false)} />}
      {dropImportOpen && <ImportDrops onClose={() => setDropImportOpen(false)} />}
      {adminPanelOpen && (
        <AdminPanel
          rows={rows}
          syncing={syncing}
          backfilling={backfilling}
          syncNote={syncNote}
          backfillNote={backfillNote}
          syncProgress={syncProgress}
          backfillProgress={backfillProgress}
          onSync={() => void syncPrices()}
          onBackfill={() => void backfillAllPrices()}
          onOpenAudit={() => { setAdminPanelOpen(false); setAuditOpen(true); }}
          onImportDrops={() => { setAdminPanelOpen(false); setDropImportOpen(true); }}
          onOpenProduct={(row) => { setAdminPanelOpen(false); setDetailFor(row); }}
          onDataChanged={() => startTransition(() => router.refresh())}
          onClose={() => setAdminPanelOpen(false)}
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
