import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getHistory } from "@/lib/history";

/** Price history for one SKU. Viewers can read it too — it's just numbers. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const { id } = await params;
  const days = Number(new URL(req.url).searchParams.get("days") ?? 30);

  return NextResponse.json(await getHistory(id, Number.isFinite(days) ? days : 30));
}
