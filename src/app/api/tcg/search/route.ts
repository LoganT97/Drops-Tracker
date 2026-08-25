import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { searchTcgProducts } from "@/lib/tcg";

/** Typeahead for linking a SKU to its TCGplayer product. Reads our cache only. */
export async function GET(req: Request) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "Only editors can link products." }, { status: 403 });
  }

  const q = new URL(req.url).searchParams.get("q") ?? "";
  const results = await searchTcgProducts(q);

  return NextResponse.json(
    results.map((r) => ({
      productId: r.productId,
      name: r.name,
      categoryId: r.categoryId,
      categoryName: r.categoryName,
      groupId: r.groupId,
      groupName: r.groupName,
      imageUrl: r.imageUrl,
      marketPrice: r.marketPrice != null ? Number(r.marketPrice) : null,
      isPresale: r.isPresale,
    })),
  );
}
