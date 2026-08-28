import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

async function requireAdmin() {
  const session = await auth();
  return session?.user?.role === "ADMIN" ? session : null;
}

export async function GET() {
  if (!await requireAdmin()) {
    return NextResponse.json({ error: "Only admins can manage unmatched TCINs." }, { status: 403 });
  }

  const events = await prisma.untrackedDropEvent.findMany({
    where: { retailer: "TARGET" },
    orderBy: [{ dropDate: "desc" }, { sku: "asc" }],
    select: { sku: true, dropDate: true },
  });
  const grouped = new Map<string, string[]>();
  for (const event of events) {
    const dates = grouped.get(event.sku) ?? [];
    dates.push(event.dropDate.toISOString().slice(0, 10));
    grouped.set(event.sku, dates);
  }

  return NextResponse.json({
    groups: [...grouped].map(([sku, dates]) => ({ sku, dates })),
  });
}

export async function POST(req: Request) {
  if (!await requireAdmin()) {
    return NextResponse.json({ error: "Only admins can manage unmatched TCINs." }, { status: 403 });
  }
  const body = await req.json();
  const sku = String(body.sku ?? "").trim();
  const productId = String(body.productId ?? "").trim();
  if (!sku || !productId) return NextResponse.json({ error: "Choose a product first." }, { status: 400 });

  const product = await prisma.product.findFirst({
    where: { id: productId, retailer: "TARGET", active: true },
    select: { id: true },
  });
  if (!product) return NextResponse.json({ error: "That Target product no longer exists." }, { status: 404 });

  const events = await prisma.untrackedDropEvent.findMany({
    where: { retailer: "TARGET", sku },
    select: { dropDate: true },
  });
  const [, removed] = await prisma.$transaction([
    prisma.dropEvent.createMany({
      data: events.map((event) => ({ productId, dropDate: event.dropDate })),
      skipDuplicates: true,
    }),
    prisma.untrackedDropEvent.deleteMany({ where: { retailer: "TARGET", sku } }),
  ]);
  return NextResponse.json({ applied: events.length, removed: removed.count });
}

export async function DELETE(req: Request) {
  if (!await requireAdmin()) {
    return NextResponse.json({ error: "Only admins can manage unmatched TCINs." }, { status: 403 });
  }
  const body = await req.json();
  const sku = String(body.sku ?? "").trim();
  if (!sku) return NextResponse.json({ error: "A TCIN is required." }, { status: 400 });
  const removed = await prisma.untrackedDropEvent.deleteMany({ where: { retailer: "TARGET", sku } });
  return NextResponse.json({ removed: removed.count });
}
