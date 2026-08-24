import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { BRANDS, isRetailer } from "@/lib/retailers";

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

  const body = await req.json();
  const rows = Array.isArray(body.rows) ? body.rows : [body];
  const saved = [];
  const problems: string[] = [];

  for (const [i, row] of rows.entries()) {
    const sku = String(row.sku ?? "").trim();
    const productName = String(row.productName ?? "").trim();
    const retailPrice = Number(row.retailPrice);

    if (!sku || !productName || !Number.isFinite(retailPrice)) {
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
      marketPrice: Number.isFinite(Number(row.marketPrice)) ? Number(row.marketPrice) : null,
      imageUrl: row.imageUrl?.trim() || null,
      productUrl: row.productUrl?.trim() || null,
      notes: row.notes?.trim() || null,
      pricedAt: new Date(),
    };

    saved.push(
      await prisma.product.upsert({
        where: { retailer_sku: { retailer, sku } },
        create: { ...data, createdById: session.user.id },
        update: { ...data, active: true },
      }),
    );
  }

  return NextResponse.json({ saved: saved.length, problems }, { status: problems.length && !saved.length ? 400 : 201 });
}
