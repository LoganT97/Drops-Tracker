"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import LoadingSpinner from "@/components/LoadingSpinner";
import { useToast } from "@/components/ToastProvider";

export type OrderState = "ORDERED" | "SHIPPED" | "OUT_FOR_DELIVERY" | "DELIVERED" | "CANCELLED" | "DELAYED" | "UNKNOWN";
type OrderRange = "1D" | "7D" | "30D" | "90D" | "MTD" | "YTD" | "1Y" | "CUSTOM" | "ALL";
type TrackingRetailer = "GMAIL" | "LOGAN_MOORE" | "MANUAL" | "POKEMON_CENTER" | "SAMS_CLUB" | "TARGET" | "WALMART";
type TrackingStage = "ALL" | "IN_TRANSIT" | "OUT_FOR_DELIVERY" | "DELIVERED" | "LATE";
type TrackingSort = "STATUS" | "ARRIVING" | "RECENT";
export type OrderRow = {
  id: string;
  orderNumber: string;
  status: OrderState;
  orderDate: string | null;
  total: number | null;
  accountEmail: string | null;
  lastUpdateAt: string | null;
  items: Array<{
    id: string;
    productName: string;
    sku: string | null;
    quantity: number;
    unitPrice: number | null;
    totalPrice: number | null;
    imageUrl: string | null;
  }>;
  shipments: Array<{
    id: string;
    trackingNumber: string;
    carrier: string | null;
    status: OrderState;
    shippedAt: string | null;
    deliveredAt: string | null;
  }>;
  history: Array<{
    id: string;
    subject: string;
    status: OrderState | null;
    receivedAt: string;
  }>;
};

type UpsTrackingResult = {
  source: "UPS";
  trackingNumber: string;
  currentStatus: string | null;
  destination: { name: string | null; formatted: string } | null;
  events: Array<{ id: string; description: string; location: string; occurredAt: string | null }>;
};

const FILTERS: Array<{ key: "ALL" | OrderState; label: string }> = [
  { key: "ALL", label: "All" },
  { key: "ORDERED", label: "Ordered" },
  { key: "SHIPPED", label: "Shipped" },
  { key: "OUT_FOR_DELIVERY", label: "Out for delivery" },
  { key: "DELIVERED", label: "Delivered" },
  { key: "CANCELLED", label: "Cancelled" },
  { key: "DELAYED", label: "Delayed" },
];

const QUICK_RANGES: Array<{ key: OrderRange; label: string }> = [
  { key: "1D", label: "Today" },
  { key: "7D", label: "Last 7 days" },
  { key: "30D", label: "Last 30 days" },
  { key: "90D", label: "Last 90 days" },
  { key: "MTD", label: "Month to date" },
  { key: "YTD", label: "Year to date" },
  { key: "CUSTOM", label: "Custom range" },
  { key: "ALL", label: "All history" },
];
const ORDER_RANGES: OrderRange[] = ["1D", "7D", "30D", "90D", "YTD", "1Y", "ALL"];

const TRACKING_RETAILERS: Array<{ key: TrackingRetailer; label: string; icon: string; className: string }> = [
  { key: "GMAIL", label: "Gmail", icon: "G", className: "gmail" },
  { key: "LOGAN_MOORE", label: "Logan Moore", icon: "S", className: "shopify" },
  { key: "MANUAL", label: "Manual", icon: "+", className: "manual" },
  { key: "POKEMON_CENTER", label: "Pokemon Center", icon: "◉", className: "pokemon" },
  { key: "SAMS_CLUB", label: "Sams Club", icon: "S", className: "sams" },
  { key: "TARGET", label: "Target", icon: "⊙", className: "target" },
  { key: "WALMART", label: "Walmart", icon: "✳", className: "walmart" },
];

const STATUS_STEP: Record<OrderState, number> = {
  UNKNOWN: 0,
  ORDERED: 1,
  DELAYED: 1,
  SHIPPED: 2,
  OUT_FOR_DELIVERY: 3,
  DELIVERED: 4,
  CANCELLED: 0,
};

function statusLabel(status: OrderState) {
  return {
    ORDERED: "Ordered",
    SHIPPED: "Shipped",
    OUT_FOR_DELIVERY: "Out for delivery",
    DELIVERED: "Delivered",
    CANCELLED: "Cancelled",
    DELAYED: "Delayed",
    UNKNOWN: "Processing",
  }[status];
}

function money(value: number | null) {
  return value == null ? "—" : value.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function shortDate(value: string | null) {
  if (!value) return "Date unavailable";
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function orderRowDate(value: string | null) {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  const day = date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${day} · ${time}`;
}

function exactDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function orderTitle(order: OrderRow) {
  if (order.items.length === 0) return `Target order #${order.orderNumber}`;
  if (order.items.length === 1) return order.items[0].productName;
  return `${order.items[0].productName} + ${order.items.length - 1} more`;
}

function deliveryLabel(order: OrderRow) {
  const shipment = order.shipments[0];
  const value = order.status === "DELIVERED" ? shipment?.deliveredAt : shipment?.shippedAt;
  if (order.status === "OUT_FOR_DELIVERY") return "Arriving today";
  if (order.status === "DELAYED") return "Delayed";
  if (order.status === "SHIPPED") return "In transit";
  if (!value) return statusLabel(order.status);
  const date = new Date(value);
  return date.toDateString() === new Date().toDateString()
    ? "Delivered today"
    : `Delivered ${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

function trackingUrl(carrier: string | null, tracking: string) {
  if (carrier === "UPS") return `https://www.ups.com/track?tracknum=${encodeURIComponent(tracking)}`;
  if (carrier === "FedEx") return `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(tracking)}`;
  if (carrier === "USPS") return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(tracking)}`;
  return null;
}

function isTargetTemplateArtwork(name: string) {
  return /target\s+(?:logo|circle|guest|shopper|shopping|customer)|bullseye|customer\s+service|discover|mobile\s+phone|running\s+and\s+playing|social\s+media/i.test(name);
}

function rangeStart(range: OrderRange) {
  const now = new Date();
  if (range === "ALL" || range === "CUSTOM") return null;
  if (range === "MTD") return new Date(now.getFullYear(), now.getMonth(), 1);
  if (range === "YTD") return new Date(now.getFullYear(), 0, 1);
  const days = { "1D": 1, "7D": 7, "30D": 30, "90D": 90, "1Y": 365 }[range];
  return new Date(now.getTime() - days * 86_400_000);
}

export default function OrdersDashboard({
  orders,
  gmail,
  notice,
  page,
}: {
  orders: OrderRow[];
  gmail: {
    email: string;
    lastSyncedAt: string | null;
    error: string | null;
    historyScanned: number;
    historyBackfilledAt: string | null;
  } | null;
  notice: string | null;
  page: "dashboard" | "orders" | "tracking";
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [filter, setFilter] = useState<"ALL" | OrderState>("ALL");
  const [range, setRange] = useState<OrderRange>("ALL");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<OrderRow | null>(null);
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());
  const [dashboardSelectMode, setDashboardSelectMode] = useState(false);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [historyMenuOpen, setHistoryMenuOpen] = useState(false);
  const [stageMenuOpen, setStageMenuOpen] = useState(false);
  const [retailerMenuOpen, setRetailerMenuOpen] = useState(false);
  const [emailMenuOpen, setEmailMenuOpen] = useState(false);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [retailerQuery, setRetailerQuery] = useState("");
  const [emailQuery, setEmailQuery] = useState("");
  const [selectedRetailers, setSelectedRetailers] = useState<Set<TrackingRetailer>>(new Set(["TARGET"]));
  const [selectedEmails, setSelectedEmails] = useState<Set<string>>(new Set());
  const [trackingStage, setTrackingStage] = useState<TrackingStage>("ALL");
  const [trackingSort, setTrackingSort] = useState<TrackingSort>("STATUS");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [draftStart, setDraftStart] = useState("");
  const [draftEnd, setDraftEnd] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [scanProgress, setScanProgress] = useState<{
    processed: number;
    total: number | null;
    historical: boolean;
    more: boolean;
  } | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const autoScanStarted = useRef(false);
  const historyMenuRef = useRef<HTMLDivElement>(null);
  const stageMenuRef = useRef<HTMLDivElement>(null);
  const retailerMenuRef = useRef<HTMLDivElement>(null);
  const emailMenuRef = useRef<HTMLDivElement>(null);
  const sortMenuRef = useRef<HTMLDivElement>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (notice === "connected") showToast("Gmail connected. Scan Target orders to begin.");
    if (notice === "not-configured") showToast("Google Gmail OAuth credentials are not configured.", "error");
    if (notice === "invalid-state" || notice === "error") showToast("Gmail connection failed. Please try again.", "error");
    if (notice) router.replace("/orders", { scroll: false });
  }, [notice, router, showToast]);

  const rangedOrders = useMemo(() => {
    if (range === "CUSTOM") {
      const start = customStart ? new Date(`${customStart}T00:00:00`) : null;
      const end = customEnd ? new Date(`${customEnd}T23:59:59.999`) : null;
      return orders.filter((order) => {
        if (!order.orderDate) return false;
        const date = new Date(order.orderDate);
        return (!start || date >= start) && (!end || date <= end);
      });
    }
    const start = rangeStart(range);
    if (!start) return orders;
    return orders.filter((order) => order.orderDate && new Date(order.orderDate) >= start);
  }, [customEnd, customStart, orders, range]);

  const trackingRetailerOrders = useMemo(
    () => selectedRetailers.has("TARGET") ? rangedOrders : [],
    [rangedOrders, selectedRetailers],
  );

  const counts = useMemo(() => {
    const active = rangedOrders.filter((order) => !["DELIVERED", "CANCELLED"].includes(order.status)).length;
    const delivered = rangedOrders.filter((order) => order.status === "DELIVERED").length;
    const cancelled = rangedOrders.filter((order) => order.status === "CANCELLED").length;
    const completedBase = rangedOrders.length - cancelled;
    const spendOrders = rangedOrders.filter((order) => order.status !== "CANCELLED");
    const spend = spendOrders.reduce((sum, order) => sum + (order.total ?? 0), 0);
    const quantity = spendOrders.reduce(
      (sum, order) => sum + order.items.reduce((itemSum, item) => itemSum + item.quantity, 0),
      0,
    );
    const byDay = new Map<string, number>();
    for (const order of spendOrders) {
      if (!order.orderDate) continue;
      const key = new Date(order.orderDate).toLocaleDateString();
      byDay.set(key, (byDay.get(key) ?? 0) + (order.total ?? 0));
    }
    const biggest = [...byDay.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
    return {
      active,
      delivered,
      cancelled,
      spend,
      quantity,
      average: spendOrders.length > 0 ? spend / spendOrders.length : 0,
      fulfillment: completedBase > 0 ? (delivered / completedBase) * 100 : 0,
      biggest,
    };
  }, [rangedOrders]);

  const trackingStats = useMemo(() => {
    const tracked = trackingRetailerOrders.filter((order) =>
      ["SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED", "DELAYED"].includes(order.status));
    const inTransit = tracked.filter((order) => ["SHIPPED", "OUT_FOR_DELIVERY", "DELAYED"].includes(order.status)).length;
    const delivered = tracked.filter((order) => order.status === "DELIVERED").length;
    const late = tracked.filter((order) => order.status === "DELAYED").length;
    const arrivingToday = tracked.filter((order) => order.status === "OUT_FOR_DELIVERY").length;
    const carriers = new Set(tracked.flatMap((order) => order.shipments.map((shipment) => shipment.carrier).filter(Boolean)));
    return { tracked, inTransit, delivered, late, arrivingToday, carriers };
  }, [trackingRetailerOrders]);

  const trackingEmails = useMemo(() => [...new Set(
    trackingRetailerOrders.map((order) => order.accountEmail).filter((email): email is string => Boolean(email)),
  )].sort((a, b) => a.localeCompare(b)), [trackingRetailerOrders]);

  const stageCounts = useMemo(() => ({
    ALL: trackingStats.tracked.length,
    IN_TRANSIT: trackingStats.tracked.filter((order) => order.status === "SHIPPED").length,
    OUT_FOR_DELIVERY: trackingStats.tracked.filter((order) => order.status === "OUT_FOR_DELIVERY").length,
    DELIVERED: trackingStats.tracked.filter((order) => order.status === "DELIVERED").length,
    LATE: trackingStats.tracked.filter((order) => order.status === "DELAYED").length,
  }), [trackingStats]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const source = page === "tracking" ? trackingRetailerOrders : rangedOrders;
    return source.filter((order) => {
      if (page === "tracking" && !["SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED", "DELAYED"].includes(order.status)) return false;
      if (page === "tracking" && selectedEmails.size > 0 && (!order.accountEmail || !selectedEmails.has(order.accountEmail))) return false;
      if (page === "tracking" && trackingStage === "IN_TRANSIT" && order.status !== "SHIPPED") return false;
      if (page === "tracking" && trackingStage === "OUT_FOR_DELIVERY" && order.status !== "OUT_FOR_DELIVERY") return false;
      if (page === "tracking" && trackingStage === "DELIVERED" && order.status !== "DELIVERED") return false;
      if (page === "tracking" && trackingStage === "LATE" && order.status !== "DELAYED") return false;
      if (filter !== "ALL" && order.status !== filter) return false;
      if (!needle) return true;
      return [
        order.orderNumber,
        order.accountEmail ?? "",
        ...order.items.flatMap((item) => [item.productName, item.sku ?? ""]),
        ...order.shipments.map((shipment) => shipment.trackingNumber),
      ].some((value) => value.toLowerCase().includes(needle));
    });
  }, [filter, page, query, rangedOrders, selectedEmails, trackingRetailerOrders, trackingStage]);

  const sortedVisible = useMemo(() => {
    if (page !== "tracking") return visible;
    return [...visible].sort((a, b) => {
      if (trackingSort === "RECENT") {
        return new Date(b.lastUpdateAt ?? b.orderDate ?? 0).getTime() - new Date(a.lastUpdateAt ?? a.orderDate ?? 0).getTime();
      }
      if (trackingSort === "ARRIVING") {
        const priority: Record<OrderState, number> = {
          OUT_FOR_DELIVERY: 0,
          SHIPPED: 1,
          DELAYED: 2,
          DELIVERED: 3,
          ORDERED: 4,
          CANCELLED: 5,
          UNKNOWN: 6,
        };
        const aDate = a.shipments[0]?.deliveredAt ?? a.shipments[0]?.shippedAt ?? a.lastUpdateAt ?? a.orderDate;
        const bDate = b.shipments[0]?.deliveredAt ?? b.shipments[0]?.shippedAt ?? b.lastUpdateAt ?? b.orderDate;
        return priority[a.status] - priority[b.status]
          || new Date(aDate ?? "9999-12-31").getTime() - new Date(bDate ?? "9999-12-31").getTime();
      }
      return STATUS_STEP[b.status] - STATUS_STEP[a.status]
        || new Date(b.lastUpdateAt ?? b.orderDate ?? 0).getTime() - new Date(a.lastUpdateAt ?? a.orderDate ?? 0).getTime();
    });
  }, [page, trackingSort, visible]);

  useEffect(() => {
    if (!historyMenuOpen && !stageMenuOpen && !retailerMenuOpen && !emailMenuOpen && !sortMenuOpen) return;
    function closeFilterMenus(event: MouseEvent) {
      const target = event.target as Node;
      if (!historyMenuRef.current?.contains(target)) setHistoryMenuOpen(false);
      if (!stageMenuRef.current?.contains(target)) setStageMenuOpen(false);
      if (!retailerMenuRef.current?.contains(target)) setRetailerMenuOpen(false);
      if (!emailMenuRef.current?.contains(target)) setEmailMenuOpen(false);
      if (!sortMenuRef.current?.contains(target)) setSortMenuOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setHistoryMenuOpen(false);
      setStageMenuOpen(false);
      setRetailerMenuOpen(false);
      setEmailMenuOpen(false);
      setSortMenuOpen(false);
    }
    document.addEventListener("mousedown", closeFilterMenus);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeFilterMenus);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [emailMenuOpen, historyMenuOpen, retailerMenuOpen, sortMenuOpen, stageMenuOpen]);

  const retailerLabel = selectedRetailers.size === 0
    ? "None"
    : selectedRetailers.size === 1
      ? TRACKING_RETAILERS.find((retailer) => selectedRetailers.has(retailer.key))?.label ?? "1 selected"
      : `${selectedRetailers.size} selected`;
  const matchingRetailers = TRACKING_RETAILERS.filter((retailer) =>
    retailer.label.toLowerCase().includes(retailerQuery.trim().toLowerCase()));
  const matchingEmails = trackingEmails.filter((email) => email.toLowerCase().includes(emailQuery.trim().toLowerCase()));
  const historyLabel = QUICK_RANGES.find((item) => item.key === range)?.label ?? "All history";
  const stageLabel = trackingStage === "ALL" ? "All" : {
    IN_TRANSIT: "In Transit",
    OUT_FOR_DELIVERY: "Out for Delivery",
    DELIVERED: "Delivered",
    LATE: "Late",
  }[trackingStage];
  const emailLabel = selectedEmails.size === 0 ? "All" : selectedEmails.size === 1 ? [...selectedEmails][0] : `${selectedEmails.size} selected`;
  const sortLabel = trackingSort === "STATUS" ? "By status" : trackingSort === "ARRIVING" ? "Arriving soonest" : "Recent activity";

  function toggleRetailer(retailer: TrackingRetailer) {
    setSelectedRetailers((current) => {
      const next = new Set(current);
      if (next.has(retailer)) next.delete(retailer);
      else next.add(retailer);
      return next;
    });
  }

  function selectQuickRange(nextRange: OrderRange) {
    if (nextRange === "CUSTOM") {
      setDraftStart(customStart);
      setDraftEnd(customEnd);
      return;
    }
    setRange(nextRange);
    setCustomStart("");
    setCustomEnd("");
    setHistoryMenuOpen(false);
  }

  function applyCustomRange() {
    setCustomStart(draftStart);
    setCustomEnd(draftEnd);
    setRange("CUSTOM");
    setHistoryMenuOpen(false);
  }

  function exportVisibleOrders() {
    const rows = [["Order number", "Status", "Order date", "Account", "Product", "Quantity", "Total"]];
    for (const order of displayedOrders) {
      const quantity = order.items.reduce((sum, item) => sum + item.quantity, 0);
      rows.push([
        order.orderNumber,
        statusLabel(order.status),
        order.orderDate ?? "",
        order.accountEmail ?? "",
        orderTitle(order),
        String(quantity),
        order.total == null ? "" : order.total.toFixed(2),
      ]);
    }
    const csv = rows.map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "target-orders.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  const pageFilters = page === "tracking"
    ? FILTERS.filter((item) => ["ALL", "SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED", "DELAYED"].includes(item.key))
    : FILTERS;
  const displayedOrders = page === "dashboard" ? sortedVisible.slice(0, 50) : sortedVisible;
  const allTrackingSelected = page === "tracking"
    && displayedOrders.length > 0
    && displayedOrders.every((order) => selectedOrderIds.has(order.id));
  const allDashboardSelected = page === "dashboard"
    && visible.length > 0
    && visible.every((order) => selectedOrderIds.has(order.id));

  async function syncOrders(silent = false) {
    const repairIncomplete = !silent && orders.some((order) =>
      order.items.length === 0
      || order.items.some((item) => !item.imageUrl || isTargetTemplateArtwork(item.productName)));
    setSyncing(true);
    setScanProgress({
      processed: gmail?.historyScanned ?? 0,
      total: null,
      historical: !gmail?.historyBackfilledAt,
      more: true,
    });
    try {
      let totalImported = 0;
      let totalScanned = 0;
      let more = true;
      let pages = 0;
      let historyScanned = gmail?.historyScanned ?? 0;

      // Keep each server request small enough for normal hosting timeouts while
      // walking Gmail's complete two-year result set page by page.
      while (more && pages < 25) {
        const response = await fetch("/api/gmail/sync", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ repairIncomplete }),
        });
        const result = await response.json() as {
          imported?: number;
          scanned?: number;
          historyScanned?: number;
          estimatedTotal?: number | null;
          historical?: boolean;
          more?: boolean;
          error?: string;
        };
        if (!response.ok) throw new Error(result.error ?? "Target order scan failed.");
        totalImported += result.imported ?? 0;
        totalScanned += result.scanned ?? 0;
        historyScanned = result.historyScanned ?? historyScanned;
        more = Boolean(result.more);
        setScanProgress({
          processed: result.historical ? historyScanned : totalScanned,
          total: result.estimatedTotal ?? null,
          historical: Boolean(result.historical),
          more,
        });
        pages += 1;
      }

      if (!silent || totalImported > 0 || more) {
        showToast(more
          ? `Scanned ${historyScanned.toLocaleString()} historical Target emails. Run the scan again to continue.`
          : `Target scan complete: ${totalImported} email updates imported from ${totalScanned} scanned.`);
      }
      startTransition(() => router.refresh());
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Target order scan failed.", "error");
    } finally {
      setSyncing(false);
      setScanProgress(null);
    }
  }

  useEffect(() => {
    if (page !== "dashboard" || !gmail || autoScanStarted.current) return;
    const lastScan = gmail.lastSyncedAt ? new Date(gmail.lastSyncedAt).getTime() : 0;
    if (Date.now() - lastScan < 15 * 60_000) return;
    autoScanStarted.current = true;
    void syncOrders(true);
    // Gmail identity and last-sync time are the only server values that should
    // trigger this one-time stale check. syncOrders intentionally stays local.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gmail?.email, gmail?.lastSyncedAt, page]);

  async function disconnectGmail() {
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

  function toggleOrder(id: string) {
    setSelectedOrderIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllTracking() {
    setSelectedOrderIds((current) => {
      const next = new Set(current);
      if (allTrackingSelected) displayedOrders.forEach((order) => next.delete(order.id));
      else displayedOrders.forEach((order) => next.add(order.id));
      return next;
    });
  }

  function toggleAllDashboard() {
    setSelectedOrderIds((current) => {
      const next = new Set(current);
      if (allDashboardSelected) visible.forEach((order) => next.delete(order.id));
      else visible.forEach((order) => next.add(order.id));
      return next;
    });
  }

  function toggleDashboardSelectionMode() {
    setDashboardSelectMode((current) => {
      if (current) setSelectedOrderIds(new Set());
      return !current;
    });
  }

  async function setSelectedStatus(status: OrderState) {
    if (selectedOrderIds.size === 0) return;
    setBulkBusy(true);
    setStatusMenuOpen(false);
    try {
      const response = await fetch("/api/orders/batch", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: [...selectedOrderIds], status }),
      });
      const result = await response.json().catch(() => ({})) as { updated?: number; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Couldn't update the selected orders.");
      showToast(`${result.updated ?? 0} order${result.updated === 1 ? "" : "s"} updated.`);
      setSelectedOrderIds(new Set());
      startTransition(() => router.refresh());
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Couldn't update the selected orders.", "error");
    } finally {
      setBulkBusy(false);
    }
  }

  async function deleteSelectedOrders() {
    if (selectedOrderIds.size === 0) return;
    if (!window.confirm(`Delete ${selectedOrderIds.size} selected order${selectedOrderIds.size === 1 ? "" : "s"}? This also removes their imported email history.`)) return;
    setBulkBusy(true);
    try {
      const response = await fetch("/api/orders/batch", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: [...selectedOrderIds] }),
      });
      const result = await response.json().catch(() => ({})) as { deleted?: number; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Couldn't delete the selected orders.");
      showToast(`${result.deleted ?? 0} order${result.deleted === 1 ? "" : "s"} deleted.`);
      setSelectedOrderIds(new Set());
      startTransition(() => router.refresh());
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Couldn't delete the selected orders.", "error");
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <main className={`orders-shell orders-page-${page}${dashboardSelectMode ? " dashboard-selecting" : ""}`}>
      <div className="orders-heading">
        <div>
          <h1>{page === "dashboard" ? "Dashboard" : page === "tracking" ? "Tracking" : "Orders"}</h1>
          <p>
            {page === "dashboard"
              ? `${orders.length.toLocaleString()} Target ${orders.length === 1 ? "order" : "orders"} tracked`
              : page === "tracking"
                ? `${trackingStats.tracked.length} packages with tracking, ${trackingStats.delivered} delivered`
                : "Search and filter every Target order imported from Gmail."}
          </p>
        </div>
        {page === "dashboard" && <div className="gmail-controls">
          <div className="gmail-actions">
            {gmail ? (
              <>
                <span className="gmail-connected"><i /> {gmail.email}</span>
                <div className="gmail-scan-control">
                  <button className="ghost-btn compact-btn" onClick={() => void syncOrders()} disabled={syncing}>
                    {syncing ? <><LoadingSpinner label="Scanning Target orders" /> Scanning…</> : "Scan Target orders"}
                  </button>
                  {gmail.lastSyncedAt && (
                    <p className="order-sync-note">
                      Last scanned {exactDate(gmail.lastSyncedAt)}
                      {gmail.error && <span> · Last error: {gmail.error}</span>}
                    </p>
                  )}
                </div>
                <button className="ghost-btn compact-btn danger-text" onClick={() => void disconnectGmail()} disabled={disconnecting}>
                  {disconnecting ? "Disconnecting…" : "Disconnect"}
                </button>
              </>
            ) : (
              <a className="primary-btn gmail-connect-button" href="/api/gmail/connect">Connect Gmail</a>
            )}
          </div>
          {syncing && scanProgress && <TargetScanProgress progress={scanProgress} />}
        </div>}
        {page === "tracking" && gmail && (
          <button className="ghost-btn compact-btn tracking-refresh" onClick={() => void syncOrders()} disabled={syncing}>
            {syncing ? <><LoadingSpinner label="Refreshing tracking" /> Refreshing…</> : "↻ Refresh"}
          </button>
        )}
      </div>

      {page === "dashboard" && !gmail && (
        <section className="gmail-empty panel">
          <div className="gmail-mark">G</div>
          <div>
            <h2>Connect Gmail to import Target orders</h2>
            <p>Drops Tracker reads Target order emails and stores only the parsed order details. Raw email bodies are not saved.</p>
          </div>
          <a className="primary-btn gmail-connect-button" href="/api/gmail/connect">Connect Gmail</a>
        </section>
      )}

      {page === "dashboard" && <>
      <section className="orders-overview" aria-label="Order overview">
        <div className="orders-overview-total">
          <span>▣ &nbsp; Total spend · {range === "ALL" ? "Lifetime" : range}</span>
          <strong>{money(counts.spend)}</strong>
          <small>{rangedOrders.length.toLocaleString()} orders · avg {money(counts.average)}</small>
        </div>
        <OverviewMetric label="Orders" value={rangedOrders.length.toLocaleString()} note={range === "ALL" ? "lifetime" : range.toLowerCase()} />
        <OverviewMetric
          label="Quantity"
          value={counts.quantity.toLocaleString()}
          note={`${rangedOrders.length > 0 ? (counts.quantity / rangedOrders.length).toFixed(1) : "0.0"} avg per order`}
        />
        <OverviewMetric label="Fulfillment" value={`${counts.fulfillment.toFixed(1)}%`} note={`${counts.delivered} delivered`} />
      </section>

      <div className="order-range-bar" role="group" aria-label="Dashboard date range">
        {ORDER_RANGES.map((item) => (
          <button key={item} className={range === item ? "on" : ""} onClick={() => setRange(item)}>
            {item === "ALL" ? "All" : item}
          </button>
        ))}
      </div>

      <section className="order-stat-grid" aria-label="Order status overview">
        <StatusSummary label="Active" value={String(counts.active)} note={`${rangedOrders.length > 0 ? ((counts.active / rangedOrders.length) * 100).toFixed(1) : "0.0"}% of orders`} tone="green" icon="✓" />
        <StatusSummary label="Delivered" value={String(counts.delivered)} note={`${counts.active} still active`} tone="mint" icon="◇" />
        <StatusSummary label="Cancelled" value={String(counts.cancelled)} note={`${rangedOrders.length > 0 ? ((counts.cancelled / rangedOrders.length) * 100).toFixed(1) : "0.0"}% of orders`} tone="red" icon="×" />
        <StatusSummary label="Biggest day" value={counts.biggest ? money(counts.biggest[1]) : money(0)} note={counts.biggest?.[0] ?? "No orders"} tone="purple" icon="↗" />
      </section>
      </>}

      {page === "tracking" && (
        <>
          <section className="tracking-overview" aria-label="Tracking overview">
            <div className="tracking-overview-lead">
              <span>◇ &nbsp; In transit <i /> Live</span>
              <strong>{trackingStats.inTransit}<small> packages</small></strong>
              <p>{trackingStats.arrivingToday} arriving today</p>
            </div>
            <OverviewMetric label="Delivered" value={trackingStats.delivered.toLocaleString()} note="completed shipments" />
            <OverviewMetric label="Late" value={trackingStats.late.toLocaleString()} note={trackingStats.late === 0 ? "on schedule" : "need attention"} />
            <OverviewMetric
              label="Carriers"
              value={trackingStats.carriers.size.toLocaleString()}
              note={[...trackingStats.carriers].join(" · ") || "No carriers yet"}
            />
          </section>
          <div className="tracking-filter-strip">
            <div className="order-range-bar tracking-range-bar" role="group" aria-label="Tracking date range">
              {ORDER_RANGES.map((item) => (
                <button key={item} type="button" className={range === item ? "on" : ""} onClick={() => selectQuickRange(item)}>
                  {item === "ALL" ? "All" : item}
                </button>
              ))}
            </div>
            <i aria-hidden="true" />
            <div className="tracking-history-filter" ref={historyMenuRef}>
              <button
                type="button"
                className={`tracking-filter-button${range !== "ALL" ? " active" : ""}`}
                aria-haspopup="dialog"
                aria-expanded={historyMenuOpen}
                onClick={() => {
                  setHistoryMenuOpen((open) => !open);
                  setStageMenuOpen(false);
                  setRetailerMenuOpen(false);
                  setEmailMenuOpen(false);
                  setSortMenuOpen(false);
                }}
              >
                □ &nbsp; {historyLabel}<span className="tracking-filter-chevron">{historyMenuOpen ? "⌃" : "⌄"}</span>
              </button>
              {historyMenuOpen && (
                <div className="tracking-history-menu" role="dialog" aria-label="Choose tracking history range">
                  <div className="tracking-quick-ranges">
                    <strong>Quick ranges</strong>
                    {QUICK_RANGES.map((item) => (
                      <button key={item.key} type="button" className={range === item.key ? "on" : ""} onClick={() => selectQuickRange(item.key)}>{item.label}</button>
                    ))}
                  </div>
                  <div className="tracking-custom-range">
                    <div className="tracking-date-fields">
                      <label><span>Start</span><input type="date" value={draftStart} onChange={(event) => setDraftStart(event.target.value)} /></label>
                      <i>→</i>
                      <label><span>End</span><input type="date" value={draftEnd} onChange={(event) => setDraftEnd(event.target.value)} /></label>
                    </div>
                    <div className="tracking-calendar-preview" aria-hidden="true">
                      <div><strong>{draftStart ? new Date(`${draftStart}T00:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" }) : "Start date"}</strong><span>{draftStart || "Choose a date above"}</span></div>
                      <div><strong>{draftEnd ? new Date(`${draftEnd}T00:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" }) : "End date"}</strong><span>{draftEnd || "Choose a date above"}</span></div>
                    </div>
                    <div className="tracking-history-actions">
                      <p>{range === "ALL" ? "Includes the entire history." : "Only orders inside this date range will be shown."}</p>
                      <button type="button" onClick={() => setHistoryMenuOpen(false)}>Cancel</button>
                      <button type="button" className="apply" onClick={applyCustomRange} disabled={!draftStart && !draftEnd}>Apply</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div className="tracking-stage-filter" ref={stageMenuRef}>
              <button
                type="button"
                className="tracking-filter-button"
                aria-haspopup="menu"
                aria-expanded={stageMenuOpen}
                onClick={() => {
                  setStageMenuOpen((open) => !open);
                  setHistoryMenuOpen(false);
                  setRetailerMenuOpen(false);
                  setEmailMenuOpen(false);
                  setSortMenuOpen(false);
                }}
              >
                ◇ &nbsp; {stageLabel}<span>{stageCounts[trackingStage]}</span><span className="tracking-filter-chevron">{stageMenuOpen ? "⌃" : "⌄"}</span>
              </button>
              {stageMenuOpen && (
                <div className="tracking-compact-menu tracking-stage-menu" role="menu" aria-label="Filter tracking stage">
                  {([[
                    "ALL", "◇", "All",
                  ], ["IN_TRANSIT", "♧", "In Transit"], ["OUT_FOR_DELIVERY", "⌖", "Out for Delivery"], ["DELIVERED", "✓", "Delivered"], ["LATE", "◷", "Late"]] as Array<[TrackingStage, string, string]>).map(([key, icon, label]) => (
                    <button key={key} type="button" className={trackingStage === key ? "on" : ""} onClick={() => { setTrackingStage(key); setStageMenuOpen(false); }}>
                      <i>{icon}</i><strong>{label}</strong><span>{stageCounts[key]}</span>{trackingStage === key && <b>✓</b>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="tracking-retailer-filter" ref={retailerMenuRef}>
              <button
                className="tracking-filter-button active"
                type="button"
                aria-haspopup="menu"
                aria-expanded={retailerMenuOpen}
                onClick={() => {
                  setRetailerMenuOpen((open) => !open);
                  setHistoryMenuOpen(false);
                  setStageMenuOpen(false);
                  setEmailMenuOpen(false);
                  setSortMenuOpen(false);
                }}
              >
                ▣ &nbsp; Retailers: <b>{retailerLabel}</b><span className="tracking-filter-chevron">{retailerMenuOpen ? "⌃" : "⌄"}</span>
              </button>
              {retailerMenuOpen && (
                <div className="tracking-retailer-menu" role="menu" aria-label="Choose retailers">
                  <label className="tracking-retailer-search">
                    <span>⌕</span>
                    <input
                      autoFocus
                      value={retailerQuery}
                      onChange={(event) => setRetailerQuery(event.target.value)}
                      placeholder="Search retailers..."
                    />
                  </label>
                  <div className="tracking-retailer-options">
                    {matchingRetailers.map((retailer) => {
                      const checked = selectedRetailers.has(retailer.key);
                      return (
                        <button
                          key={retailer.key}
                          type="button"
                          role="menuitemcheckbox"
                          aria-checked={checked}
                          className={checked ? "on" : ""}
                          onClick={() => toggleRetailer(retailer.key)}
                        >
                          <span className="tracking-retailer-check">{checked ? "✓" : ""}</span>
                          <span className={`tracking-retailer-icon ${retailer.className}`}>{retailer.icon}</span>
                          <strong>{retailer.label}</strong>
                        </button>
                      );
                    })}
                    {matchingRetailers.length === 0 && <p>No retailers found.</p>}
                  </div>
                </div>
              )}
            </div>
            <div className="tracking-email-filter" ref={emailMenuRef}>
              <button
                type="button"
                className={`tracking-filter-button${selectedEmails.size > 0 ? " active" : ""}`}
                aria-haspopup="menu"
                aria-expanded={emailMenuOpen}
                onClick={() => {
                  setEmailMenuOpen((open) => !open);
                  setHistoryMenuOpen(false);
                  setStageMenuOpen(false);
                  setRetailerMenuOpen(false);
                  setSortMenuOpen(false);
                }}
              >
                ✉ &nbsp; Emails: <b>{emailLabel}</b><span className="tracking-filter-chevron">{emailMenuOpen ? "⌃" : "⌄"}</span>
              </button>
              {emailMenuOpen && (
                <div className="tracking-retailer-menu tracking-email-menu" role="menu" aria-label="Choose email accounts">
                  <label className="tracking-retailer-search"><span>⌕</span><input autoFocus value={emailQuery} onChange={(event) => setEmailQuery(event.target.value)} placeholder="Search emails..." /></label>
                  <div className="tracking-retailer-options">
                    <button type="button" role="menuitemcheckbox" aria-checked={selectedEmails.size === 0} className={selectedEmails.size === 0 ? "on" : ""} onClick={() => setSelectedEmails(new Set())}>
                      <span className="tracking-retailer-check">{selectedEmails.size === 0 ? "✓" : ""}</span><span className="tracking-retailer-icon gmail">✉</span><strong>All</strong>
                    </button>
                    {matchingEmails.map((email) => {
                      const checked = selectedEmails.has(email);
                      return (
                        <button key={email} type="button" role="menuitemcheckbox" aria-checked={checked} className={checked ? "on" : ""} onClick={() => setSelectedEmails((current) => { const next = new Set(current); if (next.has(email)) next.delete(email); else next.add(email); return next; })}>
                          <span className="tracking-retailer-check">{checked ? "✓" : ""}</span><span className="tracking-retailer-icon gmail">✉</span><strong>{email}</strong>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
            <div className="tracking-sort-filter" ref={sortMenuRef}>
              <button
                type="button"
                className="tracking-filter-button"
                aria-haspopup="menu"
                aria-expanded={sortMenuOpen}
                onClick={() => {
                  setSortMenuOpen((open) => !open);
                  setHistoryMenuOpen(false);
                  setStageMenuOpen(false);
                  setRetailerMenuOpen(false);
                  setEmailMenuOpen(false);
                }}
              >
                ↕ &nbsp; {sortLabel}<span className="tracking-filter-chevron">{sortMenuOpen ? "⌃" : "⌄"}</span>
              </button>
              {sortMenuOpen && (
                <div className="tracking-compact-menu tracking-sort-menu" role="menu" aria-label="Sort tracking">
                  {([[
                    "STATUS", "By status",
                  ], ["ARRIVING", "Arriving soonest"], ["RECENT", "Recent activity"]] as Array<[TrackingSort, string]>).map(([key, label]) => (
                    <button key={key} type="button" className={trackingSort === key ? "on" : ""} onClick={() => { setTrackingSort(key); setSortMenuOpen(false); }}><strong>{label}</strong>{trackingSort === key && <b>✓</b>}</button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="tracking-view-tabs" aria-label="Tracking view">
            <button className="active">☷ &nbsp; List</button>
            <button disabled>□ &nbsp; Calendar</button>
            <button disabled>⌂ &nbsp; House</button>
          </div>
        </>
      )}

      {page === "orders" && <div className="order-toolbar">
        <div className="order-filters" role="group" aria-label="Order status">
          {pageFilters.map((item) => (
            <button key={item.key} className={filter === item.key ? "on" : ""} onClick={() => setFilter(item.key)}>
              {item.label}
              {item.key !== "ALL" && <span>{rangedOrders.filter((order) => order.status === item.key).length}</span>}
            </button>
          ))}
        </div>
        {page === "orders" && (
          <input
            className="order-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search orders, products, TCIN, or tracking"
            aria-label="Search orders"
          />
        )}
      </div>}

      {page === "tracking" && (
        <div className="tracking-controls-row">
          <input
            className="order-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search tracking, order #, product, carrier…"
            aria-label="Search tracking"
          />
          <div className="tracking-bulk-bar">
            <button className="tracking-select-all" onClick={toggleAllTracking} disabled={displayedOrders.length === 0 || bulkBusy}>
              {allTrackingSelected ? "Clear selection" : "Select All"}
            </button>
            <div className="tracking-status-control">
              <button onClick={() => setStatusMenuOpen((open) => !open)} disabled={selectedOrderIds.size === 0 || bulkBusy}>
                ／ Set Status ({selectedOrderIds.size})
              </button>
              {statusMenuOpen && (
                <div className="tracking-status-menu">
                  {(["SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED", "DELAYED", "CANCELLED"] as OrderState[]).map((status) => (
                    <button key={status} onClick={() => void setSelectedStatus(status)}>{statusLabel(status)}</button>
                  ))}
                </div>
              )}
            </div>
            <button className="tracking-delete-selected" onClick={() => void deleteSelectedOrders()} disabled={selectedOrderIds.size === 0 || bulkBusy}>
              ⌫ Delete ({selectedOrderIds.size})
            </button>
          </div>
        </div>
      )}

      {page === "dashboard" && (
        <section className="recent-orders-controls" aria-label="Recent order controls">
          <div className="recent-orders-head">
            <div className="recent-orders-title">
              <i aria-hidden="true">▣</i>
              <strong>Recent Orders</strong>
              <b>{orders.length.toLocaleString()}</b>
              <small>{Math.min(displayedOrders.length, 50).toLocaleString()} of {orders.length.toLocaleString()}</small>
            </div>
          </div>
          <div className="recent-orders-toolbar">
            <div className="order-filters" role="group" aria-label="Recent order status">
              {pageFilters.map((item) => (
                <button key={item.key} className={filter === item.key ? "on" : ""} onClick={() => setFilter(item.key)}>
                  <span className="recent-filter-icon" aria-hidden="true">{item.key === "ALL" ? "" : item.key === "ORDERED" ? "◇" : item.key === "SHIPPED" ? "♧" : item.key === "OUT_FOR_DELIVERY" ? "➤" : item.key === "DELIVERED" ? "◇" : item.key === "CANCELLED" ? "⊗" : "△"}</span>
                  {item.label}
                  {item.key !== "ALL" && <span className="recent-filter-count">{rangedOrders.filter((order) => order.status === item.key).length}</span>}
                </button>
              ))}
            </div>
            <div className="recent-orders-actions">
              <input className="order-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search orders or address..." aria-label="Search recent orders" />
              {dashboardSelectMode ? (
                <>
                  <button type="button" className="recent-select-all-button" onClick={toggleAllDashboard}>{allDashboardSelected ? "□" : "☷"} <span>{allDashboardSelected ? "Clear all" : `Select all (${visible.length})`}</span></button>
                  {selectedOrderIds.size > 0 && <button type="button" className="recent-delete-button" onClick={() => void deleteSelectedOrders()} disabled={bulkBusy}>⌫ <span>Delete ({selectedOrderIds.size})</span></button>}
                  <button type="button" className="recent-select-button on" onClick={toggleDashboardSelectionMode}>✓ <span>Done</span></button>
                </>
              ) : (
                <>
                  <button type="button" onClick={() => showToast("Address filtering will be available when saved addresses are added.")}>⌖ <span>Address</span></button>
                  <button type="button" onClick={() => showToast("House management will be available when saved addresses are added.")}>⌂ <span>Houses</span></button>
                  <button type="button" onClick={exportVisibleOrders}>⇩ <span>Export</span></button>
                  <button type="button" className="recent-select-button" onClick={toggleDashboardSelectionMode}>✓ <span>Select</span></button>
                </>
              )}
            </div>
          </div>
        </section>
      )}

      <section className="order-list">
        {displayedOrders.map((order) => {
          const quantity = order.items.reduce((sum, item) => sum + item.quantity, 0);
          const eachPrice = quantity > 0 && order.total != null ? order.total / quantity : null;
          return (
            <div
              className={`order-row status-${order.status.toLowerCase()}${selectedOrderIds.has(order.id) ? " selected" : ""}`}
              key={order.id}
              role="button"
              tabIndex={0}
              onClick={() => dashboardSelectMode && page === "dashboard" ? toggleOrder(order.id) : setSelected(order)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                if (dashboardSelectMode && page === "dashboard") toggleOrder(order.id);
                else setSelected(order);
              }}
            >
              {(page === "tracking" || (page === "dashboard" && dashboardSelectMode)) && (
                <label className="tracking-row-check" onClick={(event) => event.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={selectedOrderIds.has(order.id)}
                    onChange={() => toggleOrder(order.id)}
                    aria-label={`Select order ${order.orderNumber}`}
                  />
                </label>
              )}
              <span className="order-row-product">
                {order.items[0]?.imageUrl
                  ? <img src={order.items[0].imageUrl} alt="" />
                  : <span className="order-image-fallback">T</span>}
                <span>
                  <strong>{orderTitle(order)}</strong>
                  <small>
                    #{order.orderNumber}
                    <i className="target-mini-logo" aria-hidden="true" />
                    Target · {orderRowDate(order.orderDate)}
                  </small>
                </span>
              </span>
              <span className="order-progress" aria-hidden="true">
                {[1, 2, 3, 4].map((step) => <i key={step} className={step <= STATUS_STEP[order.status] ? "on" : ""} />)}
              </span>
              <span className="order-row-status">● {statusLabel(order.status)}</span>
              {page === "tracking" ? (
                <span className="tracking-row-delivery">
                  <strong>{deliveryLabel(order)}</strong>
                  <small>{order.shipments[0]?.trackingNumber ?? "Tracking pending"}</small>
                </span>
              ) : <span className="order-row-total">
                <strong>{money(order.total)}</strong>
                <small>
                  {quantity > 0
                    ? `${quantity} ${quantity === 1 ? "unit" : "units"}${eachPrice == null ? "" : ` · ${money(eachPrice)} ea`}`
                    : "View details"}
                </small>
              </span>}
              <span className="order-chevron">›</span>
            </div>
          );
        })}
        {visible.length === 0 && (
          <div className="order-empty panel">
            <strong>{orders.length === 0 ? "No Target orders imported yet" : "No orders match this view"}</strong>
            <p>{orders.length === 0 ? "Connect Gmail and run your first Target scan." : "Try another status or search term."}</p>
          </div>
        )}
      </section>

      {selected && <OrderDetail order={selected} onClose={() => setSelected(null)} showToast={showToast} />}
    </main>
  );
}

function TargetScanProgress({
  progress,
}: {
  progress: { processed: number; total: number | null; historical: boolean; more: boolean };
}) {
  const hasEstimate = progress.total != null && progress.total > 0;
  const percent = hasEstimate
    ? Math.min(progress.more ? 99 : 100, Math.round((progress.processed / progress.total!) * 100))
    : null;

  return (
    <div className={`target-scan-progress${percent == null ? " indeterminate" : ""}`} role="status" aria-live="polite">
      <div className="target-scan-progress-head">
        <span>{progress.historical ? "Scanning Target order history" : "Scanning recent Target orders"}</span>
        <strong>{percent == null ? "Working…" : `${percent}%`}</strong>
      </div>
      <div
        className="target-scan-progress-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
      >
        <span style={percent == null ? undefined : { width: `${percent}%` }} />
      </div>
      <small>
        {progress.processed.toLocaleString()} email{progress.processed === 1 ? "" : "s"} checked
        {hasEstimate ? ` of about ${progress.total!.toLocaleString()}` : ""}
      </small>
    </div>
  );
}

function OverviewMetric({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="orders-overview-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}

function StatusSummary({
  label,
  value,
  note,
  tone,
  icon,
}: {
  label: string;
  value: string;
  note: string;
  tone: string;
  icon: string;
}) {
  return (
    <div className={`order-status-summary ${tone}`}>
      <span><i>{icon}</i>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
      <b aria-hidden="true" />
    </div>
  );
}

function OrderDetail({
  order,
  onClose,
  showToast,
}: {
  order: OrderRow;
  onClose: () => void;
  showToast: (message: string, tone?: "success" | "error" | "info") => void;
}) {
  const router = useRouter();
  const [statusOpen, setStatusOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [upsTracking, setUpsTracking] = useState<UpsTrackingResult | null>(null);
  const [upsLoading, setUpsLoading] = useState(false);
  const [upsError, setUpsError] = useState<string | null>(null);
  const shipment = order.shipments[0] ?? null;
  const carrierUrl = shipment ? trackingUrl(shipment.carrier, shipment.trackingNumber) : null;
  const milestoneDate = order.status === "DELIVERED"
    ? shipment?.deliveredAt ?? order.lastUpdateAt
    : shipment?.shippedAt ?? order.lastUpdateAt;

  async function loadUpsTracking() {
    if (!shipment || (shipment.carrier?.toUpperCase() !== "UPS" && !shipment.trackingNumber.toUpperCase().startsWith("1Z"))) {
      setUpsError("Carrier tracking history is currently available for UPS packages only.");
      return;
    }
    setUpsLoading(true);
    setUpsError(null);
    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(order.id)}/tracking`, { cache: "no-store" });
      const result = await response.json().catch(() => ({})) as UpsTrackingResult & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "UPS tracking request failed.");
      setUpsTracking(result);
    } catch (error) {
      setUpsError(error instanceof Error ? error.message : "UPS tracking request failed.");
    } finally {
      setUpsLoading(false);
    }
  }

  useEffect(() => {
    void loadUpsTracking();
    // The modal represents one immutable order; reload only when its shipment changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id, shipment?.carrier, shipment?.trackingNumber]);

  async function copy(value: string, label: string) {
    await navigator.clipboard.writeText(value);
    showToast(`${label} copied.`);
  }

  async function updateStatus(status: OrderState) {
    setBusy(true);
    setStatusOpen(false);
    try {
      const response = await fetch("/api/orders/batch", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: [order.id], status }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Couldn't update this shipment.");
      showToast(`Shipment marked ${statusLabel(status).toLowerCase()}.`);
      onClose();
      router.refresh();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Couldn't update this shipment.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function deleteOrder() {
    if (!window.confirm(`Delete order #${order.orderNumber} and its imported email history?`)) return;
    setBusy(true);
    try {
      const response = await fetch("/api/orders/batch", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: [order.id] }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Couldn't delete this order.");
      showToast("Order deleted.");
      onClose();
      router.refresh();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Couldn't delete this order.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal order-detail-modal shipping-detail-modal" onClick={(event) => event.stopPropagation()}>
        <section className={`shipping-detail-card status-${order.status.toLowerCase()}`}>
          <div className="shipping-detail-topline">
            <strong>◉ {statusLabel(order.status)}</strong>
            <div>
              <button type="button" className="shipping-delete" onClick={() => void deleteOrder()} disabled={busy} aria-label="Delete order">⌫</button>
              <button type="button" onClick={onClose} aria-label="Close">×</button>
            </div>
          </div>
          <div className="shipping-detail-product">
            {order.items[0]?.imageUrl ? <img src={order.items[0].imageUrl} alt="" /> : <span className="order-image-fallback">T</span>}
            <div>
              <strong>{orderTitle(order)}</strong>
              {shipment ? (
                <p><b>♧ {shipment.carrier ?? "Carrier"}</b><span>{shipment.trackingNumber}</span><button type="button" onClick={() => void copy(shipment.trackingNumber, "Tracking number")}>▣</button></p>
              ) : <p><span>Tracking has not been assigned yet</span></p>}
            </div>
          </div>
          <div className="shipping-status-block">
            <div><span>{statusLabel(order.status)}</span><strong>{milestoneDate ? new Date(milestoneDate).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : shortDate(order.orderDate)}</strong></div>
            <div className="shipping-status-picker">
              <button type="button" onClick={() => setStatusOpen((open) => !open)} disabled={busy}>／ Set Status</button>
              {statusOpen && (
                <div className="shipping-status-menu">
                  {(["SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED", "DELAYED", "CANCELLED"] as OrderState[]).map((status) => <button key={status} type="button" onClick={() => void updateStatus(status)}>{statusLabel(status)}</button>)}
                </div>
              )}
            </div>
          </div>
        </section>

        <div className="shipping-destination">
          <i>⌖</i><div><span>Shipping to</span><strong>{upsTracking?.destination?.formatted || "Destination will appear when UPS tracking is connected"}</strong></div>
        </div>

        <div className="shipping-detail-actions">
          <button type="button" disabled={!shipment} onClick={() => shipment && void copy(shipment.trackingNumber, "Tracking number")}>▣ &nbsp; Copy Tracking</button>
          {shipment && carrierUrl ? <a href={carrierUrl} target="_blank" rel="noreferrer">↗ &nbsp; Track on {shipment.carrier ?? "carrier"}</a> : <button type="button" disabled>Tracking unavailable</button>}
        </div>

        <section className="shipping-history-card">
          <div className="shipping-history-head">
            <div><i>◷</i><span><strong>UPS tracking history</strong><small>{upsTracking?.events.length ?? 0} event{upsTracking?.events.length === 1 ? "" : "s"}</small></span></div>
            <button type="button" onClick={() => void loadUpsTracking()} disabled={upsLoading}>↻ {upsLoading ? "Loading" : "Refresh"}</button>
          </div>
          {upsLoading && !upsTracking ? <p className="shipping-history-empty">Loading tracking scans from UPS…</p> : upsError ? (
            <div className="shipping-history-error">
              <p>{upsError}</p>
              {order.history.length > 0 && <details><summary>Show Target email updates ({order.history.length})</summary><ol className="order-history">{order.history.map((event) => <li key={event.id}><i /><div><strong>{event.status ? statusLabel(event.status) : "Target update"}</strong><span>{event.subject}</span><small>{exactDate(event.receivedAt)}</small></div></li>)}</ol></details>}
            </div>
          ) : upsTracking && upsTracking.events.length > 0 ? (
            <ol className="order-history">
              {upsTracking.events.map((event) => (
                <li key={event.id}>
                  <i />
                  <div><strong>{event.description}</strong>{event.location && <span>{event.location}</span>}<small>{exactDate(event.occurredAt)}</small></div>
                </li>
              ))}
            </ol>
          ) : <p className="shipping-history-empty">UPS returned no tracking scans for this package.</p>}
        </section>
      </div>
    </div>
  );
}
