# Autoresearch Changelog — Performance Round 2

## Experiment 0 — baseline

**Score:** 0/4 (0%)
**Change:** None — evaluating current state
**Eval Results:**

1. Streaming Downloads: **FAIL** — Single-file download uses `Buffer.from(await res.arrayBuffer())`, buffering entire file in RAM before responding
2. Selective Polling: **FAIL** — Frontend always polls `/api/jobs` (all jobs) every 3s regardless of selection state
3. Memoized Thumbnails: **FAIL** — Thumbnails rendered inline in parent `.map()`, all 50+ re-render on every poll
4. Video Autoplay Control: **FAIL** — Video has `autoPlay` attribute, plays immediately on selection with no cleanup

## Experiment 1 — keep

**Score:** 4/4 (100%)
**Change:** All 4 fixes applied together
**Result:** All 4 evals pass.
**Specific changes:**
- **Streaming Downloads**: Single-file downloads now pipe `upstream.body` (ReadableStream) directly to Response — zero buffering. Content-Length forwarded from upstream. Multi-file zip uses `streamFiles: true` and Uint8Array output.
- **Selective Polling**: When a single job is selected and active (pending/processing), polls `/api/jobs/{id}` instead of full list. Falls back to full list when no active selection. Uses `pollModeRef` to avoid unnecessary interval resets.
- **Memoized Thumbnails**: Extracted `JobThumbnail` as a `memo()` component with props: `job`, `isSelected`, `isChecked`, `selectMode`, `onClick`. Only re-renders when its specific job data changes.
- **Video Autoplay Control**: Removed `autoPlay` from video element. Added `key={selected.id}` to force DOM cleanup when switching between videos.
