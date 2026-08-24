import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { BRANDS } from "@/lib/retailers";

/** Inline edits from the table land here — one field at a time is fine. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

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

  if (data.retailPrice === null) {
    return NextResponse.json({ error: "Retail price can't be blank." }, { status: 400 });
  }

  return NextResponse.json(await prisma.product.update({ where: { id }, data }));
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const { id } = await params;
  await prisma.product.update({ where: { id }, data: { active: false } });
  return NextResponse.json({ ok: true });
}
