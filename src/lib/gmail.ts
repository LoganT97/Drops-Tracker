import { prisma } from "@/lib/db";
import { decryptGmailToken, encryptGmailToken } from "@/lib/gmail-crypto";

export type GmailHeader = { name: string; value: string };
export type GmailPart = {
  mimeType?: string;
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: GmailPart[];
};
export type GmailMessage = {
  id: string;
  threadId?: string;
  internalDate?: string;
  payload?: GmailPart & { headers?: GmailHeader[] };
};

function gmailCredentials() {
  const clientId = process.env.GOOGLE_GMAIL_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_GMAIL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Google Gmail OAuth credentials are not configured.");
  }
  return { clientId, clientSecret };
}

export function gmailOAuthUrl(origin: string, state: string) {
  const { clientId } = gmailCredentials();
  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${origin}/api/gmail/callback`,
    response_type: "code",
    scope: "openid email https://www.googleapis.com/auth/gmail.readonly",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${query}`;
}

export async function exchangeGmailCode(code: string, origin: string) {
  const { clientId, clientSecret } = gmailCredentials();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: `${origin}/api/gmail/callback`,
      grant_type: "authorization_code",
    }),
  });
  const result = await response.json() as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error_description?: string;
  };
  if (!response.ok || !result.access_token) {
    throw new Error(result.error_description ?? "Google did not return a Gmail access token.");
  }
  return result as Required<Pick<typeof result, "access_token">> & typeof result;
}

export async function gmailProfile(accessToken: string): Promise<{ emailAddress: string; historyId?: string }> {
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  const result = await response.json() as { emailAddress?: string; historyId?: string; error?: { message?: string } };
  if (!response.ok || !result.emailAddress) {
    throw new Error(result.error?.message ?? "Couldn't read the connected Gmail profile.");
  }
  return { emailAddress: result.emailAddress, historyId: result.historyId };
}

export async function validGmailAccessToken(userId: string) {
  const connection = await prisma.gmailConnection.findUnique({ where: { userId } });
  if (!connection) throw new Error("Connect Gmail before synchronizing orders.");

  const stillValid = connection.tokenExpiresAt && connection.tokenExpiresAt.getTime() > Date.now() + 60_000;
  if (stillValid) return { connection, accessToken: decryptGmailToken(connection.accessTokenEncrypted) };
  if (!connection.refreshTokenEncrypted) throw new Error("Reconnect Gmail to renew access.");

  const { clientId, clientSecret } = gmailCredentials();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: decryptGmailToken(connection.refreshTokenEncrypted),
      grant_type: "refresh_token",
    }),
  });
  const result = await response.json() as { access_token?: string; expires_in?: number; error_description?: string };
  if (!response.ok || !result.access_token) {
    throw new Error(result.error_description ?? "Google rejected the Gmail refresh token.");
  }

  const updated = await prisma.gmailConnection.update({
    where: { userId },
    data: {
      accessTokenEncrypted: encryptGmailToken(result.access_token),
      tokenExpiresAt: new Date(Date.now() + (result.expires_in ?? 3600) * 1000),
      lastError: null,
    },
  });
  return { connection: updated, accessToken: result.access_token };
}

async function gmailFetch<T>(accessToken: string, path: string) {
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  const result = await response.json() as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(result.error?.message ?? "The Gmail API request failed.");
  return result;
}

export async function listTargetMessagePage(
  accessToken: string,
  options: { after?: Date | null; pageToken?: string | null } = {},
) {
  const afterQuery = options.after
    ? ` after:${Math.floor((options.after.getTime() - 86_400_000) / 1000)}`
    : " newer_than:2y";
  const q = `from:(target.com) {subject:order subject:shipped subject:delivered subject:cancelled subject:canceled subject:tracking subject:"out for delivery"}${afterQuery}`;
  const params = new URLSearchParams({ q, maxResults: "100" });
  if (options.pageToken) params.set("pageToken", options.pageToken);
  const page = await gmailFetch<{
    messages?: Array<{ id: string; threadId?: string }>;
    nextPageToken?: string;
    resultSizeEstimate?: number;
  }>(accessToken, `messages?${params}`);

  return {
    messages: page.messages ?? [],
    nextPageToken: page.nextPageToken ?? null,
    estimatedTotal: page.resultSizeEstimate ?? null,
  };
}

export async function getGmailMessage(accessToken: string, id: string) {
  const message = await gmailFetch<GmailMessage>(accessToken, `messages/${encodeURIComponent(id)}?format=full`);
  const attachmentParts: GmailPart[] = [];
  const visit = (part?: GmailPart) => {
    if (!part) return;
    if (
      (part.mimeType === "text/plain" || part.mimeType === "text/html")
      && !part.body?.data
      && part.body?.attachmentId
    ) attachmentParts.push(part);
    for (const child of part.parts ?? []) visit(child);
  };
  visit(message.payload);

  await Promise.all(attachmentParts.map(async (part) => {
    const attachmentId = part.body?.attachmentId;
    if (!attachmentId) return;
    const attachment = await gmailFetch<{ data?: string }>(
      accessToken,
      `messages/${encodeURIComponent(id)}/attachments/${encodeURIComponent(attachmentId)}`,
    );
    if (attachment.data && part.body) part.body.data = attachment.data;
  }));

  return message;
}

export function gmailHeader(message: GmailMessage, name: string) {
  return message.payload?.headers?.find((header) => header.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function decodePart(data?: string) {
  if (!data) return "";
  return Buffer.from(data, "base64url").toString("utf8");
}

function collectBodies(part?: GmailPart, output: string[] = []) {
  if (!part) return output;
  if (part.body?.data && (part.mimeType === "text/plain" || part.mimeType === "text/html")) {
    output.push(decodePart(part.body.data));
  }
  for (const child of part.parts ?? []) collectBodies(child, output);
  return output;
}

function htmlToText(value: string) {
  return value
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p>|<\/div>|<\/tr>|<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x2F;/gi, "/")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function gmailMessageText(message: GmailMessage) {
  const bodies = collectBodies(message.payload);
  if (bodies.length === 0 && message.payload?.body?.data) bodies.push(decodePart(message.payload.body.data));
  return htmlToText(bodies.join("\n"));
}

export function gmailMessageHtml(message: GmailMessage) {
  const html: string[] = [];
  const visit = (part?: GmailPart) => {
    if (!part) return;
    if (part.mimeType === "text/html" && part.body?.data) html.push(decodePart(part.body.data));
    for (const child of part.parts ?? []) visit(child);
  };
  visit(message.payload);
  if (html.length === 0 && message.payload?.mimeType === "text/html") {
    html.push(decodePart(message.payload.body?.data));
  }
  return html.join("\n");
}
