# Supabase project migration (2026-04-19)

Moved off shared `ushngszdltlctmqlwgot` → dedicated `fslwkomtwcxsnprhknyw` (us-east-1). Zero user-visible downtime.

## Why

The shared project hosted three apps: OCR Hebrew (unprefixed tables), 3rdBHMK (`bhmk_*`), 3D Images (`td_*`). When any of the others ran `prisma db push`, our tables were one misstep away from deletion.

On 2026-04-19 OCR Hebrew's schema was wiped exactly this way. Rather than wait our turn, we migrated.

## Scope

Small dataset. Counts at time of migration:

| Table | Rows |
|---|---|
| `td_user` | 1 |
| `td_image` | 101 |
| `td_coupon` | 0 |
| `td_coupon_redemption` | 0 |
| `td_payment` | 0 |
| `td_ticket` | 0 |

Storage bucket `3d-images` (public): **2634 objects** across `originals/`, `anaglyph/`, `stereogram/`, `sbs/`, `depth/`, `distance/`, `frames/`, `color-stereo/`.

## Steps executed

1. **Created new project** `fslwkomtwcxsnprhknyw` in us-east-1 (same region required for pooler compatibility)
2. **Counted rows** in old project — baseline
3. **`pg_dump`** (custom format) of `public.td_*` from old pooler
4. **`pg_restore`** into new project pooler
5. **Verified row counts match** exactly — no regressions
6. **Created `3d-images` bucket** (public) in new project
7. **Migrated Storage** via Node script (`migration/migrate-storage.js`): 8-way concurrent download + upload, 2634/2634 copied, 0 failed
8. **Verified object count matches**
9. **Updated Railway env vars** (`DATABASE_URL`, `DIRECT_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) with `--skip-deploys`
10. **Updated local `.env`** to match
11. **Committed + pushed** safety guards (`db-push-guarded.js`, `db-backup.js`, expanded `/api/health`) — single commit triggered Railway redeploy
12. **Verified `/api/health`** returned `{"status": "ok"}` after deploy
13. **Drop old tables + old bucket** — see step 9 in the punchlist

Old tables + bucket still exist in `ushngszdltlctmqlwgot` at time of writing. They'll be dropped after a few days of stable operation (rollback window).

## Connection string format

**Always use the pooler. Not the direct DB.**

```
DATABASE_URL=postgresql://postgres.<REF>:<PW>@aws-1-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true
DIRECT_URL=postgresql://postgres.<REF>:<PW>@aws-1-us-east-1.pooler.supabase.com:5432/postgres
```

Supabase's default direct URL (`db.<ref>.supabase.co:5432`) works from Mac but not reliably from Railway. Stick with the pooler.

## Gotchas

- Region has to match for pooler compatibility. New project = us-east-1.
- `pg_dump` / `pg_restore` needed `brew install libpq` (macOS doesn't ship them by default).
- Service role key in new project starts with `sb_secret_...` (newer format). Still works identically with `@supabase/supabase-js`.
- Storage migration used service role on both sides to bypass any RLS that might have been set.
- Used `upsert: true` on uploads to be re-runnable safely — if the script dies midway, rerun picks up where it left off.

## Rollback plan (if migration had failed)

Old project intact throughout. Rollback = revert Railway env vars back to old credentials. Zero data at risk since nothing was dropped from old project until post-verification.

## What's next

- Drop `td_*` tables from `ushngszdltlctmqlwgot` (Step 9)
- Delete `3d-images` bucket from old project
- Write a `db:restore` script (import from JSON backup) — today we don't have one
- Move local dev to its own free-tier Supabase project (currently points at prod)
