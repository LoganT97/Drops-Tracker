import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

type ParsedDrop = { sku: string; date: string };

function dateInCentralTime(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function shiftIsoDate(iso: string, days: number) {
  const date = new Date(`${iso}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function parseDrops(text: string): ParsedDrop[] {
  const drops: ParsedDrop[] = [];
  const tcinPattern = /\bTcin\s*\r?\n\s*(\d{6,12})\b/gi;
  const today = dateInCentralTime(new Date());
  let match: RegExpExecArray | null;

  while ((match = tcinPattern.exec(text))) {
    const before = text.slice(Math.max(0, match.index - 800), match.index);
    const dates = [...before.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\s+\d{1,2}:\d{2}\s*(?:AM|PM)\b/gi)];
    const latest = dates.at(-1);
    let iso: string | null = null;
    if (latest) {
      const [, month, day, year] = latest;
      iso = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    } else {
      const after = text.slice(match.index, Math.min(text.length, match.index + 800));
      const relative = after.match(/\b(Today|Yesterday)\s+at\s+\d{1,2}:\d{2}\s*(?:AM|PM)\b/i);
      if (relative) iso = relative[1].toLowerCase() === "yesterday" ? shiftIsoDate(today, -1) : today;
    }
    if (!iso) continue;
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
  const untracked = unique.filter((drop) => !productBySku.has(drop.sku));
  const savedUntracked = untracked.length
    ? await prisma.untrackedDropEvent.createMany({
        data: untracked.map((drop) => ({
          retailer: "TARGET",
          sku: drop.sku,
          dropDate: new Date(`${drop.date}T00:00:00.000Z`),
        })),
        skipDuplicates: true,
      })
    : { count: 0 };

  return NextResponse.json({
    imported: created.count,
    duplicatesIgnored: (parsed.length - unique.length) + (tracked.length - created.count),
    untrackedSkus,
    savedForLater: savedUntracked.count,
  });
}
