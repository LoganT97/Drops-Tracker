# Drop Buddy

Private SKU boards for Target and Walmart TCG drops, one page per store. You type in the product, the retail price, and
what it's going for; the app handles tax, ROI, and profit per box. Sign-in is Discord-only and gated
to a whitelist, so it stays inside your group.

No scrapers, no API keys, nothing to break when a retailer changes their site.

Stack: Next.js 15 (App Router) · Auth.js v5 · Prisma · Postgres · deploys to Vercel.

---

## Setup

```bash
npm install
cp .env.example .env        # fill in the Discord + database values
npx auth secret             # writes AUTH_SECRET
npm run db:push             # creates the tables
npm run dev
```

### Discord app

1. https://discord.com/developers/applications → New Application → OAuth2.
2. Redirect URI: `http://localhost:3000/api/auth/callback/discord`
   (add `https://yourdomain.com/api/auth/callback/discord` when you deploy).
3. Copy Client ID and Secret into `AUTH_DISCORD_ID` / `AUTH_DISCORD_SECRET`.
4. Put your own Discord user ID in `ADMIN_DISCORD_IDS` — that's how you get in the first time.
   (Discord → Settings → Advanced → Developer Mode, then right-click yourself → Copy User ID.)

### Who gets in

Three gates, checked in order in `src/auth.ts`:

| Gate | How you set it | Result |
|---|---|---|
| `ADMIN_DISCORD_IDS` | env var | admin |
| `Whitelist` table | `npx prisma studio` → add a row with their Discord ID | member |
| Server role | `DISCORD_GUILD_ID` + `DISCORD_REQUIRED_ROLE_IDS` | member |

The third is the one worth setting up long term: anyone holding your subscriber role in your Discord
gets in automatically and loses access the moment the role comes off. Everyone else hits
`/login?error=AccessDenied`.

---

## Using it

Target and Walmart are **separate boards** at `/target` and `/walmart`, each with its own list,
its own ROI counts, and its own Copy all SKUs buttons. Whichever page you're on is the store the
new SKU goes to — there's no store picker to get wrong.

**Paste a product link** — the fastest way in. Copy the URL off the product page and drop it in the
link box; the SKU, the product name, and the brand all fill themselves in.

This is pure string parsing (`src/lib/retailers.ts`), not scraping. Both retailers put the ID and a
readable slug right in the URL:

```
target.com/p/pokemon-tcg-prismatic-evolutions-elite-trainer-box/-/A-93954435
walmart.com/ip/Pokemon-TCG-Prismatic-Evolutions-Elite-Trainer-Box/1012055702
```

No network call means nothing to rate-limit, block, or break. The trade-off is that the name comes
from the URL slug, so it's a good first draft rather than the exact shelf title — glance at it before
saving. Paste a Walmart link on the Target page and it'll tell you rather than filing it wrong.

**Paste a list** — one product per line, comma or tab separated:

```
sku, name, brand, retail, market
95225595, First Partners Illustration Collection, Pokemon, 15.99, 60.75
95082118, Ascended Heroes Elite Trainer Box, Pokemon, 59.99, 167.51
```

Tab-separated means you can copy columns straight out of a spreadsheet. Everything imported lands on
the board you're currently viewing. Rows missing a SKU, name, or retail price get skipped and
reported back; the rest still save. Re-importing a SKU you already have updates it rather than
duplicating it.

**Images** are the one thing that can't be automated — click the thumbnail box on any row, then
right-click the product photo on the retailer's site, Copy image address, and paste. Rows without an
image just show a `+`.

**Edit anything** — click a value in the table, type, press Enter. Prices, names, and SKUs are all
editable in place. Brand is a dropdown everywhere it appears, in the add form and in the table, and
the API rejects anything not on the list — so "Pokemon" can never end up split across three
spellings. The list lives in `BRANDS` in `src/lib/retailers.ts`; add to it there and it updates
every dropdown at once. The × at the end of a row stops tracking it.

**Copy all SKUs** on each tile copies just that ROI bucket to your clipboard, so you can paste the
100%+ list straight into whatever you buy with.

---

## The math

```
cost         = retail × (1 + taxRate)
grossProfit  = marketValue − cost
grossRoi     = grossProfit / cost          ← the % in the ROI pill
netProceeds  = marketValue × (1 − feePct) − shipping
netProfit    = netProceeds − cost          ← the "profit / box" column
```

Gross ROI is the headline number, the way the resale community quotes it. **Marketplace fee and
shipping both start at 0**, so profit per box matches gross ROI out of the box. Fill them in only if
you want the after-fees number: roughly 12.75% for TCGplayer (commission plus payment processing —
check the current rate) plus whatever a box costs you to ship.

Tax rate, fee, and shipping are **per user**, so everyone in the group sees ROI computed for their
own state and their own selling costs off the same shared product list.

---

## What to add later

- Discord webhook when someone adds a SKU above an ROI threshold
- A `PriceSnapshot` table written on every price edit, so you get history and a chart for free
- Quantity and cost-basis fields to turn this into inventory rather than a watchlist
- Automatic names and photos from a SKU would need Target's internal API (against their terms, breaks
  often) or Walmart's partner API (weeks of approval). Neither is reliable enough to bolt on today —
  the link paste covers most of the benefit with none of the fragility.
- If you ever do want automatic market prices, TCGCSV is the free route — one file, and nothing else
  in the app has to change
