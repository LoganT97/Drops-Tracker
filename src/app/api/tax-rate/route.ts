import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { lookupTaxRate } from "@/lib/tax";

/** Look up a tax rate from a ZIP or Canadian postal code. */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const code = new URL(req.url).searchParams.get("code") ?? "";
  const result = await lookupTaxRate(code);

  if (!result) {
    return NextResponse.json(
      { error: "No rate found for that code. Enter the tax rate by hand." },
      { status: 404 },
    );
  }

  return NextResponse.json(result);
}
