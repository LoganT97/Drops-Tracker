import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

/** Tax rate, marketplace fee, and shipping are per-user — everyone's ROI is their own. */
export async function PATCH(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const { taxRate, marketplaceFeePct, shippingCost } = await req.json();

  const user = await prisma.user.update({
    where: { id: session.user.id },
    data: {
      ...(taxRate !== undefined && { taxRate }),
      ...(marketplaceFeePct !== undefined && { marketplaceFeePct }),
      ...(shippingCost !== undefined && { shippingCost }),
    },
    select: { taxRate: true, marketplaceFeePct: true, shippingCost: true },
  });

  return NextResponse.json(user);
}
