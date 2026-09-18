# 3D Image Generator

## Overview
Upload photos or videos → server-side AI estimates depth per pixel → generates anaglyph 3D images/videos (red/cyan glasses). Users can upload and close the page — processing continues on the server.

## Stack
- **Framework**: Next.js 14, TypeScript, TailwindCSS
- **Database**: Prisma 5 + Supabase PostgreSQL
- **Storage**: Supabase Storage (bucket: `3d-images`)
- **Deployment**: Railway (standalone Docker, node:18-slim)
- **Depth AI**: `@huggingface/transformers` v3 + `onnxruntime-node` (server-side)
  - Model: `onnx-community/depth-anything-v2-large` (cached in HF_HOME=/app/.cache)
- **Video**: ffmpeg for frame extraction + reassembly (MP4 output)

## Architecture
1. User uploads images/videos via frontend → files stored in Supabase Storage
2. DB record created with `status: "pending"` → API returns immediately
3. Background job queue picks up pending jobs one at a time
4. **Images**: download → sharp decode → depth estimation → anaglyph → upload results
5. **Videos**: download → ffmpeg frame extraction → per-frame depth+anaglyph → ffmpeg reassembly → upload MP4
6. Frontend polls `/api/jobs` every 3s (active) or 30s (idle) for status updates
7. `instrumentation.ts` resets stuck jobs on server restart

## Key Files
- `src/lib/depth-estimator.ts` — singleton depth estimation pipeline (Node.js)
- `src/lib/server-anaglyph.ts` — anaglyph generation with raw RGBA buffers (sharp)
- `src/lib/server-video.ts` — ffmpeg-based video processing
- `src/lib/job-processor.ts` — orchestrates image/video job processing
- `src/lib/job-queue.ts` — DB-backed job queue (one at a time, fire-and-forget)
- `src/instrumentation.ts` — startup hook: resets stuck jobs, kicks queue
- `src/app/components/ImageProcessor.tsx` — frontend: upload form + polling dashboard
- `src/app/api/jobs/route.ts` — POST (upload + create job) + GET (list jobs)
- `src/app/api/jobs/[id]/route.ts` — GET (single job) + DELETE
- `src/lib/anaglyph.ts` — original client-side algorithm (kept for reference)
- `prisma/schema.prisma` — Image model with status/mediaType/progress fields
- `Dockerfile` — node:18-slim + ffmpeg + onnxruntime-node
- `scripts/migrate.js` — raw SQL migrations (DO NOT use prisma db push)

## Dev Commands
```bash
cd web
npm run dev           # Start dev server
npx prisma@5 generate # Generate Prisma client (NEVER use db push — shared DB)
npx prisma@5 studio   # Browse data
node scripts/migrate.js # Run DB migrations
```

## Deploy
```bash
railway up web --path-as-root --detach
```

## Credits — invariants (learned the hard way, 2026-09-18)
- **Charge only after the job row exists.** A credit was once decremented *before* the
  Supabase upload, so any upload failure burned a credit and created no job at all —
  the user saw literally nothing, not even a failed job.
- **Failed jobs refund exactly once**, guarded by `td_image.refunded`. The guard matters:
  `retry`/`reprocess` reset a job to `pending`, so an unguarded refund lets a user farm
  unlimited credits off one permanently-failing image.
- **Every upload failure must surface in the UI.** `ImageProcessor` used to handle only
  HTTP 403 and fall through to `return true` on 500/413 — silent failure.

## Uploads & size limits
- **Supabase caps uploads at 50 MB** (project-level; the bucket's own `file_size_limit`
  is null so it inherits that). Verified empirically: 40 MB → 200, 54 MB → 413
  `EntityTooLarge`. Raising it requires a Supabase **Pro** plan; Free cannot exceed 50 MB.
- Stills over 45 MB are **re-encoded** (max 4096px, JPEG q88) before storage rather than
  rejected — processing downscales to 1024px anyway, so nothing useful is lost.
- Videos can't be transparently shrunk → hard 413 with a clear message.
- Hard request ceiling: 100 MB (`MAX_UPLOAD_BYTES`).

## Authorization
- `/api/jobs/[id]` GET/PATCH/DELETE are gated by `ownsJob()` — match on `userId` when
  logged in, else on the session cookie for anonymous jobs; admins pass. Non-owners get
  **404, not 403**, so job IDs can't be probed. Public (`isPublic`) jobs are readable by
  anyone. Before 2026-09-18 these routes had **no ownership check at all**.
- Read the session cookie directly in ownership checks — `getSessionId()` mints a fresh
  UUID when none exists and would never match.

## Public library
- Opt-in per job: `isPublic` + `publishedAt` on `td_image`, toggled via PATCH
  `publish`/`unpublish` (only on `status: "done"`).
- `/api/library` returns shared results only, and deliberately selects **no** `userId`,
  `sessionId`, `fileName` or `originalUrl` — sharing a result must not reveal who made it.
- Browsable at `/library` by anyone, no credits needed.

## Moderation (public library)
- Any viewer can report a shared result → `POST /api/library/[id]/flag`.
- A first report on an un-reviewed image (`moderationStatus: "ok"`) **hides it from
  everyone immediately** (→ `"flagged"`). The owner can then appeal (PATCH `action:
  "appeal"`, allowed only from `"flagged"`), and admins resolve it in `/admin` →
  Moderation: **clear** (→ `"cleared"`, visible again) or **remove** (→ `"removed"`,
  `isPublic` forced false, owner can never re-share it).
- An image a moderator **cleared is never re-hidden by a single new flag** — otherwise
  one person could grief a reinstated image forever. New flags are still recorded, and
  the admin queue surfaces them via flags newer than `moderatedAt`.
- Flags dedupe on `(imageId, flaggerKey)` where flaggerKey = userId, else session id, so
  one person can't inflate `flagCount`. `flagCount` increments only when a row is created.
- **Visibility rule, and it must hold in EVERY read path**: `isPublic && status = "done"
  && moderationStatus IN ("ok","cleared")`. Flagging deliberately leaves `isPublic` true
  (so the owner can still see and appeal), which is exactly why `/api/jobs/[id]` GET has
  to test `moderationStatus` too — gating on `isPublic` alone left flagged images
  fetchable by id. That route also returns an explicit public-safe field subset to
  non-owners; returning the raw row leaked `sessionId`/`userId`/`appealText`.
- Reporter identity is never exposed — not to the public, the owner, or the admin UI.

## HD output (Pro)
- `Image.hiRes` renders the 3D effect at the image's own resolution (cap `HD_MAX_DIM`
  = 3072) instead of the 1024px working copy. Depth estimation still runs at 1024px.
- **The cap is memory-bound, not arbitrary.** Measured peak RSS for the render stage:
  ~544MB at 4096px, ~330MB at 3072px, on top of the ~335MB depth model + ONNX runtime.
  4096 lands near 1GB and risks an OOM-kill that stalls the whole queue (jobs run one at
  a time). Raise it only together with container memory.
- Outputs are generated and encoded one at a time in block scope so only one raw RGBA
  buffer is live alongside the source — the side-by-side buffer is double width.
- This works because the renderers sample depth by *relative* position
  (`sampleDepth` in server-anaglyph), so a small depth map drives a large image. Depth is
  low-frequency, so scaling it up costs almost nothing visually — far better than
  upscaling a finished 1024px anaglyph, which only interpolates.
- HD encodes the three large outputs as **JPEG** (`.jpg` keys): a 4096px PNG runs to tens
  of MB and the double-width side-by-side can exceed the storage cap. Depth/distance maps
  stay PNG. Non-HD output is unchanged (`.png`).
- Gated to Pro at upload; videos never get it. Render loops are O(pixels), so 4096px is
  ~16x the work of 1024px — and the queue runs one job at a time.

## Autostereogram (Magic Eye) — non-obvious constraints
- **Dot separation is an ABSOLUTE pixel distance, never a fraction of image width.**
  It models the gap between the viewer's pupils, which doesn't grow because the picture
  is bigger. `outputWidth / 7` gave 146px at 1024 and 439px at 3072 — wider than anyone
  can diverge, i.e. unfusable. Now `EYE_SEP = 180`, `MU = 1/3` → 72px (near) to 90px
  (far), a ~20% swing the eye can track.
- **Stereograms are deliberately NOT rendered at HD.** Random dots carry no detail to
  preserve, and enlarging the canvas means the separation scales below fusable when the
  viewer fits the image to their screen. Always generated at the 1024px working size.
- **Dots are black/white, not random RGB.** Independent per-channel noise gives coloured
  confetti with weak luminance edges that fuses badly.
- Implements Thimbleby–Inglis–Witten (1994) including the **hidden-surface check** —
  without it, occluded points still get linked and shape edges smear.
- Verified empirically: near surface repeats at 72px, background at 90px, both 100%
  match, exactly two luminance values.

## Admin identity
- The admin cookie (`td_admin`) is **separate from the customer cookie** (`td_auth`).
  `ImageProcessor` renders on the homepage *and* inside the admin Generator tab, so
  without special handling an admin is treated as an anonymous visitor — shown a login
  prompt and capped at the free limit on their own site.
- `isAdmin(req) && !userId` ⇒ treated as unlimited Pro in `/api/credits` (`type:
  "admin"`) and `/api/jobs` (no credit charge, no plan gate). An admin who *also* has a
  customer session falls through to the normal metered path for that account.

## Print export
- `GET /api/jobs/[id]/print?size=&fit=&format=` streams a print-ready JPEG. Sizes are a
  whitelist (12x18, 16x20, 18x24, 24x36, A2) at **150dpi**, with the density stamped in
  the file so a print shop opens it at the right physical size.
- **The 3D render can't happen at print resolution** — 24x36 @300dpi is 78 megapixels,
  ~300MB per raw buffer with three live. So the render stays at the HD cap and this is a
  pure resample, which libvips streams: ~380MB peak even at the largest target. Never
  decode to a JS RGBA buffer here.
- 150dpi is the large-format standard and means ~1.2x enlargement at 18x24 from a 3072px
  render; 300dpi would need 3.5x of detail that doesn't exist.
- Aspect mismatch is the user's choice (crop to fill / fit with border) — AI images are
  usually square and poster paper isn't.
- Not queued like render jobs, so it's **rate limited**; several concurrent 24x36
  resamples would otherwise stack against the container memory ceiling.
- Print tips surfaced in the UI: Classic red/cyan beats Dubois in CMYK, matte paper (gloss
  breaks the effect), and lower intensity for big prints (parallax scales with size).

## Upload flow
- Uploads do **not** start on drop. Files are measured client-side (`measureImages`) and
  held in `pendingImages` until the user confirms settings — settings chosen afterwards
  would mean re-running and paying a second credit.
- The dialog's recommendations are computed from the file's real dimensions against the
  render cap, so it can state the actual enlargement factor for a chosen print size
  before a credit is spent.
- Only one full-screen modal at a time: the image dialog is suppressed while
  `pendingVideoFile` is set, so a mixed drop asks about the video first.

## Auth secret
- `JWT_SECRET` signs the admin cookie **and** every customer auth cookie. It used to fall
  back to a literal committed to this public repo, and the env var was unset in
  production — anyone reading the repo could forge an admin token or impersonate a user.
- It is now set in Railway, and `getJwtSecret()` **throws in production** if it's missing
  or under 16 chars. Resolved per call, not at module load: this module is imported
  during the Next.js build, so a module-level throw would break the build instead of
  surfacing the misconfiguration at runtime.
- Rotating it logs everyone out. That's the point — it also kills any forged token.

## Onboarding
- The examples auto-show **only on a first visit**, remembered in `localStorage`
  (`td_seen_intro`). Previously they showed whenever a visitor had no jobs, so returning
  users with an expired session, or who had deleted their images, sat through it again.
- `seenIntro` starts `null` (not `false`) so the intro stays hidden until storage is read
  — otherwise returning visitors see it flash in and out. Server and first client render
  therefore agree, so no hydration mismatch.
- **Dismissal must set `seenIntro`, not just `showOnboarding`.** On a first visit the
  intro is up via `autoIntro`, so clearing `showOnboarding` alone is a no-op and the
  panel can't be closed. Equally, don't set "seen" on *display* — `autoIntro` would go
  false on the next render and the intro would vanish instantly.
- "How it works" is gated on `!introVisible`, not on having jobs, so a returning user
  with zero jobs can still reopen it.

## Important Notes
- Use `process.env["KEY"]` (bracket notation) not `process.env.KEY`
- Prisma v5 required — don't use npx prisma without @5
- NEXT_PUBLIC_ vars must be available at build time
- Health check at `/api/health` — returns 503 `schema-missing` if any critical table is gone
- DB table prefix: `td_` (3d = td)
- Dockerfile uses node:18-slim (Debian), NOT Alpine — onnxruntime-node needs glibc

## DANGER — DB safety (post-2026-04-19 migration)
- 3D Images now has its own dedicated Supabase project: `fslwkomtwcxsnprhknyw` (us-east-1). Migrated off shared `ushngszdltlctmqlwgot` after OCR Hebrew's schema was wiped by a stray `db push` from a sibling project.
- **NEVER run `prisma db push` with prod `DATABASE_URL`** unless via `npm run db:push:prod` (guarded — refuses if DB has rows unless `CONFIRM_SCHEMA_CHANGE=yes`).
- Schema changes go through `scripts/migrate.js` (raw SQL with `IF NOT EXISTS`).
- `npm run db:backup` → nightly JSON dump with 30-day rotation.
- Dockerfile does NOT auto-run db push on boot.

## Infrastructure IDs
- Supabase project: `fslwkomtwcxsnprhknyw` (dedicated, us-east-1)
- Supabase pooler: `aws-1-us-east-1.pooler.supabase.com`
- Storage bucket: `3d-images` (public)
- `@huggingface/transformers` v3 is the depth AI dependency (server-side, NOT CDN-loaded)
- Must be in `experimental.serverComponentsExternalPackages` in next.config.mjs
- Video: max 60s, 15fps, 720p, output is MP4 (H.264)
- Model downloads on first job (cached in /app/.cache on Railway via HF_HOME)
- NODE_OPTIONS="--max-old-space-size=1024" set in Dockerfile
- Anaglyph modes: Dubois optimized (default) and classic red/cyan
- Shift formula: `(0.3 + d * 0.7) * intensity` — ensures all objects get 3D pop-out
- Disocclusion fill: fills gap artifacts at depth boundaries (on by default)
