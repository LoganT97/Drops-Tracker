import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export async function PUT(req: Request, context: { params: Promise<{ productId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { productId } = await context.params;
  const body = await req.json();
  const watched = body.watched === true;

  const product = await prisma.product.findFirst({ where: { id: productId, active: true }, select: { id: true } });
  if (!product) return NextResponse.json({ error: "That product no longer exists." }, { status: 404 });

  if (watched) {
    await prisma.watchlistEntry.upsert({
      where: { userId_productId: { userId: session.user.id, productId } },
      create: { userId: session.user.id, productId },
      update: {},
    });
  } else {
    await prisma.watchlistEntry.deleteMany({ where: { userId: session.user.id, productId } });
  }
  return NextResponse.json({ watched });
}
