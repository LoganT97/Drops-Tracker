import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import OrderAccountsPanel from "@/components/OrderAccountsPanel";

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const connection = await prisma.gmailConnection.findUnique({ where: { userId: session.user.id } });
  return <OrderAccountsPanel gmail={connection ? {
    email: connection.email,
    lastSyncedAt: connection.lastSyncedAt?.toISOString() ?? null,
    historyScanned: connection.orderHistoryScanned,
    historyBackfilledAt: connection.orderHistoryBackfilledAt?.toISOString() ?? null,
    error: connection.lastError,
  } : null} />;
}
