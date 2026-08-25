import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Only admins can view users." }, { status: 403 });
  }

  const users = await prisma.user.findMany({
    orderBy: [{ lastLoginAt: "desc" }, { username: "asc" }],
    select: {
      id: true,
      username: true,
      avatarUrl: true,
      role: true,
      lastLoginAt: true,
      createdAt: true,
    },
  });
  return NextResponse.json(users);
}
