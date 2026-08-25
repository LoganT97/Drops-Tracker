import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

function comparable(value: unknown): string | number | boolean | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "object" && "toString" in value) return String(value);
  return String(value);
}

export function buildChanges(before: Record<string, unknown> | null, data: Record<string, unknown>) {
  const changes: Record<string, { from: ReturnType<typeof comparable>; to: ReturnType<typeof comparable> }> = {};
  for (const [field, value] of Object.entries(data)) {
    if (field === "pricedAt") continue;
    const from = before ? comparable(before[field]) : null;
    const to = comparable(value);
    if (from !== to) changes[field] = { from, to };
  }
  return changes;
}

export async function recordAudit({
  productId,
  actorId,
  actorName,
  action,
  changes,
}: {
  productId: string;
  actorId: string;
  actorName: string;
  action: string;
  changes?: Record<string, unknown>;
}) {
  await prisma.auditLog.create({
    data: {
      productId,
      actorId,
      actorName,
      action,
      changes: changes && Object.keys(changes).length > 0
        ? changes as Prisma.InputJsonObject
        : undefined,
    },
  });
}
