# Drops Tracker

Drops Tracker is a private Target trading-card product tracker for monitoring retail prices, TCGplayer market values, profit per box, potential ROI, prereleases, release dates, and historical pricing.

Access is Discord-authenticated and restricted to approved users. Administrators can manage products and pricing integrations; viewers get a read-only dashboard.

## Features

- Target product-link lookup for TCIN, product name, retail price, and image
- TCGplayer matching through a local TCGCSV cache
- Nightly or manual TCGCSV market-price synchronization
- Automatic prerelease status and release dates when provided by TCGCSV
- Retail-plus-tax, profit-per-box, and potential-ROI calculations
- Search, filters, sorting, row selection, and copyable SKU lists
- Preloaded 30-day price graphs with release-date markers
- Individual and all-product TCGCSV history backfills
- Admin audit history and current-user activity panel
- Admin View and Viewer View previews

## Technology

- Next.js 15 and React 19
- Auth.js with Discord OAuth
- Prisma and PostgreSQL
- TCGCSV for TCGplayer product and price data
- PM2 for the production Node.js process

## Environment variables

Create `.env` locally and configure the same values on the server:

```env
DATABASE_URL="postgresql://..."
AUTH_SECRET="..."
AUTH_DISCORD_ID="..."
AUTH_DISCORD_SECRET="..."

# Comma-separated Discord IDs that always receive administrator access.
ADMIN_DISCORD_IDS="123456789012345678"

# Optional Discord-server access control.
DISCORD_GUILD_ID=""
DISCORD_REQUIRED_ROLE_IDS=""
DISCORD_BOT_TOKEN=""

# Protects the scheduled TCGCSV sync endpoint.
CRON_SECRET=""
```

Generate an Auth.js secret with:

```bash
npx auth secret
```

## Discord configuration

1. Create an application in the [Discord Developer Portal](https://discord.com/developers/applications).
2. Add `http://localhost:3000/api/auth/callback/discord` as a local OAuth redirect.
3. Add `https://your-domain.example/api/auth/callback/discord` for production.
4. Put the Discord client ID and secret in `AUTH_DISCORD_ID` and `AUTH_DISCORD_SECRET`.
5. Put your Discord user ID in `ADMIN_DISCORD_IDS` for initial administrator access.

Access is granted through one of these methods:

1. A Discord ID listed in `ADMIN_DISCORD_IDS` becomes an administrator.
2. A Discord ID in the Prisma `Whitelist` table becomes a viewer.
3. When configured, a required Discord server role grants viewer access.

## Local development on Windows

```bat
npm.cmd install
npx.cmd prisma db push
npx.cmd prisma generate
npm.cmd run dev
```

Open [http://localhost:3000](http://localhost:3000).

Whenever `prisma/schema.prisma` changes, stop the development server before regenerating Prisma. Windows may otherwise lock Prisma's query-engine DLL.

```bat
Ctrl+C
npx.cmd prisma db push
npx.cmd prisma generate
npm.cmd run dev
```

To inspect or edit users directly:

```bat
npx.cmd prisma studio
```

## Production deployment

The deployment script pulls `main`, installs dependencies, updates the database schema, builds the app, and restarts the `drop-buddy` PM2 process.

```bash
cd ~/Drops-Tracker
./scripts/deploy.sh
```

If the script is not executable:

```bash
chmod +x scripts/deploy.sh
./scripts/deploy.sh
```

You can also run it explicitly through Bash:

```bash
bash scripts/deploy.sh
```

If `git pull` reports that local changes to `scripts/deploy.sh` would be overwritten:

```bash
cd ~/Drops-Tracker
cp scripts/deploy.sh ~/deploy.sh.server-backup
git restore scripts/deploy.sh
git pull origin main
chmod +x scripts/deploy.sh
./scripts/deploy.sh
```

## Product workflow

### Add and link a product

Administrators can paste a Target product URL into the add panel. The app attempts to populate the TCIN, product name, current retail price, image, and Target link.

The common Target prefix `Pokemon Trading Card Game:` is removed from autofilled names to improve TCGplayer matching.

Use **Find on TCGplayer** to link the Target SKU to a cached TCGplayer product. Linked products receive automatic market-price, image, prerelease, and release-date updates.

### Search, filters, and SKU lists

The dashboard can search product names, TCINs, and brands. Filters support brand, minimum profit per box, minimum potential ROI, and multiple ROI summary ranges.

If rows are selected, **Create SKU List** copies only those products. Otherwise it copies the currently visible filtered products in this format:

```text
1010892068 ,1010892069 ,1010892076
```

### Product cards

Open a product by clicking its name. Cards include:

- Editable product name for administrators
- Target link and prerelease selector
- Editable release date
- Retail, tax-adjusted cost, market value, profit, and ROI
- Preloaded 30-day price history
- Release marker when release occurred during the graph window
- Admin-only per-item history backfill for linked products

## TCGCSV synchronization

**Scan TCGplayer prices** is available in the administrator toolbar. It checks TCGCSV's daily build timestamp, refreshes the local product cache when needed, and updates linked SKUs.

The status bar polls only while a scan is active and disappears after completion. TCGCSV should not be scanned more frequently than its daily rebuild.

## Historical-price backfill

TCGCSV publishes compressed daily price archives. Drops Tracker can import the previous 30 days for one linked product from its card or every linked product with **Backfill All**.

The app downloads archives into a temporary operating-system directory, extracts only the required TCGplayer groups, imports matching prices, and deletes the archive and extracted files afterward—even when the operation fails.

Prisma stores only compact `PriceSnapshot` rows: at most one row per product per date. It does not store downloaded archives.

The bundled `7zip-bin` extractor is used automatically. The deployment script repairs its Linux executable permission after `npm install`.

## Roles and administration

Administrators can add, edit, link, archive, and mark products as prerelease; run scans and backfills; preview Viewer View; open audit history; and view authorized users and current activity.

Viewers can browse, search, filter, sort, open product cards, and copy SKU lists without mutation controls.

The Active Users panel uses an authenticated heartbeat. A visible dashboard updates activity every 30 seconds; users active within the previous two minutes appear online.

## ROI calculations

```text
cost          = retail × (1 + tax rate)
gross profit  = market value − cost
potential ROI = gross profit ÷ cost
net proceeds  = market value × (1 − marketplace fee) − shipping
profit / box  = net proceeds − cost
```

ZIP/postal code, tax rate, marketplace fee, and shipping cost are stored per user.

## Useful commands

Windows:

```bat
npm.cmd run dev
npm.cmd run build
npx.cmd prisma db push
npx.cmd prisma generate
npx.cmd prisma studio
```

Linux server:

```bash
npm run build
npx prisma db push
npx prisma generate
pm2 restart drop-buddy
pm2 status
```

## Troubleshooting

### Prisma query engine is locked on Windows

Stop `npm.cmd run dev`, run `npx.cmd prisma generate`, and restart the development server.

### `spawn ... 7za EACCES` on Linux

```bash
cd ~/Drops-Tracker
chmod +x node_modules/7zip-bin/linux/x64/7za
pm2 restart drop-buddy
```

Current deployments perform this automatically.

### The product graph is empty

Link the product to TCGplayer, then use **Backfill 30 days** in its card or **Backfill All** from the administrator toolbar.

### Status requests repeat while idle

Restart the app after updating. Current versions poll only while a scan or backfill is active.

### Git refuses to pull on the server

Inspect changes first:

```bash
git status --short
git diff
```

Back up or stash intentional server edits before pulling. Avoid maintaining server-only changes inside tracked files.
