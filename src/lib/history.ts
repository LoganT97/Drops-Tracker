import { prisma } from "@/lib/db";

/**
 * Price history.
 *
 * TCGplayer publishes today's market price, not yesterday's, so history is
 * something we accumulate rather than fetch. Every sync and every manual price
 * edit records a point; the unique constraint on (productId, capturedOn) means
 * a day gets updated rather than duplicated if that happens twice.
 *
 * Consequence worth knowing: a SKU's chart starts the day you add it. There's
 * no backfill.
 */

/** Midnight UTC for today, so a day is one row regardless of clock time. */
function today(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export async function recordSnapshot(
  productId: string,
  marketPrice: number | null,
  retailPrice: number | null,
) {
  if (marketPrice == null && retailPrice == null) return;

  const capturedOn = today();

  await prisma.priceSnapshot.upsert({
    where: { productId_capturedOn: { productId, capturedOn } },
    create: { productId, capturedOn, marketPrice, retailPrice },
    update: { marketPrice, retailPrice },
  });
}

export type HistoryPoint = {
  date: string;
  marketPrice: number | null;
  retailPrice: number | null;
};

/** Last N days of points for one product, oldest first. */
export async function getHistory(productId: string, days = 30): Promise<HistoryPoint[]> {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days);
  since.setUTCHours(0, 0, 0, 0);

  const rows = await prisma.priceSnapshot.findMany({
    where: { productId, capturedOn: { gte: since } },
    orderBy: { capturedOn: "asc" },
    select: { capturedOn: true, marketPrice: true, retailPrice: true },
  });

  return rows.map((r) => ({
    date: r.capturedOn.toISOString().slice(0, 10),
    marketPrice: r.marketPrice != null ? Number(r.marketPrice) : null,
    retailPrice: r.retailPrice != null ? Number(r.retailPrice) : null,
  }));
}
