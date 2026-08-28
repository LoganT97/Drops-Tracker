import { NextResponse } from "next/server";
import type { OrderStatus } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

const EDITABLE_STATUSES = new Set<OrderStatus>([
  "ORDERED",
  "SHIPPED",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "CANCELLED",
  "DELAYED",
]);

function cleanIds(value: unknown) {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === "string" && item.length > 0))].slice(0, 250)
    : [];
}

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { ids?: unknown; status?: unknown };
  const ids = cleanIds(body.ids);
  const status = body.status as OrderStatus;
  if (ids.length === 0 || !EDITABLE_STATUSES.has(status)) {
    return NextResponse.json({ error: "Select orders and a valid status." }, { status: 400 });
  }

  const owned = await prisma.orderRecord.findMany({
    where: { id: { in: ids }, userId: session.user.id },
    select: { id: true },
  });
  const ownedIds = owned.map((order) => order.id);
  await prisma.$transaction([
    prisma.orderRecord.updateMany({ where: { id: { in: ownedIds } }, data: { status, lastUpdateAt: new Date() } }),
    prisma.shipment.updateMany({ where: { orderId: { in: ownedIds } }, data: { status } }),
  ]);
  return NextResponse.json({ updated: ownedIds.length });
}

export async function DELETE(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { ids?: unknown };
  const ids = cleanIds(body.ids);
  if (ids.length === 0) return NextResponse.json({ error: "Select at least one order." }, { status: 400 });

  const owned = await prisma.orderRecord.findMany({
    where: { id: { in: ids }, userId: session.user.id },
    select: { id: true },
  });
  const ownedIds = owned.map((order) => order.id);
  await prisma.$transaction([
    prisma.orderMessage.deleteMany({ where: { orderId: { in: ownedIds }, userId: session.user.id } }),
    prisma.orderRecord.deleteMany({ where: { id: { in: ownedIds }, userId: session.user.id } }),
  ]);
  return NextResponse.json({ deleted: ownedIds.length });
}
