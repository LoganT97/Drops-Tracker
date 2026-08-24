# Everyday workflow

Three places hold the code: **your PC** (where you edit), **GitHub** (the middle), and **the VPS**
(what people use). Changes only ever flow PC → GitHub → VPS.

---

## On your PC — commit and push

```
git pull
```

**Do this before you start editing**, every time. If anything was changed on the server or from
another machine, this brings it down. Skipping it is how you end up with conflicts.

Then edit, test with `npm run dev`, and when it works:

```
git add -A
git commit -m "what you changed"
git push
```

Or use VS Code's Source Control panel — type a message, **Commit**, then **Sync Changes**. Same
thing without the quoting.

`git status --short` before committing shows what's staged. You should never see `.env` or
`node_modules` there.

---

## On the server — pull and deploy

```
ssh logan@216.151.165.78
cd ~/Drops-Tracker
./scripts/deploy.sh
```

That script pulls, installs, applies schema changes, builds, and restarts. It stops at the first
failure, so a build error leaves the old version running rather than taking the site down.

First time only, make it executable:

```
chmod +x scripts/deploy.sh
```

Doing it by hand is the same five commands:

```
git pull
npm install
npx prisma db push
npm run build
pm2 restart drop-buddy
```

You can skip `npm install` when dependencies haven't changed and `prisma db push` when the schema
hasn't, but running them is harmless.

---

## When something goes wrong

**`git pull` on the server complains about local changes** — someone edited a file directly there.
See what:

```
git status
git diff
```

If it's worth keeping, commit and push it from the server. If not:

```
git checkout -- .
git pull
```

Better to avoid it: treat the server as receive-only. Edit on your PC.

**Build fails** — the old version is still running, so nothing is down. Read the error, fix it on
your PC, push, and deploy again.

**Site is 502 after deploying** — the app isn't running:

```
pm2 status
pm2 logs drop-buddy --lines 40
```

Usually a missing `.env` value, since `.env` doesn't travel with git. If you add a new environment
variable, add it on the server by hand.

**Roll back to the last working commit:**

```
git log --oneline -5      # find the good one
git checkout <hash>
npm run build && pm2 restart drop-buddy
```

Then `git checkout main` once you've fixed things.

---

## Things that don't travel with git

Each needs doing on the server separately:

- **`.env`** — deliberately ignored. New variables must be added there by hand.
- **`node_modules`** — that's what `npm install` is for.
- **Database contents** — your dev database and production are separate. Schema travels via
  `prisma db push`; the rows in them don't.
- **The tax rate import** — after a schema change or a fresh CSV, run
  `node scripts/import-tax-rates.mjs` on the server too.

---

## Quick reference

| Task | Where | Command |
|---|---|---|
| Start work | PC | `git pull` |
| Test locally | PC | `npm run dev` |
| Save and upload | PC | `git add -A && git commit -m "..." && git push` |
| Deploy | server | `./scripts/deploy.sh` |
| Is it running? | server | `pm2 status` |
| Why isn't it? | server | `pm2 logs drop-buddy` |
| Back up the database | server | `pg_dump -U dropbuddy -h localhost dropbuddy > ~/backup-$(date +%F).sql` |
