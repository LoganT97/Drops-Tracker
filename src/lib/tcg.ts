import { prisma } from "@/lib/db";
import { recordSnapshot } from "@/lib/history";

/**
 * TCGplayer market prices, via TCGCSV (https://tcgcsv.com).
 *
 * TCGplayer closed their API to new applicants, so we read the same data from
 * TCGCSV, a free daily mirror. It's one person's service, so we follow their
 * usage guidelines to the letter:
 *
 *   - Data rebuilds once per day. Check last-updated.txt before syncing.
 *   - Identify ourselves with a real User-Agent (generic ones get blocked).
 *   - Sleep 100ms between requests or the IP gets throttled for 10 minutes.
 *   - Stay well under 10,000 requests per 24 hours.
 *   - Server-side only — their CORS policy blocks browser requests.
 *
 * Everything lands in our own TcgProduct table, so the app never queries
 * TCGCSV on a user's behalf. Searches hit Postgres.
 */

const BASE = "https://tcgcsv.com/tcgplayer";
const UA = "DropBuddy/1.0";
const THROTTLE_MS = 120;

/** Games we track. Matched case-insensitively against TCGplayer category names. */
const TRACKED = ["pokemon", "one piece", "lorcana", "magic"];

/** Skip sets older than this — nobody's buying 2015 sealed off a Target shelf. */
const YEARS_BACK = 4;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const log = (msg: string) => console.log(`[tcg-sync] ${msg}`);

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "User-Agent": UA, accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`TCGCSV ${path} returned ${res.status}`);
  const body = await res.json();
  return (body.results ?? body) as T;
}

type Category = { categoryId: number; name: string; displayName: string };
type Group = { groupId: number; name: string; publishedOn: string; categoryId: number };
type Product = {
  productId: number;
  name: string;
  imageUrl?: string;
  url?: string;
  categoryId: number;
  groupId: number;
  extendedData?: Array<{ name: string; value: string }>;
};
type Price = {
  productId: number;
  marketPrice: number | null;
  midPrice: number | null;
  subTypeName: string;
};

/**
 * Sealed products (boxes, ETBs, bundles) versus single cards.
 *
 * TCGCSV's docs suggest the reliable tell: singles carry Rarity or Number in
 * extendedData, sealed products don't.
 */
function isSealed(p: Product) {
  const keys = new Set((p.extendedData ?? []).map((d) => d.name));
  return !keys.has("Rarity") && !keys.has("Number");
}

/** TCGCSV's build timestamp. Cheap call — skip the whole sync if unchanged. */
async function fetchStamp(): Promise<string> {
  const res = await fetch("https://tcgcsv.com/last-updated.txt", {
    headers: { "User-Agent": UA },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`last-updated.txt returned ${res.status}`);
  return (await res.text()).trim();
}

export type SyncResult = {
  skipped: boolean;
  reason?: string;
  groups: number;
  products: number;
  linkedUpdated: number;
  requests: number;
};

/**
 * Pull sealed products and their market prices into TcgProduct, then push
 * fresh prices onto any Product row that's been linked to one.
 *
 * Safe to call repeatedly — it no-ops when TCGCSV hasn't rebuilt since the
 * last successful run, unless force is set.
 */
export async function syncTcgPrices(force = false): Promise<SyncResult> {
  const state = await prisma.syncState.findUnique({ where: { id: "tcgcsv" } });
  const stamp = await fetchStamp();
  let requests = 1;

  log(`TCGCSV build ${stamp}; last synced ${state?.lastStamp ?? "never"}`);

  if (!force && state?.lastStamp === stamp) {
    log("already up to date, skipping");
    return {
      skipped: true,
      reason: "TCGCSV hasn't rebuilt since the last sync.",
      groups: 0,
      products: 0,
      linkedUpdated: 0,
      requests,
    };
  }

  const categories = await get<Category[]>("/categories");
  requests++;

  const wanted = categories.filter((c) =>
    TRACKED.some((t) => c.name.toLowerCase().includes(t)),
  );
  log(`tracking ${wanted.length} categories: ${wanted.map((c) => c.name).join(", ")}`);

  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - YEARS_BACK);

  let groupCount = 0;
  let productCount = 0;

  for (const category of wanted) {
    await sleep(THROTTLE_MS);
    const groups = await get<Group[]>(`/${category.categoryId}/groups`);
    requests++;

    const recent = groups.filter((g) => {
      const published = new Date(g.publishedOn);
      return isNaN(published.getTime()) || published >= cutoff;
    });

    log(`${category.name}: ${recent.length} of ${groups.length} sets are recent enough`);

    for (const group of recent) {
      let products: Product[];
      let prices: Price[];

      try {
        await sleep(THROTTLE_MS);
        products = await get<Product[]>(`/${category.categoryId}/${group.groupId}/products`);
        requests++;

        await sleep(THROTTLE_MS);
        prices = await get<Price[]>(`/${category.categoryId}/${group.groupId}/prices`);
        requests++;
      } catch (e) {
        log(`  skipped ${group.name}: ${(e as Error).message}`);
        continue; // one bad set shouldn't kill the whole run
      }

      // productId -> best available price. Sealed items normally have a single
      // subtype, but prefer a real marketPrice when there's more than one.
      const priceFor = new Map<number, number>();
      for (const row of prices) {
        const value = row.marketPrice ?? row.midPrice;
        if (value == null) continue;
        const existing = priceFor.get(row.productId);
        if (existing == null || row.marketPrice != null) {
          priceFor.set(row.productId, value);
        }
      }

      const sealed = products.filter(isSealed);
      if (sealed.length === 0) continue;

      groupCount++;
      log(`  ${group.name}: ${sealed.length} sealed of ${products.length} products`);

      for (const p of sealed) {
        const marketPrice = priceFor.get(p.productId) ?? null;
        const row = {
          name: p.name,
          categoryId: category.categoryId,
          categoryName: category.displayName ?? category.name,
          groupId: group.groupId,
          groupName: group.name,
          imageUrl: p.imageUrl ?? null,
          url: p.url ?? null,
          marketPrice,
          pricedAt: marketPrice != null ? new Date() : null,
        };

        await prisma.tcgProduct.upsert({
          where: { productId: p.productId },
          create: { productId: p.productId, ...row },
          update: row,
        });
        productCount++;
      }
    }
  }

  log(`cached ${productCount} sealed products across ${groupCount} sets in ${requests} requests`);

  const linkedUpdated = await applyPricesToProducts();
  log(`refreshed name/photo/price on ${linkedUpdated} tracked SKUs`);

  await prisma.syncState.upsert({
    where: { id: "tcgcsv" },
    create: {
      id: "tcgcsv",
      lastStamp: stamp,
      lastSyncedAt: new Date(),
      productCount,
      lastError: null,
    },
    update: {
      lastStamp: stamp,
      lastSyncedAt: new Date(),
      productCount,
      lastError: null,
    },
  });

  return { skipped: false, groups: groupCount, products: productCount, linkedUpdated, requests };
}

/**
 * Push cached TCGplayer data onto every Product that's been linked to one.
 *
 * Linking makes TCGplayer the source of truth for the product name, the photo,
 * and the market price — so a retailer's unhelpful URL slug ("Zephyr") gets
 * replaced by the real product title, and it stays correct as TCGplayer
 * updates. Unlinked rows keep whatever was typed by hand and are never touched.
 */
export async function applyPricesToProducts(): Promise<number> {
  const linked = await prisma.product.findMany({
    where: { active: true, tcgProductId: { not: null } },
    select: {
      id: true,
      tcgProductId: true,
      marketPrice: true,
      retailPrice: true,
      productName: true,
      imageUrl: true,
    },
  });

  let updated = 0;

  for (const product of linked) {
    const cached = await prisma.tcgProduct.findUnique({
      where: { productId: product.tcgProductId! },
      select: { marketPrice: true, name: true, imageUrl: true },
    });
    if (!cached) continue;

    const data: Record<string, unknown> = {};

    if (cached.marketPrice != null) {
      const next = Number(cached.marketPrice);
      if (product.marketPrice == null || Number(product.marketPrice) !== next) {
        data.marketPrice = next;
        data.pricedAt = new Date();
      }
    }

    if (cached.name && cached.name !== product.productName) {
      data.productName = cached.name;
    }

    if (cached.imageUrl && cached.imageUrl !== product.imageUrl) {
      data.imageUrl = cached.imageUrl;
    }

    // Snapshot today's price even when nothing changed — a flat line is
    // information too, and a gap would look like missing data.
    await recordSnapshot(
      product.id,
      cached.marketPrice != null ? Number(cached.marketPrice) : null,
      Number(product.retailPrice),
    );

    if (Object.keys(data).length === 0) continue;

    await prisma.product.update({ where: { id: product.id }, data });
    updated++;
  }

  return updated;
}

/** Typeahead over the local cache. No network call. */
export async function searchTcgProducts(query: string, limit = 12) {
  const q = query.trim();
  if (q.length < 3) return [];

  return prisma.tcgProduct.findMany({
    where: { name: { contains: q, mode: "insensitive" } },
    orderBy: [{ marketPrice: "desc" }],
    take: limit,
    select: {
      productId: true,
      name: true,
      categoryId: true,
      categoryName: true,
      groupId: true,
      groupName: true,
      marketPrice: true,
      imageUrl: true,
    },
  });
}
