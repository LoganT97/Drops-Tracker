"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BRANDS, RETAILERS, parseProductUrl, guessBrand, type RetailerKey } from "@/lib/retailers";

const blank = () => ({
  sku: "", productName: "", brand: "Pokemon" as string,
  retailPrice: "", marketPrice: "", imageUrl: "", productUrl: "",
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

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  /**
   * Paste a product link and we read the SKU and name straight out of the URL.
   * No network call, so this can't be rate-limited or blocked — but the name is
   * derived from the URL slug, so give it a once-over before saving.
   */
  function handleLink(value: string) {
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
    setHint("Filled in from the link — check the name, then add the prices.");
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
    if (await post({ ...form, retailer })) {
      setForm(blank);
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
        const [sku, productName, brand, retailPrice, marketPrice] = line
          .split(/\t|,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
          .map((c) => c.replace(/^"|"$/g, "").trim());
        return {
          retailer,
          sku,
          productName,
          brand: (BRANDS as readonly string[]).includes(brand) ? brand : guessBrand(productName ?? ""),
          retailPrice: retailPrice?.replace(/[$,]/g, ""),
          marketPrice: marketPrice?.replace(/[$,]/g, ""),
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
              onChange={(e) => handleLink(e.target.value)}
              onPaste={(e) => setTimeout(() => handleLink(e.currentTarget?.value ?? ""), 0)}
            />
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
            <button
              className="primary-btn"
              onClick={addOne}
              disabled={busy || !form.sku.trim() || !form.productName.trim() || !form.retailPrice}
            >
              {busy ? "Adding…" : "Add SKU"}
            </button>
          </div>
        </>
      ) : (
        <div>
          <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
            One product per line, comma or tab separated:{" "}
            <span className="num">{meta.skuLabel.toLowerCase()}, name, brand, retail, market</span>.
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
