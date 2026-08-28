import { prisma } from "@/lib/db";
import type { OrderRow } from "@/components/OrdersDashboard";

export async function getOrderPageData(userId: string) {
  const [connection, records] = await Promise.all([
    prisma.gmailConnection.findUnique({
      where: { userId },
      select: {
        email: true,
        lastSyncedAt: true,
        lastError: true,
        orderHistoryScanned: true,
        orderHistoryBackfilledAt: true,
      },
    }),
    prisma.orderRecord.findMany({
      where: { userId, retailer: "TARGET" },
      orderBy: [{ orderDate: "desc" }, { createdAt: "desc" }],
      include: {
        items: { orderBy: { createdAt: "asc" } },
        shipments: { orderBy: { createdAt: "desc" } },
        messages: { orderBy: { receivedAt: "desc" }, take: 12 },
      },
    }),
  ]);

  const orders: OrderRow[] = records.map((order) => ({
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    orderDate: order.orderDate?.toISOString() ?? null,
    total: order.total == null ? null : Number(order.total),
    accountEmail: order.accountEmail,
    lastUpdateAt: order.lastUpdateAt?.toISOString() ?? null,
    items: order.items.map((item) => ({
      id: item.id,
      productName: item.productName,
      sku: item.sku,
      quantity: item.quantity,
      unitPrice: item.unitPrice == null ? null : Number(item.unitPrice),
      totalPrice: item.totalPrice == null ? null : Number(item.totalPrice),
      imageUrl: item.imageUrl,
    })),
    shipments: order.shipments.map((shipment) => ({
      id: shipment.id,
      trackingNumber: shipment.trackingNumber,
      carrier: shipment.carrier,
      status: shipment.status,
      shippedAt: shipment.shippedAt?.toISOString() ?? null,
      deliveredAt: shipment.deliveredAt?.toISOString() ?? null,
    })),
    history: order.messages.map((message) => ({
      id: message.id,
      subject: message.subject,
      status: message.parsedStatus,
      receivedAt: message.receivedAt.toISOString(),
    })),
  }));

  return {
    orders,
    gmail: connection ? {
      email: connection.email,
      lastSyncedAt: connection.lastSyncedAt?.toISOString() ?? null,
      error: connection.lastError,
      historyScanned: connection.orderHistoryScanned,
      historyBackfilledAt: connection.orderHistoryBackfilledAt?.toISOString() ?? null,
    } : null,
  };
}
