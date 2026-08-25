"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BRANDS, RETAILERS, parseProductUrl, guessBrand, type RetailerKey } from "@/lib/retailers";

type TcgMatch = {
  productId: number;
  name: string;
  categoryId: number;
  categoryName: string;
  groupId: number;
  groupName: string;
  imageUrl: string | null;
  marketPrice: number | null;
  isPresale: boolean;
};

const blank = () => ({
  sku: "", productName: "", brand: "Pokemon" as string,
  retailPrice: "", marketPrice: "", imageUrl: "", productUrl: "", prerelease: false,
});

export default function AddProduct({ retailer }: { retailer: RetailerKey }) {
  const router = useRouter();
  const meta = RETAILERS[retailer];

  const [form, setForm] = useState(blank);
  const [bulk, setBulk] = useState("");
  const [mode, setMode] = useState<"one" | "bulk">("one");
  const [status, setStatus] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // TCGplayer linking
  const [matches, setMatches] = useState<TcgMatch[]>([]);
  const [linked, setLinked] = useState<TcgMatch | null>(null);
  const [searching, setSearching] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  /**
   * Paste a product link and we read the SKU and name out of the URL itself.
   * No network call, so it can't be rate-limited or blocked — but the name
   * comes from the URL slug, so give it a once-over before saving.
   */
  async function handleLink(value: string) {
    const parsed = parseProductUrl(value);
    if (!parsed.sku && !parsed.productName) {
      setHint(value.trim() ? `That doesn't look like a ${meta.label} product link.` : null);
      return;
    }
    if (parsed.retailer && parsed.retailer !== retailer) {
      setHint(`That's a ${RETAILERS[parsed.retailer].label} link — add it on the ${RETAILERS[parsed.retailer].label} page.`);
      return;
    }

    setForm((f) => ({
      ...f,
      sku: parsed.sku ?? f.sku,
      productName: parsed.productName ?? f.productName,
      productUrl: parsed.productUrl ?? f.productUrl,
      brand: parsed.productName ? guessBrand(parsed.productName) : f.brand,
    }));
    if (parsed.retailer !== "TARGET") {
      setHint("Filled in from the link - check the name, then add the price.");
      return;
    }
    setLookingUp(true);
    setHint("Looking up the current Target details...");
    try {
      const res = await fetch("/api/retailers/target/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: value }),
      });
      const details = await res.json();
      if (!res.ok) {
        setHint(details.error ?? "Target details were unavailable; fill in the price manually.");
        return;
      }
      setForm((f) => ({
        ...f,
        sku: details.sku ?? f.sku,
        productName: details.name ?? f.productName,
        retailPrice: details.retailPrice != null ? String(details.retailPrice) : f.retailPrice,
        imageUrl: details.imageUrl ?? f.imageUrl,
        productUrl: details.productUrl ?? f.productUrl,
        brand: details.name ? guessBrand(details.name) : f.brand,
      }));
      setHint(details.retailPrice != null
        ? "Filled in the name, current retail price, and product image from Target."
        : "Filled in Target's product details, but no retail price was available.");
    } catch {
      setHint("Target details were unavailable; the link fields were still filled in.");
    } finally {
      setLookingUp(false);
    }
  }

  /** Search the local TCGplayer cache so market price can update itself nightly. */
  async function findMarket() {
    const q = form.productName.trim();
    if (q.length < 3) {
      setStatus("Type the product name first, then search.");
      return;
    }

    setSearching(true);
    setStatus(null);
    const res = await fetch(`/api/tcg/search?q=${encodeURIComponent(q)}`);
    setSearching(false);

    if (!res.ok) {
      setStatus("Market lookup failed. You can still add the SKU and type a price.");
      return;
    }
    const results: TcgMatch[] = await res.json();
    setMatches(results);
    if (results.length === 0) {
      setStatus("No sealed product matched. Try fewer words, or sync the price cache.");
    }
  }

  /**
   * Linking adopts TCGplayer's name and photo as well as the price. Their
   * titles are the real product names, which beats whatever slug the retailer
   * put in the URL — and the nightly sync keeps all three current.
   */
  function pick(match: TcgMatch) {
    setLinked(match);
    setMatches([]);
    setForm((f) => ({
      ...f,
      productName: match.name,
      imageUrl: match.imageUrl ?? f.imageUrl,
      marketPrice: match.marketPrice != null ? String(match.marketPrice) : f.marketPrice,
      brand: guessBrand(match.name) || f.brand,
      prerelease: f.prerelease || match.isPresale,
    }));
    setHint(null);
  }

  async function post(payload: unknown) {
    setBusy(true);
    setStatus(null);
    const res = await fetch("/api/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    setBusy(false);

    if (!res.ok && !json.saved) {
      setStatus(json.problems?.join(" ") ?? json.error ?? "Nothing was saved.");
      return false;
    }
    setStatus(
      json.problems?.length
        ? `Added ${json.saved}. Skipped ${json.problems.length}: ${json.problems[0]}`
        : null,
    );
    router.refresh();
    return true;
  }

  async function addOne() {
    const ok = await post({
      ...form,
      retailer,
      tcgProductId: linked?.productId,
      tcgCategoryId: linked?.categoryId,
      tcgGroupId: linked?.groupId,
    });
    if (ok) {
      setForm(blank);
      setLinked(null);
      setHint(null);
    }
  }

  /** One product per line: sku, name, brand, retail, market */
  async function addBulk() {
    const rows = bulk
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) => {
        const [sku, productName, brand, retailPrice, marketPrice, prerelease] = line
          .split(/\t|,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
          .map((c) => c.replace(/^"|"$/g, "").trim());
        return {
          retailer,
          sku,
          productName,
          brand: (BRANDS as readonly string[]).includes(brand) ? brand : guessBrand(productName ?? ""),
          retailPrice,
          marketPrice,
          prerelease: ["true", "yes", "prerelease", "pre-release"].includes((prerelease ?? "").toLowerCase()),
        };
      });

    if (await post({ rows })) setBulk("");
  }

  return (
    <div className="panel" style={{ padding: 18, marginBottom: 24 }}>
      <div className="tabs">
        <button className={mode === "one" ? "tab on" : "tab"} onClick={() => setMode("one")}>Add one</button>
        <button className={mode === "bulk" ? "tab on" : "tab"} onClick={() => setMode("bulk")}>Paste a list</button>
      </div>

      {mode === "one" ? (
        <>
          <div className="field" style={{ marginBottom: 14 }}>
            <label htmlFor="link">Paste a {meta.label} product link</label>
            <input
              id="link"
              className="link-input"
              placeholder={
                retailer === "TARGET"
                  ? "https://www.target.com/p/product-name/-/A-95225595"
                  : "https://www.walmart.com/ip/Product-Name/1012055702"
              }
              onChange={(e) => void handleLink(e.target.value)}
            />
            {lookingUp && <span className="muted" style={{ fontSize: 12 }}>Contacting Target...</span>}
            {hint && <span className="muted" style={{ fontSize: 12 }}>{hint}</span>}
          </div>

          <div className="controls" style={{ marginBottom: 0 }}>
            <div className="field">
              <label htmlFor="sku">{meta.skuLabel}</label>
              <input id="sku" value={form.sku} onChange={(e) => set("sku", e.target.value)} placeholder="95225595" />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 240 }}>
              <label htmlFor="name">Product</label>
              <input
                id="name" value={form.productName}
                onChange={(e) => set("productName", e.target.value)}
                placeholder="Prismatic Evolutions Elite Trainer Box"
              />
            </div>
            <div className="field">
              <label htmlFor="brand">Brand</label>
              <select id="brand" value={form.brand} onChange={(e) => set("brand", e.target.value)}>
                {BRANDS.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="retail">Retail $</label>
              <input
                id="retail" type="number" step="0.01" style={{ minWidth: 100 }}
                value={form.retailPrice} onChange={(e) => set("retailPrice", e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="market">Market $</label>
              <input
                id="market" type="number" step="0.01" style={{ minWidth: 100 }}
                value={form.marketPrice} onChange={(e) => set("marketPrice", e.target.value)}
                placeholder="optional"
              />
            </div>
            <label className="prerelease-switch-row add-prerelease-switch">
              <span>Prerelease</span>
              <input
                type="checkbox"
                checked={form.prerelease}
                onChange={(e) => setForm((f) => ({ ...f, prerelease: e.target.checked }))}
              />
              <span className="prerelease-switch" aria-hidden="true" />
            </label>
          </div>

          <div className="add-product-actions">
            <button className="ghost-btn" style={{ width: "auto" }} onClick={findMarket} disabled={searching}>
              {searching ? "Searching…" : "Find on TCGplayer"}
            </button>
            <button
              className="primary-btn"
              onClick={addOne}
              disabled={busy || !form.sku.trim() || !form.productName.trim() || !form.retailPrice}
            >
              {busy ? "Adding…" : "Add SKU"}
            </button>
          </div>

          {linked && (
            <p className="linked-note">
              {linked.imageUrl && (
                <img className="thumb" src={linked.imageUrl} alt="" style={{ marginRight: 8, verticalAlign: "middle" }} />
              )}
              Linked to <strong>{linked.name}</strong> ({linked.groupName}) — photo and market
              price refresh nightly{linked.isPresale ? "; marked prerelease by TCGplayer" : ""};
              you can customize the displayed name.{" "}
              <button className="unlink" onClick={() => setLinked(null)}>unlink</button>
            </p>
          )}

          {matches.length > 0 && (
            <ul className="match-list">
              {matches.map((m) => (
                <li key={m.productId}>
                  <button className="ghost-btn" style={{ textAlign: "left" }} onClick={() => pick(m)}>
                    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {m.imageUrl && <img className="thumb" src={m.imageUrl} alt="" />}
                      {m.name}
                    </span>
                    <span className="muted" style={{ fontSize: 11 }}>
                      {m.categoryName} · {m.groupName}
                      {m.marketPrice != null && ` · $${m.marketPrice.toFixed(2)}`}
                      {m.isPresale && " · Presale"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <div>
          <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
            One product per line, comma or tab separated:{" "}
            <span className="num">{meta.skuLabel.toLowerCase()}, name, brand, retail, market, prerelease</span>.
            Everything here goes on the {meta.label} board.
          </p>
          <textarea
            className="bulk" rows={6} value={bulk}
            onChange={(e) => setBulk(e.target.value)}
            placeholder={"95225595, First Partners Illustration Collection, Pokemon, 15.99, 60.75\n95082118, Ascended Heroes Elite Trainer Box, Pokemon, 59.99, 167.51"}
          />
          <button className="primary-btn" onClick={addBulk} disabled={busy || !bulk.trim()}>
            {busy ? "Importing…" : "Import rows"}
          </button>
        </div>
      )}

      {status && <p style={{ color: "var(--red)", fontSize: 13, marginBottom: 0 }}>{status}</p>}
    </div>
  );
}
