import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { parseProductUrl } from "@/lib/retailers";

type ProductData = { name?: string; price?: number; imageUrl?: string };

function textMeta(html: string, key: string): string | undefined {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["']`, "i"),
  ];
  return patterns.map((pattern) => html.match(pattern)?.[1]).find(Boolean);
}

function decodeHtml(value: string | undefined): string | undefined {
  return value?.replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function readProduct(node: unknown): ProductData | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = readProduct(child);
      if (found) return found;
    }
    return null;
  }
  const value = node as Record<string, unknown>;
  const type = value["@type"];
  if (type === "Product" || (Array.isArray(type) && type.includes("Product"))) {
    const offers = Array.isArray(value.offers) ? value.offers[0] : value.offers;
    const offer = offers && typeof offers === "object" ? offers as Record<string, unknown> : {};
    const image = Array.isArray(value.image) ? value.image[0] : value.image;
    const price = Number(offer.price ?? offer.lowPrice);
    return {
      name: typeof value.name === "string" ? value.name : undefined,
      imageUrl: typeof image === "string" ? image : undefined,
      price: Number.isFinite(price) && price >= 0 ? price : undefined,
    };
  }
  for (const child of Object.values(value)) {
    const found = readProduct(child);
    if (found) return found;
  }
  return null;
}

function structuredProduct(html: string): ProductData {
  const scripts = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const match of scripts) {
    try {
      const found = readProduct(JSON.parse(match[1]));
      if (found) return found;
    } catch { /* Continue to metadata fallback. */ }
  }
  return {};
}

function targetOrchestrationUrl(html: string): URL | null {
  const match = html.match(/https:\/\/cdui-orchestrations\.target\.com\/cdui_orchestrations\/v1\/pages\/pdp\?[^"'<]+/i);
  if (!match) return null;
  try {
    const decoded = match[0].replace(/\\u0026/g, "&").replace(/\\\//g, "/");
    const url = new URL(decoded);
    if (url.hostname !== "cdui-orchestrations.target.com") return null;
    url.searchParams.set("is_seo_bot", "true");
    return url;
  } catch {
    return null;
  }
}

function targetRetailPrice(node: unknown, tcin: string): number | undefined {
  if (!node || typeof node !== "object") return undefined;
  if (Array.isArray(node)) {
    for (const child of node) {
      const price = targetRetailPrice(child, tcin);
      if (price != null) return price;
    }
    return undefined;
  }

  const value = node as Record<string, unknown>;
  if (String(value.tcin ?? "") === tcin) {
    const priceObject = value.price && typeof value.price === "object"
      ? value.price as Record<string, unknown>
      : undefined;
    const price = Number(value.current_retail ?? priceObject?.current_retail);
    if (Number.isFinite(price) && price >= 0) return price;
  }

  for (const child of Object.values(value)) {
    const price = targetRetailPrice(child, tcin);
    if (price != null) return price;
  }
  return undefined;
}

async function fetchTargetRetailPrice(html: string, tcin: string): Promise<number | undefined> {
  const url = targetOrchestrationUrl(html);
  if (!url) return undefined;
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        "User-Agent": "Googlebot/2.1 (+http://www.google.com/bot.html)",
        Accept: "application/json",
      },
    });
    if (!response.ok) return undefined;
    return targetRetailPrice(await response.json(), tcin);
  } catch {
    return undefined;
  }
}

export async function POST(req: Request) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "Only editors can look up products." }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const rawUrl = typeof body.url === "string" ? body.url.trim() : "";
  const parsed = parseProductUrl(rawUrl);
  if (parsed.retailer !== "TARGET" || !parsed.sku || !parsed.productUrl) {
    return NextResponse.json({ error: "Enter a valid Target product link." }, { status: 400 });
  }

  try {
    const response = await fetch(parsed.productUrl, {
      cache: "no-store",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (!response.ok) throw new Error(`Target returned ${response.status}`);
    const html = await response.text();
    const product = structuredProduct(html);
    const metaPrice = Number(textMeta(html, "product:price:amount"));
    const price = product.price
      ?? (Number.isFinite(metaPrice) ? metaPrice : undefined)
      ?? await fetchTargetRetailPrice(html, parsed.sku);
    return NextResponse.json({
      sku: parsed.sku,
      productUrl: parsed.productUrl,
      name: decodeHtml(product.name ?? textMeta(html, "og:title")) ?? parsed.productName,
      retailPrice: price,
      imageUrl: decodeHtml(product.imageUrl ?? textMeta(html, "og:image")),
    });
  } catch (error) {
    console.error("Target product lookup failed", error);
    return NextResponse.json(
      { error: "Target did not return product details. The link fields were still filled in." },
      { status: 502 },
    );
  }
}
