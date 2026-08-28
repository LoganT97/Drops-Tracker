import { NextResponse } from "next/server";
import type { OrderStatus } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import {
  getGmailMessage,
  gmailHeader,
  gmailMessageHtml,
  gmailMessageText,
  listTargetMessagePage,
  validGmailAccessToken,
} from "@/lib/gmail";
import { parseTargetEmail } from "@/lib/target-order-parser";

const STATUS_RANK: Record<OrderStatus, number> = {
  UNKNOWN: 0,
  ORDERED: 1,
  DELAYED: 2,
  SHIPPED: 3,
  OUT_FOR_DELIVERY: 4,
  DELIVERED: 5,
  CANCELLED: 6,
};

function laterStatus(current: OrderStatus, incoming: OrderStatus) {
  if (incoming === "UNKNOWN") return current;
  return STATUS_RANK[incoming] >= STATUS_RANK[current] ? incoming : current;
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await request.json().catch(() => ({})) as { repairIncomplete?: boolean };
    const { connection, accessToken } = await validGmailAccessToken(session.user.id);
    const historical = !connection.orderHistoryBackfilledAt || body.repairIncomplete === true;
    const [messagePage, catalog] = await Promise.all([
      listTargetMessagePage(accessToken, {
        after: historical ? null : connection.lastSyncedAt,
        pageToken: historical ? connection.orderHistoryPageToken : null,
      }),
      prisma.product.findMany({
        where: { retailer: "TARGET", active: true },
        select: { id: true, sku: true, productName: true, imageUrl: true, retailPrice: true },
      }),
    ]);

    const messages = [];
    for (let start = 0; start < messagePage.messages.length; start += 10) {
      messages.push(...await Promise.all(
        messagePage.messages.slice(start, start + 10).map((message) => getGmailMessage(accessToken, message.id)),
      ));
    }
    messages.sort((a, b) => Number(a.internalDate ?? 0) - Number(b.internalDate ?? 0));

    let imported = 0;
    let skipped = 0;
    for (const message of messages) {
      const existingMessage = await prisma.orderMessage.findUnique({
        where: { userId_gmailMessageId: { userId: session.user.id, gmailMessageId: message.id } },
        select: { orderId: true },
      });
      if (existingMessage?.orderId && !body.repairIncomplete) {
        skipped += 1;
        continue;
      }

      const subject = gmailHeader(message, "Subject") || "Target order email";
      const receivedAt = new Date(Number(message.internalDate ?? Date.now()));
      const parsed = parseTargetEmail(subject, gmailMessageText(message), catalog, gmailMessageHtml(message));
      if (!parsed) {
        await prisma.orderMessage.upsert({
          where: { userId_gmailMessageId: { userId: session.user.id, gmailMessageId: message.id } },
          create: {
            userId: session.user.id,
            gmailMessageId: message.id,
            gmailThreadId: message.threadId,
            subject,
            receivedAt,
          },
          update: { subject, receivedAt },
        });
        skipped += 1;
        continue;
      }

      const existingOrder = await prisma.orderRecord.findUnique({
        where: {
          userId_retailer_orderNumber: {
            userId: session.user.id,
            retailer: "TARGET",
            orderNumber: parsed.orderNumber,
          },
        },
      });
      const status = laterStatus(existingOrder?.status ?? "UNKNOWN", parsed.status);
      const order = await prisma.orderRecord.upsert({
        where: {
          userId_retailer_orderNumber: {
            userId: session.user.id,
            retailer: "TARGET",
            orderNumber: parsed.orderNumber,
          },
        },
        create: {
          userId: session.user.id,
          retailer: "TARGET",
          orderNumber: parsed.orderNumber,
          status,
          orderDate: receivedAt,
          total: parsed.total,
          accountEmail: connection.email,
          lastUpdateAt: receivedAt,
        },
        update: {
          status,
          ...(parsed.total != null && { total: parsed.total }),
          accountEmail: connection.email,
          lastUpdateAt: receivedAt,
        },
      });

      if (body.repairIncomplete && parsed.items.length > 0) {
        // Remove image-only fallback rows created by older parser versions.
        // The purchased item(s) parsed below are then recreated cleanly.
        await prisma.orderItem.deleteMany({
          where: { orderId: order.id, productId: null, sku: null },
        });
      }

      for (const item of parsed.items) {
        const alreadyAdded = await prisma.orderItem.findFirst({
          where: item.sku
            ? { orderId: order.id, sku: item.sku }
            : { orderId: order.id, productName: item.productName },
        });
        if (alreadyAdded) {
          await prisma.orderItem.update({
            where: { id: alreadyAdded.id },
            data: {
              productId: item.productId,
              productName: item.productName,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              totalPrice: item.unitPrice == null ? null : item.unitPrice * item.quantity,
              imageUrl: item.imageUrl,
            },
          });
        } else {
          await prisma.orderItem.create({
            data: {
              orderId: order.id,
              productId: item.productId,
              productName: item.productName,
              sku: item.sku,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              totalPrice: item.unitPrice == null ? null : item.unitPrice * item.quantity,
              imageUrl: item.imageUrl,
            },
          });
        }
      }

      for (const shipment of parsed.tracking) {
        await prisma.shipment.upsert({
          where: { orderId_trackingNumber: { orderId: order.id, trackingNumber: shipment.number } },
          create: {
            orderId: order.id,
            trackingNumber: shipment.number,
            carrier: shipment.carrier,
            status,
            shippedAt: status === "SHIPPED" ? receivedAt : null,
            deliveredAt: status === "DELIVERED" ? receivedAt : null,
          },
          update: {
            carrier: shipment.carrier,
            status,
            ...(status === "SHIPPED" && { shippedAt: receivedAt }),
            ...(status === "DELIVERED" && { deliveredAt: receivedAt }),
          },
        });
      }

      await prisma.orderMessage.upsert({
        where: { userId_gmailMessageId: { userId: session.user.id, gmailMessageId: message.id } },
        create: {
          userId: session.user.id,
          orderId: order.id,
          gmailMessageId: message.id,
          gmailThreadId: message.threadId,
          subject,
          receivedAt,
          parsedStatus: parsed.status,
        },
        update: { orderId: order.id, parsedStatus: parsed.status, subject, receivedAt },
      });
      imported += 1;
    }

    const historyComplete = historical && !messagePage.nextPageToken;
    const historyScanned = historical
      ? connection.orderHistoryScanned + messages.length
      : connection.orderHistoryScanned;
    await prisma.gmailConnection.update({
      where: { userId: session.user.id },
      data: {
        lastSyncedAt: new Date(),
        lastError: null,
        ...(historical && {
          orderHistoryPageToken: messagePage.nextPageToken,
          orderHistoryScanned: historyScanned,
          ...(historyComplete && { orderHistoryBackfilledAt: new Date() }),
        }),
      },
    });
    return NextResponse.json({
      imported,
      skipped,
      scanned: messages.length,
      historical,
      historyScanned,
      estimatedTotal: messagePage.estimatedTotal,
      more: historical && Boolean(messagePage.nextPageToken),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gmail synchronization failed.";
    await prisma.gmailConnection.updateMany({
      where: { userId: session.user.id },
      data: { lastError: message },
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
