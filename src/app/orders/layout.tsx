import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import ActivityHeartbeat from "@/components/ActivityHeartbeat";
import AppHeader from "@/components/AppHeader";
import OrderTrackerShell from "@/components/OrderTrackerShell";

export default async function OrdersLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { username: true, avatarUrl: true },
  });

  return (
    <>
      <ActivityHeartbeat />
      <AppHeader
        current="orders"
        user={{
          username: user?.username ?? session.user.name ?? "User",
          avatarUrl: user?.avatarUrl ?? null,
        }}
      />
      <OrderTrackerShell>{children}</OrderTrackerShell>
    </>
  );
}
