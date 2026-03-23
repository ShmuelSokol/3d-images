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

## Important Notes
- Use `process.env["KEY"]` (bracket notation) not `process.env.KEY`
- Prisma v5 required — don't use npx prisma without @5
- **DO NOT run `prisma db push`** — shared DB with ocr-hebrew & 3rdBHMK, use raw SQL
- NEXT_PUBLIC_ vars must be available at build time
- Health check at `/api/health`
- DB table prefix: `td_` (3d = td)
- Dockerfile uses node:18-slim (Debian), NOT Alpine — onnxruntime-node needs glibc
- `@huggingface/transformers` v3 is the depth AI dependency (server-side, NOT CDN-loaded)
- Must be in `experimental.serverComponentsExternalPackages` in next.config.mjs
- Video: max 60s, 15fps, 720p, output is MP4 (H.264)
- Model downloads on first job (cached in /app/.cache on Railway via HF_HOME)
- NODE_OPTIONS="--max-old-space-size=1024" set in Dockerfile
- Anaglyph modes: Dubois optimized (default) and classic red/cyan
- Shift formula: `(0.3 + d * 0.7) * intensity` — ensures all objects get 3D pop-out
- Disocclusion fill: fills gap artifacts at depth boundaries (on by default)
