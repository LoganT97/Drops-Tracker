import { prisma } from "@/lib/db";

/**
 * Sales tax lookup.
 *
 * Two very different problems:
 *
 * US — rates stack from state, county, city and special districts across
 * 13,000+ jurisdictions, so we look up a bundled ZIP dataset. ZIP codes were
 * designed for mail routing, not tax boundaries, so a ZIP can straddle two
 * jurisdictions. That makes this an estimate, which is fine here: we're
 * predicting what a register will charge, not filing a return. The field stays
 * editable so anyone can correct it.
 *
 * Canada — tax is set provincially with no local layer, and the first letter of
 * a postal code identifies the province. So this half is exact and needs no
 * dataset at all.
 */

/**
 * Combined GST/HST/PST/QST by province.
 *
 * Verify against the CRA before trusting these long-term; provinces do adjust
 * them (Nova Scotia moved from 15% to 14% in 2025).
 */
const CANADA: Record<string, { name: string; rate: number }> = {
  AB: { name: "Alberta", rate: 0.05 },            // GST only
  BC: { name: "British Columbia", rate: 0.12 },   // 5 GST + 7 PST
  MB: { name: "Manitoba", rate: 0.12 },           // 5 GST + 7 PST
  NB: { name: "New Brunswick", rate: 0.15 },      // HST
  NL: { name: "Newfoundland and Labrador", rate: 0.15 },
  NS: { name: "Nova Scotia", rate: 0.14 },        // HST
  NT: { name: "Northwest Territories", rate: 0.05 },
  NU: { name: "Nunavut", rate: 0.05 },
  ON: { name: "Ontario", rate: 0.13 },            // HST
  PE: { name: "Prince Edward Island", rate: 0.15 },
  QC: { name: "Quebec", rate: 0.14975 },          // 5 GST + 9.975 QST
  SK: { name: "Saskatchewan", rate: 0.11 },       // 5 GST + 6 PST
  YT: { name: "Yukon", rate: 0.05 },
};

/** First letter of a postal code maps to a province. X covers NT and NU, which share a rate. */
const POSTAL_PREFIX: Record<string, string> = {
  A: "NL", B: "NS", C: "PE", E: "NB",
  G: "QC", H: "QC", J: "QC",
  K: "ON", L: "ON", M: "ON", N: "ON", P: "ON",
  R: "MB", S: "SK", T: "AB", V: "BC", X: "NT", Y: "YT",
};

export type TaxLookup = {
  rate: number;
  label: string;
  country: "US" | "CA";
  /** True when the rate is unusually high — tribal and special districts stack. */
  unusual?: boolean;
};

export async function lookupTaxRate(input: string): Promise<TaxLookup | null> {
  const code = input.trim().toUpperCase().replace(/\s+/g, "");
  if (!code) return null;

  // US: five digits (tolerate ZIP+4)
  const zip = code.match(/^(\d{5})(-?\d{4})?$/)?.[1];
  if (zip) {
    const row = await prisma.taxRate.findUnique({ where: { zip } });
    if (!row) return null;

    const rate = Number(row.combinedRate);
    return {
      rate,
      label: [row.region, row.state].filter(Boolean).join(", ") || zip,
      country: "US",
      unusual: rate > 0.12,
    };
  }

  // Canada: letter-digit-letter, e.g. M5V or M5V3L9
  if (/^[A-Z]\d[A-Z]/.test(code)) {
    const province = POSTAL_PREFIX[code[0]];
    const entry = province ? CANADA[province] : null;
    if (!entry) return null;

    return { rate: entry.rate, label: entry.name, country: "CA" };
  }

  return null;
}
