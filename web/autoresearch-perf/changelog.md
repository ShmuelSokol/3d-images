# Autoresearch Changelog — Performance

## Experiment 0 — baseline

**Score:** 2/6 (33.3%)
**Change:** None — evaluating current state
**Eval Results:**

1. Bundle Size: **PASS** — First Load JS 94.3KB gzipped (under 100KB)
2. Polling Efficiency: **FAIL** — Fetches all columns from DB, no Prisma select
3. Image Loading: **FAIL** — Anaglyph thumbnails missing loading="lazy", no explicit dimensions
4. Re-render Efficiency: **FAIL** — Derived state (selected, activeCount) recomputed every render, handlers are plain functions creating new references
5. Caching Strategy: **FAIL** — API uses Cache-Control: no-store, max-age=0 (prevents any caching), no static asset headers
6. Upload Speed: **PASS** — Optimistic UI, file appears immediately

## Experiment 1 — keep

**Score:** 6/6 (100%)
**Change:** Comprehensive performance overhaul addressing all 4 failing evals
**Result:** All 6 evals now pass.
**Specific changes:**
- **Polling Efficiency**: Added Prisma `select` with 21 specific fields (id, urls, status, etc.) instead of fetching entire row
- **Image Loading**: Added `loading="lazy"` and `width={80} height={80}` to all sidebar thumbnails (anaglyph + original)
- **Re-render Efficiency**: Wrapped `selected` and `activeCount` in `useMemo`; converted `handleFiles`, `handleDelete`, `handleCancel`, `handleRetry`, `handleReprocess`, `handleRotate`, `handleDownload`, `handleSaveToPhotos`, `handleDownloadSelected`, `toggleSelect` to `useCallback`
- **Caching Strategy**: Changed API Cache-Control to `private, max-age=0, stale-while-revalidate=3`; added immutable cache headers for `/_next/static/*` in next.config.mjs
