export const RETAILERS = {
  TARGET: { label: "Target", tag: "TGT", skuLabel: "TCIN" },
  WALMART: { label: "Walmart", tag: "WMT", skuLabel: "Item ID" },
} as const;

export type RetailerKey = keyof typeof RETAILERS;

export const isRetailer = (v: string): v is RetailerKey => v in RETAILERS;

/**
 * The only games this site tracks. Fixed list so nobody types "Pokemon " or
 * "pokmon" and splits the data.
 *
 * Keep this in step with TRACKED in src/lib/tcg.ts — that's what decides which
 * TCGplayer categories get synced, and a brand here with no matching category
 * there would never find a market price.
 */
export const BRANDS = [
  "Pokemon",
  "One Piece",
  "Lorcana",
  "Magic: The Gathering",
] as const;

export type Brand = (typeof BRANDS)[number];

/**
 * Pull the SKU and a product name straight out of a pasted product link.
 *
 * This is pure string parsing — no network call, no API key, nothing that can
 * rate-limit or block us. Both retailers put the ID and a readable slug in the
 * URL, so a paste fills in most of the row:
 *
 *   target.com/p/pokemon-tcg-prismatic-evolutions-elite-trainer-box/-/A-93954435
 *   walmart.com/ip/Pokemon-TCG-Prismatic-Evolutions-Elite-Trainer-Box/1012055702
 *
 * Names come out close but not perfect — "Tcg" instead of "TCG" — so treat it
 * as a first draft the user cleans up, not gospel.
 */
export function parseProductUrl(input: string): {
  retailer?: RetailerKey;
  sku?: string;
  productName?: string;
  productUrl?: string;
} {
  const raw = input.trim();
  if (!raw) return {};

  let url: URL;
  try {
    url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
  } catch {
    return {};
  }

  const host = url.hostname.replace(/^www\./, "");
  const path = url.pathname;

  if (host.endsWith("target.com")) {
    // /p/<slug>/-/A-<tcin>
    const tcin = path.match(/\/A-(\d+)/i)?.[1];
    const slug = path.match(/\/p\/([^/]+)/)?.[1];
    return {
      retailer: "TARGET",
      sku: tcin,
      productName: slug ? titleize(slug) : undefined,
      productUrl: url.origin + path,
    };
  }

  if (host.endsWith("walmart.com")) {
    // /ip/<slug>/<itemId>  (slug is sometimes missing)
    const parts = path.split("/").filter(Boolean);
    const ipIndex = parts.indexOf("ip");
    if (ipIndex === -1) return { retailer: "WALMART", productUrl: url.origin + path };

    const rest = parts.slice(ipIndex + 1);
    const itemId = [...rest].reverse().find((p) => /^\d{6,}$/.test(p));
    const slug = rest.find((p) => !/^\d{6,}$/.test(p));
    return {
      retailer: "WALMART",
      sku: itemId,
      productName: slug ? titleize(slug) : undefined,
      productUrl: url.origin + path,
    };
  }

  return {};
}

/** Guess a brand from the product name so the dropdown starts on the right one. */
export function guessBrand(name: string): Brand {
  const n = name.toLowerCase();
  if (n.includes("pokemon") || n.includes("pokémon")) return "Pokemon";
  if (n.includes("one piece")) return "One Piece";
  if (n.includes("lorcana")) return "Lorcana";
  if (n.includes("magic") || n.includes("mtg")) return "Magic: The Gathering";
  return "Pokemon";
}

function titleize(slug: string) {
  return decodeURIComponent(slug)
    .replace(/[-_+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((w) => (w.length <= 3 && w === w.toUpperCase() ? w : w[0]?.toUpperCase() + w.slice(1)))
    .join(" ");
}
