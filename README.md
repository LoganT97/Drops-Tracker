# Drops Tracker

Drops Tracker is a private Target trading-card product tracker for monitoring retail prices, TCGplayer market values, profit per box, potential ROI, prereleases, release dates, and historical pricing.

Access is Discord-authenticated and restricted to approved users. Administrators manage products and pricing integrations, while viewers get a read-only dashboard.

## Features

- Target product-link lookup for TCIN, product name, retail price, and image
- TCGplayer matching through a local TCGCSV cache
- Automatic market-price synchronization
- Automatic prerelease status and release dates when provided by TCGCSV
- Retail-plus-tax, profit-per-box, and potential-ROI calculations
- Search, filters, sorting, row selection, and copyable SKU lists
- Preloaded 30-day price graphs with release-date markers
- Individual and all-product TCGCSV history backfills
- Admin audit history and current-user activity panel
- Admin View and Viewer View previews

## Product workflow

Administrators can paste a Target product URL into the add panel. Drops Tracker attempts to populate the TCIN, product name, current retail price, image, and Target link.

The common Target prefix `Pokemon Trading Card Game:` is removed from autofilled names to improve TCGplayer matching.

**Find on TCGplayer** links a Target SKU to a cached TCGplayer product. Linked products receive automatic market-price, image, prerelease, and release-date updates.

## Search, filters, and SKU lists

The dashboard can search product names, TCINs, and brands. Filters support brand, minimum profit per box, minimum potential ROI, and multiple ROI summary ranges.

If rows are selected, **Create SKU List** copies only those products. Otherwise it copies the currently visible filtered products.

## Product cards

Product cards include:

- Editable names for administrators
- Target product links
- Prerelease status and release date
- Retail, tax-adjusted cost, market value, profit, and ROI
- Preloaded 30-day price history
- A release marker when release occurred during the graph window
- Per-item price-history backfill for linked products

## TCGCSV pricing

Drops Tracker uses TCGCSV as its local source for TCGplayer products and market prices. Linked products can be refreshed together, and administrators can see live progress while a scan is active.

TCGCSV also publishes compressed daily archives. Drops Tracker can backfill the previous 30 days for one linked product or every linked product.

Downloaded archives are temporary. The app extracts only the required TCGplayer groups, imports matching prices, and deletes the archive and extracted files afterward. Prisma stores only compact `PriceSnapshot` rows, with at most one row per product per date.

## Roles and administration

Administrators can:

- Add, edit, link, and archive products
- Manage prerelease status and release dates
- Run TCGCSV scans and historical backfills
- Switch between Admin View and Viewer View
- Review audit history
- View authorized users and current activity

Viewers can browse, search, filter, sort, open product cards, and copy SKU lists without mutation controls.

The Active Users panel uses an authenticated heartbeat. A visible dashboard updates activity periodically, and recently active users appear online.

## ROI calculations

```text
cost          = retail × (1 + tax rate)
gross profit  = market value − cost
potential ROI = gross profit ÷ cost
net proceeds  = market value × (1 − marketplace fee) − shipping
profit / box  = net proceeds − cost
```

ZIP/postal code, tax rate, marketplace fee, and shipping cost are stored per user.

## Technology

- Next.js and React
- Auth.js with Discord OAuth
- Prisma and PostgreSQL
- TCGCSV price data
