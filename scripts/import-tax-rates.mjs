/**
 * Import US sales tax rates from the bundled CSV into the TaxRate table.
 *
 *   node scripts/import-tax-rates.mjs
 *   node scripts/import-tax-rates.mjs path/to/other.csv
 *
 * Rates drift as municipalities adjust them, so re-run this quarterly with a
 * fresh CSV. It replaces the table wholesale rather than merging, so removed
 * ZIPs don't linger.
 *
 * Expected columns: state, zip_code, tax_region, combined_rate
 * (state_rate, county_rate, city_rate and special_rate are ignored — we only
 * need the total.)
 */

import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const path = process.argv[2] ?? "data/us-tax-rates.csv";

/** Minimal CSV line splitter — handles the quoted region names with commas. */
function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

async function main() {
  // strip a UTF-8 BOM if the file has one, or the first header name breaks
  const text = readFileSync(path, "utf8").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const header = splitCsvLine(lines[0]).map((h) => h.trim());

  const col = (name) => {
    const i = header.indexOf(name);
    if (i === -1) throw new Error(`CSV is missing a "${name}" column. Found: ${header.join(", ")}`);
    return i;
  };

  const iZip = col("zip_code");
  const iState = col("state");
  const iRate = col("combined_rate");
  const iRegion = header.indexOf("tax_region");

  const rows = [];
  let skipped = 0;

  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const zip = (cells[iZip] ?? "").trim().padStart(5, "0");
    const rate = Number(cells[iRate]);

    if (!/^\d{5}$/.test(zip) || !Number.isFinite(rate) || rate < 0 || rate > 0.25) {
      skipped++;
      continue;
    }

    rows.push({
      zip,
      state: (cells[iState] ?? "").trim().toUpperCase(),
      region: iRegion === -1 ? null : (cells[iRegion] ?? "").trim() || null,
      combinedRate: rate,
    });
  }

  console.log(`Parsed ${rows.length} rows from ${path}${skipped ? ` (skipped ${skipped})` : ""}`);

  await prisma.taxRate.deleteMany();

  // Chunked, or Postgres chokes on a 41,000-row insert
  const CHUNK = 2000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await prisma.taxRate.createMany({ data: rows.slice(i, i + CHUNK), skipDuplicates: true });
    process.stdout.write(`\r  inserted ${Math.min(i + CHUNK, rows.length)} / ${rows.length}`);
  }

  const total = await prisma.taxRate.count();
  console.log(`\nDone — ${total} ZIP codes in the table.`);

  // Spot-check somewhere known, so a silently mangled import is obvious
  const chicago = await prisma.taxRate.findUnique({ where: { zip: "60601" } });
  if (chicago) {
    console.log(`Sanity check — 60601 is ${(Number(chicago.combinedRate) * 100).toFixed(3)}%`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
