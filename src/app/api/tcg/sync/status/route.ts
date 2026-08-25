import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getTcgSyncProgress } from "@/lib/tcg-sync-progress";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Only admins can view sync progress." }, { status: 403 });
  }
  return NextResponse.json(getTcgSyncProgress());
}
