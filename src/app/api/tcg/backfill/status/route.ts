import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getPriceBackfillProgress } from "@/lib/price-backfill-progress";

export async function GET() {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "Only admins can view backfill progress." }, { status: 403 });
  }
  return NextResponse.json(getPriceBackfillProgress());
}
