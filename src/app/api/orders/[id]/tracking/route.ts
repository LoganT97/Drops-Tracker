import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

type UpsAddress = {
  addressLine1?: string;
  addressLine2?: string;
  addressLine3?: string;
  city?: string;
  stateProvince?: string;
  postalCode?: string;
  country?: string;
  countryCode?: string;
};

type UpsActivity = {
  date?: string;
  time?: string;
  gmtOffset?: string;
  location?: { address?: UpsAddress };
  status?: { description?: string; simplifiedTextDescription?: string; code?: string };
};

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getUpsToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const clientId = process.env.UPS_CLIENT_ID;
  const clientSecret = process.env.UPS_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("UPS_NOT_CONFIGURED");

  const response = await fetch("https://onlinetools.ups.com/security/v1/oauth/token", {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
    cache: "no-store",
  });
  const result = await response.json().catch(() => ({})) as { access_token?: string; expires_in?: string | number; response?: { errors?: Array<{ message?: string }> } };
  if (!response.ok || !result.access_token) {
    throw new Error(result.response?.errors?.[0]?.message ?? "UPS authentication failed.");
  }
  const expiresIn = Number(result.expires_in ?? 3600);
  cachedToken = { value: result.access_token, expiresAt: Date.now() + Math.max(300, expiresIn) * 1000 };
  return cachedToken.value;
}

function activityDate(activity: UpsActivity) {
  const date = activity.date;
  if (!date || date.length !== 8) return null;
  const time = (activity.time ?? "000000").padEnd(6, "0");
  const value = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}${activity.gmtOffset ?? ""}`;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function addressParts(address?: UpsAddress) {
  if (!address) return [];
  return [address.addressLine1, address.addressLine2, address.addressLine3, address.city, address.stateProvince, address.postalCode, address.country ?? address.countryCode].filter((part): part is string => Boolean(part));
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const order = await prisma.orderRecord.findFirst({
    where: { id, userId: session.user.id },
    select: { shipments: { orderBy: { createdAt: "desc" } } },
  });
  if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404 });
  const shipment = order.shipments.find((item) => item.carrier?.toUpperCase() === "UPS" || item.trackingNumber.toUpperCase().startsWith("1Z"));
  if (!shipment) return NextResponse.json({ error: "This order does not have a UPS shipment." }, { status: 400 });

  try {
    const token = await getUpsToken();
    const response = await fetch(`https://onlinetools.ups.com/api/track/v1/details/${encodeURIComponent(shipment.trackingNumber)}?locale=en_US&returnMilestones=true`, {
      headers: {
        authorization: `Bearer ${token}`,
        transId: randomUUID(),
        transactionSrc: "drops-tracker",
      },
      cache: "no-store",
    });
    const result = await response.json().catch(() => ({})) as {
      trackResponse?: { shipment?: Array<{ package?: Array<{
        trackingNumber?: string;
        activity?: UpsActivity[];
        currentStatus?: { description?: string; simplifiedTextDescription?: string };
        packageAddress?: Array<{ type?: string; name?: string; attentionName?: string; address?: UpsAddress }>;
      }> }> };
      response?: { errors?: Array<{ message?: string }> };
    };
    if (!response.ok) {
      return NextResponse.json({ error: result.response?.errors?.[0]?.message ?? "UPS tracking request failed." }, { status: response.status });
    }
    const packages = result.trackResponse?.shipment?.flatMap((item) => item.package ?? []) ?? [];
    const pkg = packages.find((item) => item.trackingNumber === shipment.trackingNumber) ?? packages[0];
    if (!pkg) return NextResponse.json({ error: "UPS returned no tracking information for this package." }, { status: 404 });
    const destination = pkg.packageAddress?.find((item) => item.type?.toUpperCase() === "DESTINATION");
    const events = (pkg.activity ?? []).map((activity, index) => ({
      id: `${activity.date ?? "event"}-${activity.time ?? index}-${index}`,
      description: activity.status?.description ?? activity.status?.simplifiedTextDescription ?? "UPS update",
      location: addressParts(activity.location?.address).join(", "),
      occurredAt: activityDate(activity),
    }));
    return NextResponse.json({
      source: "UPS",
      trackingNumber: shipment.trackingNumber,
      currentStatus: pkg.currentStatus?.simplifiedTextDescription ?? pkg.currentStatus?.description ?? null,
      destination: destination ? {
        name: destination.name ?? destination.attentionName ?? null,
        formatted: addressParts(destination.address).join(", "),
      } : null,
      events,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "UPS_NOT_CONFIGURED") {
      return NextResponse.json({ error: "UPS tracking is not configured. Add UPS_CLIENT_ID and UPS_CLIENT_SECRET to the server environment." }, { status: 503 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "UPS tracking request failed." }, { status: 502 });
  }
}
