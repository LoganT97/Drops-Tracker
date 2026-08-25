import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { BRANDS } from "@/lib/retailers";
import { recordSnapshot } from "@/lib/history";
import { buildChanges, recordAudit } from "@/lib/audit";

/** Inline edits from the table land here — one field at a time is fine. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Only editors can change SKUs." }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();
  const data: Record<string, unknown> = {};

  for (const field of ["productName", "sku", "imageUrl", "productUrl", "notes"]) {
    if (body[field] !== undefined) data[field] = body[field] || null;
  }

  if (body.brand !== undefined) {
    if (!(BRANDS as readonly string[]).includes(body.brand)) {
      return NextResponse.json({ error: "Pick a brand from the list." }, { status: 400 });
    }
    data.brand = body.brand;
  }
  if (body.prerelease !== undefined) data.prerelease = body.prerelease === true;
  if (body.releaseDate !== undefined) {
    const text = String(body.releaseDate ?? "").trim();
    if (!text) data.releaseDate = null;
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(new Date(`${text}T00:00:00.000Z`).getTime())) {
      return NextResponse.json({ error: "Release date must be a valid date." }, { status: 400 });
    } else data.releaseDate = new Date(`${text}T00:00:00.000Z`);
  }
  for (const field of ["retailPrice", "marketPrice"]) {
    if (body[field] !== undefined) {
      const n = Number(body[field]);
      if (body[field] === null || body[field] === "") data[field] = null;
      else if (!Number.isFinite(n)) {
        return NextResponse.json({ error: `${field} must be a number.` }, { status: 400 });
      } else data[field] = n;
      data.pricedAt = new Date();
    }
  }

  // Linking or unlinking a TCGplayer product. Send tcgProductId: null to
  // detach and go back to typing the price by hand.
  if (body.tcgProductId !== undefined) {
    data.tcgProductId = body.tcgProductId ?? null;
    data.tcgCategoryId = body.tcgCategoryId ?? null;
    data.tcgGroupId = body.tcgGroupId ?? null;
  }

  if (data.retailPrice === null) {
    return NextResponse.json({ error: "Retail price can't be blank." }, { status: 400 });
  }

  const before = await prisma.product.findUniqueOrThrow({ where: { id } });
  const updated = await prisma.product.update({ where: { id }, data });
  await recordAudit({
    productId: id,
    actorId: session.user.id,
    actorName: session.user.name ?? "Admin",
    action: "updated",
    changes: buildChanges(before as unknown as Record<string, unknown>, data),
  });

  // Manual price edits build history too, so unlinked SKUs still get a chart.
  if (data.marketPrice !== undefined || data.retailPrice !== undefined) {
    await recordSnapshot(
      updated.id,
      updated.marketPrice != null ? Number(updated.marketPrice) : null,
      Number(updated.retailPrice),
    );
  }

  return NextResponse.json(updated);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Only editors can remove SKUs." }, { status: 403 });
  }

  const { id } = await params;
  await prisma.product.update({ where: { id }, data: { active: false } });
  await recordAudit({
    productId: id,
    actorId: session.user.id,
    actorName: session.user.name ?? "Admin",
    action: "removed",
    changes: { active: { from: true, to: false } },
  });
  return NextResponse.json({ ok: true });
}
