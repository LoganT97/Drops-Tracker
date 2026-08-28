import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export async function DELETE() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await prisma.gmailConnection.deleteMany({ where: { userId: session.user.id } });
  return NextResponse.json({ disconnected: true });
}
