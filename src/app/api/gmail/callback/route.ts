import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { encryptGmailToken } from "@/lib/gmail-crypto";
import { exchangeGmailCode, gmailProfile } from "@/lib/gmail";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.redirect(new URL("/login", request.url));

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const expectedState = request.cookies.get("gmail_oauth_state")?.value;
  const destination = new URL("/orders", request.url);

  if (!code || !state || !expectedState || state !== expectedState) {
    destination.searchParams.set("gmail", "invalid-state");
    return NextResponse.redirect(destination);
  }

  try {
    const origin = (process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? request.nextUrl.origin).replace(/\/$/, "");
    const token = await exchangeGmailCode(code, origin);
    const profile = await gmailProfile(token.access_token);
    const existing = await prisma.gmailConnection.findUnique({ where: { userId: session.user.id } });

    await prisma.gmailConnection.upsert({
      where: { userId: session.user.id },
      create: {
        userId: session.user.id,
        email: profile.emailAddress,
        accessTokenEncrypted: encryptGmailToken(token.access_token),
        refreshTokenEncrypted: token.refresh_token ? encryptGmailToken(token.refresh_token) : null,
        tokenExpiresAt: new Date(Date.now() + (token.expires_in ?? 3600) * 1000),
        lastHistoryId: profile.historyId,
      },
      update: {
        email: profile.emailAddress,
        accessTokenEncrypted: encryptGmailToken(token.access_token),
        refreshTokenEncrypted: token.refresh_token
          ? encryptGmailToken(token.refresh_token)
          : existing?.refreshTokenEncrypted,
        tokenExpiresAt: new Date(Date.now() + (token.expires_in ?? 3600) * 1000),
        lastHistoryId: profile.historyId,
        lastError: null,
        orderHistoryPageToken: null,
        orderHistoryScanned: 0,
        orderHistoryBackfilledAt: null,
      },
    });
    destination.searchParams.set("gmail", "connected");
  } catch (error) {
    destination.searchParams.set("gmail", "error");
    console.error("Gmail OAuth callback failed", error);
  }

  const response = NextResponse.redirect(destination);
  response.cookies.delete("gmail_oauth_state");
  return response;
}
