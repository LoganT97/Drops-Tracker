import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getOrderPageData } from "@/lib/order-page-data";
import OrdersDashboard from "@/components/OrdersDashboard";

export const dynamic = "force-dynamic";

export default async function OrdersDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ gmail?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const data = await getOrderPageData(session.user.id);
  const params = await searchParams;
  return <OrdersDashboard {...data} page="dashboard" notice={params.gmail ?? null} />;
}
