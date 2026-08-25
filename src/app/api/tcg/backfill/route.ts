import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { backfillPriceHistory } from "@/lib/price-backfill";
import { beginPriceBackfill, finishPriceBackfill } from "@/lib/price-backfill-progress";

export const maxDuration = 1800;

export async function POST() {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "Only admins can backfill price history." }, { status: 403 });
  }
  const days = 30;
  if (!beginPriceBackfill(days)) {
    return NextResponse.json({ error: "A price-history backfill is already running." }, { status: 409 });
  }
  try {
    const result = await backfillPriceHistory(null, days);
    finishPriceBackfill();
    return NextResponse.json(result);
  } catch (error) {
    const message = (error as Error).message;
    finishPriceBackfill(message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
