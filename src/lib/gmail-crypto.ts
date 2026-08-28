import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function tokenKey() {
  const secret = process.env.GMAIL_TOKEN_SECRET ?? process.env.AUTH_SECRET;
  if (!secret) throw new Error("GMAIL_TOKEN_SECRET or AUTH_SECRET must be configured.");
  return createHash("sha256").update(secret).digest();
}

export function encryptGmailToken(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", tokenKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((part) => part.toString("base64url")).join(".");
}

export function decryptGmailToken(value: string) {
  const [ivPart, tagPart, encryptedPart] = value.split(".");
  if (!ivPart || !tagPart || !encryptedPart) throw new Error("Invalid encrypted Gmail token.");
  const decipher = createDecipheriv("aes-256-gcm", tokenKey(), Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedPart, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
