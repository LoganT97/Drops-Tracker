import type { OrderStatus } from "@prisma/client";

export type CatalogMatch = {
  id: string;
  sku: string;
  productName: string;
  imageUrl: string | null;
  retailPrice: unknown;
};

export type ParsedTargetEmail = {
  orderNumber: string;
  status: OrderStatus;
  total: number | null;
  tracking: Array<{ number: string; carrier: string | null }>;
  items: Array<{
    productId: string | null;
    sku: string | null;
    productName: string;
    imageUrl: string | null;
    quantity: number;
    unitPrice: number | null;
  }>;
};

function decodeHtml(value: string) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;|&#x27;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function plainText(value: string) {
  return decodeHtml(value)
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function attribute(tag: string, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return decodeHtml(tag.match(new RegExp(`\\b${escaped}\\s*=\\s*["']([^"']+)["']`, "i"))?.[1] ?? "");
}

function targetItemTcins(text: string, html: string) {
  const tcins = new Set<string>();
  for (const match of `${text}\n${html}`.matchAll(/(?:\/A-|TCIN\s*[:#]?\s*)(\d{8,12})\b/gi)) tcins.add(match[1]);
  return [...tcins];
}

function productEmailMetadata(html: string, sku: string) {
  const skuIndex = html.search(new RegExp(`(?:/A-|TCIN[^0-9]{0,12})${sku}\\b`, "i"));
  const windowStart = Math.max(0, skuIndex - 3000);
  const windowEnd = skuIndex < 0 ? html.length : Math.min(html.length, skuIndex + 3000);
  const nearby = html.slice(windowStart, windowEnd);

  let name = "";
  let imageUrl = "";
  const imageTags = [...nearby.matchAll(/<img\b[^>]*>/gi)].map((match) => match[0]);
  const productImage = imageTags.find((tag) => /scene7|targetimg|digitalcontent\.target/i.test(attribute(tag, "src")))
    ?? imageTags.find((tag) => {
      const alt = attribute(tag, "alt");
      return alt.length > 8 && !/^target$|logo|icon|spacer/i.test(alt);
    });
  if (productImage) {
    imageUrl = attribute(productImage, "src");
    name = attribute(productImage, "alt");
  }

  const linkedProduct = [...nearby.matchAll(/<a\b[^>]*href\s*=\s*["'][^"']*(?:\/A-|TCIN[^0-9]{0,12})\d{8,12}[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => plainText(match[1]))
    .find((value) => value.length > 8 && !/^(view|track|shop|see)\b/i.test(value));
  if (linkedProduct) name = linkedProduct;

  const quantity = Math.max(1, Number(nearby.match(/(?:qty|quantity)\s*[:x]?\s*(\d+)/i)?.[1] ?? 1));
  const priceText = nearby.match(/(?:price|each|item)[^$]{0,40}\$\s*([\d,]+\.\d{2})/i)?.[1];
  const unitPrice = priceText ? Number(priceText.replace(/,/g, "")) : null;
  return { name: plainText(name), imageUrl, quantity, unitPrice };
}

function normalizedProductName(value: string) {
  return plainText(value)
    .toLowerCase()
    .replace(/pok[eé]mon\s+(?:trading\s+card\s+game|tcg)\s*:?/gi, "")
    .replace(/(?:styles?|art)\s+may\s+vary/gi, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function catalogProductForName(name: string, catalog: CatalogMatch[]) {
  const normalized = normalizedProductName(name);
  if (normalized.length < 8) return undefined;
  return catalog.find((candidate) => {
    const catalogName = normalizedProductName(candidate.productName);
    return catalogName === normalized
      || (Math.min(catalogName.length, normalized.length) >= 14
        && (catalogName.includes(normalized) || normalized.includes(catalogName)));
  });
}

function productItemsFromImages(html: string, catalog: CatalogMatch[]) {
  const items: ParsedTargetEmail["items"] = [];
  const seen = new Set<string>();

  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    const src = attribute(tag, "src") || attribute(tag, "data-src") || attribute(tag, "data-original");
    const alt = plainText(attribute(tag, "alt"));
    const width = Number(attribute(tag, "width") || 0);
    const height = Number(attribute(tag, "height") || 0);
    const productHost = /scene7|targetimg|digitalcontent\.target|target\.scene7/i.test(src);
    const genericAlt = !alt
      || alt.length < 8
      || /^(target|logo|icon|spacer|facebook|instagram|pinterest|twitter|youtube|image)$/i.test(alt);
    const templateArtwork = /target\s+(?:logo|circle|guest|shopper|shopping|customer)|bullseye|customer\s+service|discover|mobile\s+phone|running\s+and\s+playing|social\s+media/i.test(alt);
    if (!src || (width > 0 && width < 40) || (height > 0 && height < 40)) continue;
    if (templateArtwork || (!productHost && genericAlt)) continue;

    const product = genericAlt ? undefined : catalogProductForName(alt, catalog);
    if (genericAlt && !product) continue;

    const productName = product?.productName || alt;
    if (!productName) continue;
    const key = product?.sku ?? normalizedProductName(productName);
    if (!key || seen.has(key)) continue;
    seen.add(key);

    const index = match.index ?? 0;
    const nearby = html.slice(Math.max(0, index - 1800), Math.min(html.length, index + 2400));
    const quantityText = nearby.match(/(?:qty|quantity)\s*[:x]?\s*(\d+)/i)?.[1];
    const priceText = nearby.match(/(?:price|each|item)[^$]{0,60}\$\s*([\d,]+\.\d{2})/i)?.[1];
    // A catalog match is definitive. Otherwise, require transactional text
    // near the image so decorative Target email artwork is never an order item.
    if (!product && !quantityText && !priceText) continue;
    const quantity = Math.max(1, Number(quantityText ?? 1));
    const emailPrice = priceText ? Number(priceText.replace(/,/g, "")) : null;
    items.push({
      productId: product?.id ?? null,
      sku: product?.sku ?? null,
      productName,
      imageUrl: src || product?.imageUrl || null,
      quantity,
      unitPrice: emailPrice ?? (product?.retailPrice == null ? null : Number(product.retailPrice)),
    });
  }

  return items;
}

function statusFromText(text: string): OrderStatus {
  if (/\b(cancelled|canceled|cancellation)\b/i.test(text)) return "CANCELLED";
  if (/\b(delivered|was delivered)\b/i.test(text)) return "DELIVERED";
  if (/\bout for delivery\b/i.test(text)) return "OUT_FOR_DELIVERY";
  if (/\b(delayed|delay)\b/i.test(text)) return "DELAYED";
  if (/\b(shipped|has shipped|on (?:its|the) way)\b/i.test(text)) return "SHIPPED";
  if (/\b(order received|order confirmed|thanks for your order|we received your order)\b/i.test(text)) return "ORDERED";
  return "UNKNOWN";
}

function orderNumberFromText(text: string) {
  const patterns = [
    /(?:target\s+)?order(?:\s+number|\s*#|\s+no\.?)?\s*[:#]?\s*([0-9][0-9-]{9,24})/i,
    /(?:view|track)\s+order\s+([0-9][0-9-]{9,24})/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern)?.[1]?.replace(/-/g, "");
    if (match && match.length >= 10) return match;
  }
  return null;
}

function totalFromText(text: string) {
  const patterns = [
    /(?:order\s+total|total)\s*[:\s]*\$\s*([\d,]+\.\d{2})/i,
    /(?:charged|payment\s+total)\s*[:\s]*\$\s*([\d,]+\.\d{2})/i,
  ];
  for (const pattern of patterns) {
    const value = pattern.exec(text)?.[1];
    if (value) return Number(value.replace(/,/g, ""));
  }
  return null;
}

function trackingFromText(text: string) {
  const found = new Map<string, string | null>();
  for (const match of text.matchAll(/\b(1Z[0-9A-Z]{16})\b/gi)) found.set(match[1].toUpperCase(), "UPS");
  for (const match of text.matchAll(/(?:tracking(?:\s+number|\s*#)?|track(?:\s+package)?)\s*[:#]?\s*(\d{12,15})\b/gi)) {
    found.set(match[1], "FedEx");
  }
  for (const match of text.matchAll(/(?:tracking(?:\s+number|\s*#)?|USPS)\s*[:#]?\s*(\d{20,22})\b/gi)) {
    found.set(match[1], "USPS");
  }
  return [...found].map(([number, carrier]) => ({ number, carrier }));
}

export function parseTargetEmail(subject: string, body: string, catalog: CatalogMatch[], html = ""): ParsedTargetEmail | null {
  const text = `${subject}\n${body}`;
  const searchableHtml = decodeHtml(html)
    .replace(/%2F/gi, "/")
    .replace(/%2D/gi, "-")
    .replace(/\\u0026/g, "&");
  const orderNumber = orderNumberFromText(text);
  if (!orderNumber) return null;

  const imageItems = productItemsFromImages(searchableHtml, catalog);
  const tcinItems = targetItemTcins(text, searchableHtml).map((sku) => {
      const product = catalog.find((candidate) => candidate.sku === sku);
      const email = productEmailMetadata(searchableHtml, sku);
      const imageItem = imageItems.find((item) => item.sku === sku)
        ?? imageItems.find((item) => normalizedProductName(item.productName) === normalizedProductName(email.name || product?.productName || ""));
      const quantityMatch = text.match(new RegExp(`${sku}[\\s\\S]{0,160}?(?:qty|quantity)\\s*[:x]?\\s*(\\d+)`, "i"));
      return {
        productId: product?.id ?? null,
        sku,
        productName: email.name || imageItem?.productName || product?.productName || `Target item ${sku}`,
        imageUrl: email.imageUrl || imageItem?.imageUrl || product?.imageUrl || null,
        quantity: Math.max(1, Number(quantityMatch?.[1] ?? email.quantity)),
        unitPrice: email.unitPrice ?? (product?.retailPrice == null ? null : Number(product.retailPrice)),
      };
    });
  const tcinSkus = new Set(tcinItems.map((item) => item.sku));
  const tcinNames = new Set(tcinItems.map((item) => normalizedProductName(item.productName)));
  const items = [
    ...tcinItems,
    ...imageItems.filter((item) => !item.sku || !tcinSkus.has(item.sku))
      .filter((item) => !tcinNames.has(normalizedProductName(item.productName))),
  ];

  return {
    orderNumber,
    status: statusFromText(text),
    total: totalFromText(text),
    tracking: trackingFromText(text),
    items,
  };
}
