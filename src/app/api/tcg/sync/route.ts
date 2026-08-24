import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { syncTcgPrices } from "@/lib/tcg";

/** A full sync walks a few hundred sets — give it room. */
export const maxDuration = 800;

/**
 * Refresh the TCGplayer price cache.
 *
 * Accepts either an admin session (the button in the UI) or a bearer token
 * matching CRON_SECRET (the nightly cron job on the server).
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const session = await auth();
  const viaCron = !!secret && req.headers.get("authorization") === `Bearer ${secret}`;

  if (!viaCron && session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "Only editors can sync prices." }, { status: 403 });
  }

  const force = new URL(req.url).searchParams.get("force") === "1";

  try {
    return NextResponse.json(await syncTcgPrices(force));
  } catch (e) {
    const message = (e as Error).message;
    await prisma.syncState.upsert({
      where: { id: "tcgcsv" },
      create: { id: "tcgcsv", lastError: message },
      update: { lastError: message },
    });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export const GET = POST;
