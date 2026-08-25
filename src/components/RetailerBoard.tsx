import { redirect } from "next/navigation";
import Link from "next/link";
import { auth, signOut } from "@/auth";
import { prisma } from "@/lib/db";
import { computeRoi, roiBucket } from "@/lib/roi";
import { RETAILERS, type RetailerKey } from "@/lib/retailers";
import Dashboard, { type Row } from "@/components/Dashboard";
import ActivityHeartbeat from "@/components/ActivityHeartbeat";

/**
 * One board per retailer. Target and Walmart never share a list — separate
 * URLs, separate counts, separate copy-SKU buttons.
 */
export default async function RetailerBoard({ retailer }: { retailer: RetailerKey }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const historySince = new Date();
  historySince.setUTCDate(historySince.getUTCDate() - 30);
  historySince.setUTCHours(0, 0, 0, 0);

  const [user, products, syncState] = await Promise.all([
    prisma.user.findUnique({ where: { id: session.user.id } }),
    prisma.product.findMany({
      where: { active: true, retailer },
      orderBy: { createdAt: "desc" },
      include: {
        snapshots: {
          where: { capturedOn: { gte: historySince } },
          orderBy: { capturedOn: "asc" },
          select: { capturedOn: true, marketPrice: true, retailPrice: true },
        },
      },
    }),
    prisma.syncState.findUnique({ where: { id: "tcgcsv" } }),
  ]);

  const taxRate = Number(user?.taxRate ?? 0);
  const feePct = Number(user?.marketplaceFeePct ?? 0);
  const shippingCost = Number(user?.shippingCost ?? 0);

  const rows: Row[] = products.map((p) => {
    const retailPrice = Number(p.retailPrice);
    const marketPrice = p.marketPrice != null ? Number(p.marketPrice) : null;
    const roi = computeRoi({ retailPrice, marketPrice, taxRate, feePct, shippingCost });

    return {
      id: p.id,
      sku: p.sku,
      productName: p.productName,
      brand: p.brand,
      imageUrl: p.imageUrl,
      productUrl: p.productUrl,
      notes: p.notes,
      prerelease: p.prerelease,
      releaseDate: p.releaseDate?.toISOString().slice(0, 10) ?? null,
      history: p.snapshots.map((snapshot) => ({
        date: snapshot.capturedOn.toISOString().slice(0, 10),
        marketPrice: snapshot.marketPrice != null ? Number(snapshot.marketPrice) : null,
        retailPrice: snapshot.retailPrice != null ? Number(snapshot.retailPrice) : null,
      })),
      retailPrice,
      marketPrice,
      linked: p.tcgProductId != null,
      pricedAt: p.pricedAt.toISOString(),
      ...roi,
      bucket: roiBucket(roi.grossRoi),
    };
  });

  const meta = RETAILERS[retailer];

  return (
    <>
      <ActivityHeartbeat />
      <header className="topbar">
        <nav className="store-nav">
          <Link className={retailer === "TARGET" ? "on" : ""} href="/target">Target</Link>
        </nav>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span className="muted" style={{ fontSize: 13 }}>{session.user.name}</span>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <button className="ghost-btn" style={{ width: "auto" }} type="submit">Log out</button>
          </form>
        </div>
      </header>

      <main className="page">
        <h1 className="title">
          <span className={`accent ${retailer}`}>{meta.label}</span> SKUs, pricing, and potential ROI
        </h1>
        <p className="subtitle">
          {session.user.role === "ADMIN"
            ? `Paste a ${meta.label} product link to fill in the SKU and name, or type it in. Click any value in the table to edit it.`
            : "Live retail, market value, and return on investment for every tracked SKU."}
        </p>

        <Dashboard
          retailer={retailer}
          rows={rows}
          settings={{ taxRate, feePct, shippingCost, postalCode: user?.postalCode ?? "" }}
          canEdit={session.user.role === "ADMIN"}
          lastSyncedAt={syncState?.lastSyncedAt?.toISOString() ?? null}
        />
      </main>
    </>
  );
}
