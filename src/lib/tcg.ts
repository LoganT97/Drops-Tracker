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

/**
 * The only TCGplayer categories we sync, matched EXACTLY (case-insensitively)
 * against the category name.
 *
 * Exact, not substring: TCGplayer has ~89 categories including "Pokemon Japan",
 * which a substring match on "pokemon" would silently pull in — a whole extra
 * catalogue of products nobody here is buying off a Target shelf.
 *
 * If TCGplayer renames one of these, the sync logs every category it saw and
 * warns about the entry that matched nothing, so it fails loudly rather than
 * quietly skipping a game. Keep in step with BRANDS in src/lib/retailers.ts.
 */
const TRACKED = [
  "pokemon",
  "one piece card game",
  "lorcana tcg",
  "magic",
];

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
  presaleInfo?: { isPresale?: boolean; releasedOn?: string | null; note?: string | null };
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

  const wanted = categories.filter((c) => TRACKED.includes(c.name.trim().toLowerCase()));

  log(`tracking ${wanted.length} of ${categories.length} categories: ${wanted.map((c) => c.name).join(", ")}`);

  // Name drift would otherwise mean a game silently stops syncing.
  const missing = TRACKED.filter(
    (t) => !categories.some((c) => c.name.trim().toLowerCase() === t),
  );
  if (missing.length) {
    log(`WARNING: no category matched ${missing.join(", ")}`);
    log(`available categories: ${categories.map((c) => c.name).join(" | ")}`);
  }

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
          isPresale: p.presaleInfo?.isPresale === true,
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
 * Linking makes TCGplayer the source of truth for the photo and market price.
 * The name is adopted when a link is first chosen, then remains locally
 * editable so one TCGplayer product can describe retailer listings with
 * different assortments or random artwork.
 */
export async function applyPricesToProducts(): Promise<number> {
  const linked = await prisma.product.findMany({
    where: { active: true, tcgProductId: { not: null } },
    select: {
      id: true,
      tcgProductId: true,
      marketPrice: true,
      retailPrice: true,
      imageUrl: true,
      prerelease: true,
    },
  });

  let updated = 0;

  for (const product of linked) {
    const cached = await prisma.tcgProduct.findUnique({
      where: { productId: product.tcgProductId! },
      select: { marketPrice: true, imageUrl: true, isPresale: true },
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

    if (cached.imageUrl && cached.imageUrl !== product.imageUrl) {
      data.imageUrl = cached.imageUrl;
    }

    // TCGCSV is authoritative when it says an item is presale. Never
    // automatically clear a manual flag when TCGCSV later says false.
    if (cached.isPresale && !product.prerelease) {
      data.prerelease = true;
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

/**
 * Typeahead over the local cache. No network call.
 *
 * Matches word by word rather than as one contiguous string, because retailer
 * wording and TCGplayer wording rarely line up — "First Partner Illustration
 * Collection Series 2" versus "First Partner Pack Illustration Collection
 * (Series 2)". A whole-phrase match fails on a single extra or reordered word.
 *
 * Tokens like "pokemon" and "tcg" are treated as optional: they help rank a
 * result but never exclude one, since TCGplayer usually leaves them out of the
 * product name.
 */
const OPTIONAL_TOKENS = new Set([
  "pokemon", "pokémon", "tcg", "ccg", "card", "cards", "game", "the", "of",
  "and", "a", "an", "trading", "mtg", "magic", "lorcana", "disney",
]);

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export async function searchTcgProducts(query: string, limit = 20) {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];

  const required = tokens.filter((t) => !OPTIONAL_TOKENS.has(t));
  const terms = required.length ? required : tokens;

  const select = {
    productId: true,
    name: true,
    categoryId: true,
    categoryName: true,
    groupId: true,
    groupName: true,
    marketPrice: true,
    imageUrl: true,
    isPresale: true,
  } as const;

  // Every meaningful word must appear somewhere in the name, in any order.
  let rows = await prisma.tcgProduct.findMany({
    where: { AND: terms.map((t) => ({ name: { contains: t, mode: "insensitive" as const } })) },
    take: 200,
    select,
  });

  // Nothing matched everything — fall back to any word, so a typo in one word
  // doesn't leave the user staring at an empty list.
  if (rows.length === 0) {
    rows = await prisma.tcgProduct.findMany({
      where: { OR: terms.map((t) => ({ name: { contains: t, mode: "insensitive" as const } })) },
      take: 200,
      select,
    });
  }

  const wanted = new Set(tokens);

  const scored = rows.map((r) => {
    const nameTokens = tokenize(r.name);
    const nameSet = new Set(nameTokens);
    const hits = [...wanted].filter((t) => nameSet.has(t)).length;

    return {
      row: r,
      // more matched words wins; among equals, prefer the tighter name, then
      // the pricier product (sealed boxes over single packs of the same set)
      score:
        hits * 1000 -
        Math.abs(nameTokens.length - tokens.length) * 10 +
        (r.marketPrice ? Math.min(Number(r.marketPrice), 200) / 100 : 0),
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.row);
}
