import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { gmailOAuthUrl } from "@/lib/gmail";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.redirect(new URL("/login", request.url));

  const state = randomBytes(24).toString("base64url");
  try {
    const origin = (process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? new URL(request.url).origin).replace(/\/$/, "");
    const response = NextResponse.redirect(gmailOAuthUrl(origin, state));
    response.cookies.set("gmail_oauth_state", state, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/api/gmail/callback",
      maxAge: 10 * 60,
    });
    return response;
  } catch {
    return NextResponse.redirect(new URL("/orders?gmail=not-configured", request.url));
  }
}
