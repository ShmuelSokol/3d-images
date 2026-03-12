# 3D Image Generator

## Overview
Upload a photo → AI estimates depth per pixel → generates an anaglyph 3D image (red/cyan glasses).

## Stack
- **Framework**: Next.js 14, TypeScript, TailwindCSS
- **Database**: Prisma 5 + Supabase PostgreSQL
- **Storage**: Supabase Storage (bucket: `3d-images`)
- **Deployment**: Railway (standalone Docker)
- **Depth AI**: Transformers.js (`Xenova/depth-anything-small-hf`) — runs client-side in browser

## Architecture
1. User uploads image → saved to Supabase storage
2. Client loads Depth-Anything model via Transformers.js (~25MB, cached after first load)
3. Depth estimation runs in browser → produces depth map
4. Anaglyph algorithm shifts red/cyan channels based on depth → 3D effect
5. User adjusts intensity slider, downloads result, optionally saves to gallery

## Key Files
- `src/app/components/ImageProcessor.tsx` — main client component (upload, depth, anaglyph)
- `src/lib/anaglyph.ts` — canvas-based anaglyph generation algorithm
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

## Important Notes
- Use `process.env["KEY"]` (bracket notation) not `process.env.KEY` — standalone webpack inlines dot notation at build
- Prisma v5 required — don't use npx prisma without @5
- Alpine Docker needs `apk add openssl` for Prisma
- NEXT_PUBLIC_ vars must be available at build time (passed as build args in Dockerfile)
- Health check at `/api/health`
- DB table prefix: `td_` (3d = td)
