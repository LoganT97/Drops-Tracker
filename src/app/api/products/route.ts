import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { BRANDS, isRetailer } from "@/lib/retailers";
import { recordSnapshot } from "@/lib/history";

/**
 * Blank means "not priced yet", not zero.
 *
 * Number("") is 0, so a plain isFinite check silently turns an empty field into
 * a $0.00 market value — which then reads as -100% ROI instead of "unknown".
 */
function parsePrice(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  if (trimmed === "") return null;
  const n = Number(trimmed.replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  return NextResponse.json(
    await prisma.product.findMany({ where: { active: true }, orderBy: { createdAt: "desc" } }),
  );
}

/**
 * Add one product, or a batch of them from the paste-in importer.
 * Send either a single object or { rows: [...] }.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Only editors can add SKUs." }, { status: 403 });
  }

  const body = await req.json();
  const rows = Array.isArray(body.rows) ? body.rows : [body];
  const saved = [];
  const problems: string[] = [];

  for (const [i, row] of rows.entries()) {
    const sku = String(row.sku ?? "").trim();
    const productName = String(row.productName ?? "").trim();
    const retailPrice = parsePrice(row.retailPrice);

    if (!sku || !productName || retailPrice === null) {
      problems.push(`Row ${i + 1}: needs a SKU, a name, and a retail price.`);
      continue;
    }

    const retailer = String(row.retailer ?? "TARGET").toUpperCase();
    if (!isRetailer(retailer)) {
      problems.push(`Row ${i + 1}: ${retailer} isn't a store we track.`);
      continue;
    }

    const brand = String(row.brand ?? "").trim();
    const data = {
      retailer,
      sku,
      productName,
      brand: (BRANDS as readonly string[]).includes(brand) ? brand : "Pokemon",
      retailPrice,
      marketPrice: parsePrice(row.marketPrice),
      imageUrl: row.imageUrl?.trim() || null,
      productUrl: row.productUrl?.trim() || null,
      notes: row.notes?.trim() || null,
      prerelease: row.prerelease === true || String(row.prerelease ?? "").toLowerCase() === "true",
      tcgProductId: Number.isInteger(row.tcgProductId) ? row.tcgProductId : null,
      tcgCategoryId: Number.isInteger(row.tcgCategoryId) ? row.tcgCategoryId : null,
      tcgGroupId: Number.isInteger(row.tcgGroupId) ? row.tcgGroupId : null,
      pricedAt: new Date(),
    };

    const product = await prisma.product.upsert({
      where: { retailer_sku: { retailer, sku } },
      create: { ...data, createdById: session.user.id },
      update: { ...data, active: true },
    });

    await recordSnapshot(product.id, data.marketPrice, retailPrice);
    saved.push(product);
  }

  return NextResponse.json({ saved: saved.length, problems }, { status: problems.length && !saved.length ? 400 : 201 });
}
