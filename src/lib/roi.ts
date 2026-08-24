export type RoiInput = {
  retailPrice: number | null;
  marketPrice: number | null;
  /** 0.0825 for 8.25% */
  taxRate: number;
  /** Marketplace + payment processing, e.g. 0.1275. Set 0 for gross-only numbers. */
  feePct?: number;
  /** Flat per-box shipping/supplies cost you eat when selling. */
  shippingCost?: number;
};

export type RoiResult = {
  cost: number | null;          // retail + tax — what leaves your pocket
  grossProfit: number | null;   // market - cost
  grossRoi: number | null;      // grossProfit / cost
  netProceeds: number | null;   // market after fees and shipping
  netProfit: number | null;     // netProceeds - cost
  netRoi: number | null;
};

const empty: RoiResult = {
  cost: null, grossProfit: null, grossRoi: null,
  netProceeds: null, netProfit: null, netRoi: null,
};

export function computeRoi({
  retailPrice,
  marketPrice,
  taxRate,
  feePct = 0,
  shippingCost = 0,
}: RoiInput): RoiResult {
  if (retailPrice == null || retailPrice <= 0) return empty;

  const cost = round2(retailPrice * (1 + taxRate));
  if (marketPrice == null) return { ...empty, cost };

  const grossProfit = round2(marketPrice - cost);
  const netProceeds = round2(marketPrice * (1 - feePct) - shippingCost);
  const netProfit = round2(netProceeds - cost);

  return {
    cost,
    grossProfit,
    grossRoi: grossProfit / cost,
    netProceeds,
    netProfit,
    netRoi: netProfit / cost,
  };
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

export const money = (n: number | null) =>
  n == null ? "—" : `${n < 0 ? "-" : ""}$${Math.abs(n).toFixed(2)}`;

export const pct = (n: number | null) =>
  n == null ? "—" : `${(n * 100).toFixed(1)}%`;

/** Buckets the summary tiles across the top of the dashboard. */
export function roiBucket(roi: number | null) {
  if (roi == null) return "unknown" as const;
  if (roi < 0) return "negative" as const;
  if (roi < 0.5) return "low" as const;
  if (roi < 1) return "mid" as const;
  return "high" as const;
}
