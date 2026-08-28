import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getOrderPageData } from "@/lib/order-page-data";
import OrdersDashboard from "@/components/OrdersDashboard";

export const dynamic = "force-dynamic";

export default async function TrackingPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const data = await getOrderPageData(session.user.id);
  return <OrdersDashboard {...data} page="tracking" notice={null} />;
}
