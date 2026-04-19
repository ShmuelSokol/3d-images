# Architecture

User uploads a photo or video → we store the file, enqueue a job, run AI depth estimation, generate 3D outputs, upload results. The user can close the tab — processing continues.

## Data flow

```
[Browser]                                        [Supabase]
   │  POST /api/jobs (file + intensity)            │
   ├───────────────────────────────────────────►   │ Storage: originals/*
   │                                                │ DB: td_image {status: pending}
   │                                                │
   │  GET /api/jobs (poll every 3s)                 │
   │◄─────────── jobs + status ─────────────────►   │
   │                                                │
                          [Railway container]       │
                             ├─ kickQueue() ────────► forks worker.js
                             │                       │  │ downloads original
                             │                       │  │ sharp → depth → anaglyph/SBS/stereo
                             │                       │  │ uploads results
                             ◄── status: done ───────│  │ UPDATE td_image
```

## Pieces

| | Where |
|---|---|
| Upload endpoint + credit gating | `src/app/api/jobs/route.ts` |
| Job queue (DB-backed, one-at-a-time) | `src/lib/job-queue.ts` |
| Worker child process | `scripts/worker.js` (forked by queue) |
| Depth estimator (singleton) | `src/lib/depth-estimator.ts` |
| Anaglyph / SBS / stereogram | `src/lib/server-anaglyph.ts` |
| Video processing | `src/lib/server-video.ts` + ffmpeg |
| Frontend polling dashboard | `src/app/components/ImageProcessor.tsx` |
| Startup hook (reset stuck jobs) | `src/instrumentation.ts` |

## Why a child-process worker

Depth model is ~335 MB resident. If we ran it in the main Next.js process, Railway's memory limits would kick in during concurrent requests. The worker forks per job, runs, exits. Main process stays lean.

One job at a time: OOM-safe on small Railway instances. Queue is DB-backed (`status: pending/processing/done/failed`) so there's no state to lose on restart. `instrumentation.ts` resets any stuck `processing` jobs to `pending` on boot.

## Why `td_` table prefix

Legacy from the shared-Supabase era (td = 3d). Kept after migration for zero-downtime. Not worth renaming.

## Key env vars

| | Where it's read |
|---|---|
| `DATABASE_URL` / `DIRECT_URL` | Prisma |
| `NEXT_PUBLIC_SUPABASE_URL` | Storage client (public URL base) |
| `SUPABASE_SERVICE_ROLE_KEY` | Storage uploads/downloads (bypasses RLS) |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Checkout + webhook |
| `TRANSFORMERS_CACHE` / `HF_HOME` | Depth model cache (set to `/app/.cache` in Dockerfile) |

Server-side vars **must use bracket notation** (`process.env["KEY"]`) — Next.js standalone inlines dot notation at build time which breaks runtime reading.
