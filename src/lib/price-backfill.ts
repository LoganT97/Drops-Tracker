import { createWriteStream } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { prisma } from "@/lib/db";
import { updatePriceBackfill } from "@/lib/price-backfill-progress";

const exec = promisify(execFile);
const BASE = "https://tcgcsv.com/archive/tcgplayer";
const UA = "DropBuddy/1.0";

function sevenZipPath(): string {
  if (process.env.USE_SYSTEM_7ZA === "true") return "7za";
  if (process.platform === "win32") {
    return join(process.cwd(), "node_modules", "7zip-bin", "win", process.arch, "7za.exe");
  }
  if (process.platform === "darwin") {
    return join(process.cwd(), "node_modules", "7zip-bin", "mac", process.arch, "7za");
  }
  return join(process.cwd(), "node_modules", "7zip-bin", "linux", process.arch, "7za");
}

type ArchivePrice = { productId: number; marketPrice: number | null; midPrice: number | null };

export async function backfillPriceHistory(productId: string | null, days = 30) {
  const linked = await prisma.product.findMany({
    where: { ...(productId ? { id: productId } : {}), active: true, tcgProductId: { not: null } },
    select: { id: true, tcgProductId: true, retailPrice: true },
  });
  if (linked.length === 0) return { snapshots: 0, days: 0, skippedDays: 0 };

  const cached = await prisma.tcgProduct.findMany({
    where: { productId: { in: linked.map((product) => product.tcgProductId!) } },
    select: { productId: true, categoryId: true, groupId: true },
  });
  const locationByProduct = new Map(cached.map((product) => [product.productId, product]));
  const paths = [...new Set(cached.map((product) => `${product.categoryId}/${product.groupId}/prices`))];
  const workspace = join(tmpdir(), `drops-tracker-backfill-${crypto.randomUUID()}`);
  await mkdir(workspace, { recursive: true });

  let snapshots = 0;
  let skippedDays = 0;
  try {
    for (let offset = days; offset >= 1; offset--) {
      const date = new Date();
      date.setUTCDate(date.getUTCDate() - offset);
      const day = date.toISOString().slice(0, 10);
      const processedDays = days - offset;
      updatePriceBackfill({
        percent: Math.max(2, Math.round((processedDays / days) * 100)),
        processedDays,
        stage: `Downloading prices for ${day}…`,
        snapshots,
      });

      const archivePath = join(workspace, `${day}.7z`);
      const extractPath = join(workspace, day);
      const response = await fetch(`${BASE}/prices-${day}.ppmd.7z`, {
        headers: { "User-Agent": UA },
        cache: "no-store",
      });
      if (!response.ok || !response.body) {
        skippedDays++;
        updatePriceBackfill({
          percent: Math.round(((processedDays + 1) / days) * 100),
          processedDays: processedDays + 1,
          stage: `No archive available for ${day}`,
          snapshots,
        });
        continue;
      }

      await pipeline(Readable.fromWeb(response.body as never), createWriteStream(archivePath));
      updatePriceBackfill({ stage: `Extracting tracked products for ${day}…` });
      const archiveTargets = paths.map((path) => `${day}/${path}`);
      await exec(sevenZipPath(), ["x", archivePath, `-o${extractPath}`, "-y", "-bso0", "-bsp0", ...archiveTargets], {
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      });

      const bestPrice = new Map<number, number>();
      for (const productPath of paths) {
        try {
          const raw = await readFile(join(extractPath, day, ...productPath.split("/")), "utf8");
          const parsed = JSON.parse(raw) as { results?: ArchivePrice[] } | ArchivePrice[];
          const prices = Array.isArray(parsed) ? parsed : parsed.results ?? [];
          for (const price of prices) {
            const value = price.marketPrice ?? price.midPrice;
            if (value != null && !bestPrice.has(price.productId)) bestPrice.set(price.productId, value);
            if (price.marketPrice != null) bestPrice.set(price.productId, price.marketPrice);
          }
        } catch {
          // A group may not have existed yet on this date.
        }
      }

      const capturedOn = new Date(`${day}T00:00:00.000Z`);
      const writes = linked.flatMap((product) => {
        if (!locationByProduct.has(product.tcgProductId!)) return [];
        const marketPrice = bestPrice.get(product.tcgProductId!);
        if (marketPrice == null) return [];
        snapshots++;
        return [prisma.priceSnapshot.upsert({
          where: { productId_capturedOn: { productId: product.id, capturedOn } },
          create: { productId: product.id, capturedOn, marketPrice, retailPrice: product.retailPrice },
          update: { marketPrice },
        })];
      });
      if (writes.length) await prisma.$transaction(writes);

      await rm(archivePath, { force: true });
      await rm(extractPath, { recursive: true, force: true });
      updatePriceBackfill({
        percent: Math.round(((processedDays + 1) / days) * 100),
        processedDays: processedDays + 1,
        stage: `Imported ${day}`,
        snapshots,
      });
    }
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }

  return { snapshots, days, skippedDays };
}
