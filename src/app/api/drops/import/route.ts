import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

type ParsedDrop = { sku: string; date: string };

function parseDrops(text: string): ParsedDrop[] {
  const drops: ParsedDrop[] = [];
  const tcinPattern = /\bTcin\s*\r?\n\s*(\d{6,12})\b/gi;
  let match: RegExpExecArray | null;

  while ((match = tcinPattern.exec(text))) {
    const before = text.slice(Math.max(0, match.index - 800), match.index);
    const dates = [...before.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\s+\d{1,2}:\d{2}\s*(?:AM|PM)\b/gi)];
    const latest = dates.at(-1);
    if (!latest) continue;
    const [, month, day, year] = latest;
    const iso = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    const date = new Date(`${iso}T00:00:00.000Z`);
    if (!Number.isNaN(date.getTime())) drops.push({ sku: match[1], date: iso });
  }
  return drops;
}

export async function POST(req: Request) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "Only admins can import drop dates." }, { status: 403 });
  }

  const body = await req.json();
  const text = String(body.text ?? "");
  if (!text.trim()) return NextResponse.json({ error: "Paste at least one drop alert." }, { status: 400 });

  const parsed = parseDrops(text);
  if (parsed.length === 0) {
    return NextResponse.json({ error: "No TCIN and timestamp pairs were found in that text." }, { status: 400 });
  }

  const unique = [...new Map(parsed.map((drop) => [`${drop.sku}:${drop.date}`, drop])).values()];
  const skus = [...new Set(unique.map((drop) => drop.sku))];
  const products = await prisma.product.findMany({
    where: { retailer: "TARGET", active: true, sku: { in: skus } },
    select: { id: true, sku: true },
  });
  const productBySku = new Map(products.map((product) => [product.sku, product.id]));
  const tracked = unique.flatMap((drop) => {
    const productId = productBySku.get(drop.sku);
    return productId ? [{ productId, dropDate: new Date(`${drop.date}T00:00:00.000Z`) }] : [];
  });

  const created = tracked.length
    ? await prisma.dropEvent.createMany({ data: tracked, skipDuplicates: true })
    : { count: 0 };
  const untrackedSkus = skus.filter((sku) => !productBySku.has(sku));

  return NextResponse.json({
    imported: created.count,
    duplicatesIgnored: (parsed.length - unique.length) + (tracked.length - created.count),
    untrackedSkus,
  });
}
