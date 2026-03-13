# 3D Image Generator

## Overview
Upload photos or videos → AI estimates depth per pixel → generates anaglyph 3D images/videos (red/cyan glasses).

## Stack
- **Framework**: Next.js 14, TypeScript, TailwindCSS
- **Database**: Prisma 5 + Supabase PostgreSQL
- **Storage**: Supabase Storage (bucket: `3d-images`)
- **Deployment**: Railway (standalone Docker)
- **Depth AI**: Transformers.js via CDN in Web Worker
  - HD mode: `Xenova/depth-anything-base-hf` (~99MB, better face/detail accuracy)
  - Fast mode: `Xenova/depth-anything-small-hf` (~25MB, faster processing)

## Architecture
1. Web Worker preloads depth model on page load (CDN, cached in IndexedDB)
2. User uploads images/videos → thumbnails appear instantly (blob URLs)
3. Images: depth estimation in worker → anaglyph on main thread canvas → auto-save to Supabase
4. Videos: frame extraction → per-frame depth + anaglyph → MediaRecorder → WebM output
5. Intensity slider redraws anaglyph via direct canvas putImageData (instant, no encoding)
6. Download All bundles results as ZIP via JSZip

## Key Files
- `public/depth-worker.js` — Web Worker for depth estimation (loads Transformers.js from CDN)
- `src/app/components/ImageProcessor.tsx` — main client component (images, videos, ZIP)
- `src/lib/anaglyph.ts` — canvas-based anaglyph generation algorithm
- `src/lib/video-processor.ts` — video frame extraction, processing, MediaRecorder encoding
- `src/app/api/images/route.ts` — upload/list images API
- `src/app/api/images/[id]/save-results/route.ts` — save depth map + anaglyph
- `prisma/schema.prisma` — Image model (td_image table)
- `Dockerfile` — Railway deployment

## Dev Commands
```bash
cd web
npm run dev          # Start dev server
npx prisma@5 db push  # Push schema to Supabase
npx prisma@5 generate # Generate Prisma client
npx prisma@5 studio   # Browse data
```

## Deploy
```bash
railway up web --path-as-root --detach
```

## Important Notes
- Use `process.env["KEY"]` (bracket notation) not `process.env.KEY`
- Prisma v5 required — don't use npx prisma without @5
- Alpine Docker needs `apk add openssl` for Prisma
- NEXT_PUBLIC_ vars must be available at build time
- Health check at `/api/health`
- DB table prefix: `td_` (3d = td)
- `@xenova/transformers` is NOT an npm dependency — loaded via CDN in the worker
- Video: max 60s, 15fps, 720p, output is WebM
