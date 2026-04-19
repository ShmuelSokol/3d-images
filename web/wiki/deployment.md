# Deployment

**Deploy via `git push` to `main` only.** Railway auto-deploys on push. NEVER use `railway up`.

## Pre-deploy

```bash
cd web
npm run build            # Must pass locally first
npx next lint            # Catches unused vars tsc misses
```

Build failures on Railway show as "build failed" but don't roll back — you'll be stuck on the last successful deploy. Always build locally first.

## Deploy

```bash
git add -A
git commit -m "..."
git push
```

Railway detects the push and starts a new deploy. Takes 3–5 minutes for the full build (mostly npm install + prisma generate + next build).

## Post-deploy verification

1. **Railway dashboard** — confirm deploy status = "Success"
2. **`/api/health`** — must return `{"status": "ok"}`. 503 means a table is gone (see [safety](safety.md)).
3. **Test upload** — upload a known-good image, verify all 3 output formats render.
4. **Check error log** — `GET /api/errors/recent` (if wired) or Railway runtime logs.

## Docker quirks

Dockerfile: `node:18-slim` (Debian, not Alpine — onnxruntime-node needs glibc).

Must install `openssl` + `ffmpeg` in base image:

```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends openssl ffmpeg && rm -rf /var/lib/apt/lists/*
```

Standalone Next.js doesn't auto-copy everything — we manually `COPY` full `node_modules` in the runner stage to avoid transitive-dep issues (onnxruntime-node, sharp, @prisma).

## Env vars on Railway

Set via `railway variables --service "3D PHOTOS" --set KEY=VALUE`. All env changes auto-trigger a redeploy unless you pass `--skip-deploys`.

Critical vars (see [architecture](architecture.md) for full list):

- `DATABASE_URL` — pooler, port 6543, with `?pgbouncer=true`
- `DIRECT_URL` — pooler, port 5432
- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`

## Model caching

First upload after deploy downloads ~1.3 GB depth model. Slow. Subsequent uploads reuse `/app/.cache` until rebuild.

To warm the cache faster: upload one test image immediately after deploy completes.

## When deploys fail

| Symptom | Usual cause |
|---|---|
| Build fails with unused-var error | ESLint; `next lint` would have caught it |
| Build fails on Prisma | Usually shared-schema drift; check `prisma/schema.prisma` against DB |
| Runtime 500 on all API routes | Check env vars — `DATABASE_URL` wrong, `SUPABASE_SERVICE_ROLE_KEY` missing |
| `/api/health` returns 503 `schema-missing` | Someone ran `db push` — see [safety](safety.md) |
| Depth estimation fails with "preprocessor_config.json" | Tried to use V3 again. Don't. See [depth-model](depth-model.md). |
