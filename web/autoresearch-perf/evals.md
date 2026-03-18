# Performance Evals for 3D Image Generator

EVAL 1: Bundle Size
Question: Is the First Load JS for the main page under 100KB?
Pass: First Load JS total (shared + page) is under 100KB gzipped
Fail: Over 100KB gzipped

EVAL 2: Polling Efficiency
Question: Does the polling endpoint return in under 200ms and only fetch necessary fields?
Pass: API response time < 200ms, uses Prisma select to only return needed fields (not entire row)
Fail: Response > 200ms or fetches all columns including unnecessary ones

EVAL 3: Image Loading
Question: Are all user-uploaded images lazy-loaded with proper sizing attributes and thumbnail optimization?
Pass: Sidebar thumbnails use loading="lazy", explicit width/height or aspect-ratio, and no oversized src
Fail: Images load eagerly, lack dimensions, or load full-size images for thumbnails

EVAL 4: Re-render Efficiency
Question: Are expensive computations and handlers memoized to prevent unnecessary re-renders?
Pass: Job list filtering uses useMemo, event handlers use useCallback, child components receive stable references
Fail: Inline arrow functions create new references every render, derived state is recomputed unnecessarily

EVAL 5: Caching Strategy
Question: Are static assets cached with proper headers and is the API response stale-while-revalidate?
Pass: Static assets have immutable cache headers, API uses appropriate cache-control, images from Supabase leverage CDN caching
Fail: No caching headers, or cache-control prevents any caching of API responses

EVAL 6: Upload Speed
Question: Does upload provide immediate visual feedback and not block on unnecessary processing?
Pass: File appears in sidebar immediately (optimistic UI), upload progress shown, sharp metadata extraction doesn't block response
Fail: User sees no feedback until upload + DB write completes, or response is slow due to synchronous image processing
