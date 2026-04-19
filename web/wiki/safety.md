# Safety & data protection

Written 2026-04-19 after 3D Images migrated off the shared Supabase project `ushngszdltlctmqlwgot` (where OCR Hebrew's schema was wiped the same day by a stray `prisma db push`). This page exists so that doesn't happen here.

## Rules

### 1. Dedicated Supabase project

3D Images now owns `fslwkomtwcxsnprhknyw` (us-east-1). **Never put another app's tables here.** Costs nothing on free tier to keep each app isolated.

### 2. Never auto-run `prisma db push` in production

Dockerfile does NOT run `db push` at container boot. Schema changes are explicit, manual, via `npm run db:push:prod` (guarded).

### 3. Never point local `.env` at prod `DATABASE_URL`

Local `prisma db push` against prod = potential data loss. Local dev should use a separate Supabase project on the free tier.

### 4. Always check `/api/health` after a deploy

Returns 503 with `{"status": "schema-missing", "missing": [...]}` if `user`, `image`, `coupon`, `couponRedemption`, `payment`, or `ticket` tables are gone. Railway marks the deploy unhealthy.

### 5. Backups are daily, rotated 30 days

`scripts/db-backup.js` dumps every table to JSON.

```cron
0 3 * * *  cd /path/to/3d-images/web && npm run db:backup
```

Backups live at `web/backups/db-YYYY-MM-DD.json` (gitignored). 30 most recent kept.

## Tools

| Tool | What it does |
|---|---|
| `npm run db:push:prod` | Guarded schema push. Refuses if any table has rows unless `CONFIRM_SCHEMA_CHANGE=yes`. |
| `npm run db:backup` | JSON dump of every 3D Images table. |
| `npm run db:migrate` | Run `scripts/migrate.js` (raw SQL with `IF NOT EXISTS`). This is the preferred schema-change path. |
| `/api/health` | Returns 503 if any required table missing. Railway consumes this. |

## Recovery runbook (hypothetical)

If tables are gone:

1. **Check `/api/health`** — confirm exactly what's missing
2. **Check Supabase dashboard → Database → Backups** — PITR is available on paid plans
3. **Restore from latest JSON backup**: script to re-insert is not written yet (write one if this ever happens; `db-backup.js` produces the format)
4. **Recreate schema**: `CONFIRM_SCHEMA_CHANGE=yes npm run db:push:prod`
5. **Storage bucket** is a separate concern — see [migration/README](migration/README.md) for how to copy between projects

## What we got right on 2026-04-19

- Spotted OCR Hebrew's wipe quickly from Railway `P2021` logs
- Had the presence of mind to migrate 3D Images preemptively (before another cross-contamination)
- Pre-migration verification (row counts old === new) caught zero regressions
- Zero user-visible downtime during migration

## What's still fragile

- No JSON-to-DB restore script
- No automated off-Supabase backup (everything is in-region)
- Local dev uses the same Supabase project as prod (should split)
