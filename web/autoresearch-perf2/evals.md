# Performance Evals Round 2 — 3D Image Generator

EVAL 1: Streaming Downloads
Question: Does the download endpoint stream files instead of buffering entirely in memory?
Pass: Single-file downloads pipe/stream the response directly without loading full buffer into RAM. Multi-file zip uses streaming archiver.
Fail: Uses Buffer.from(await res.arrayBuffer()) or equivalent full-buffer pattern before sending response

EVAL 2: Selective Polling
Question: Does the frontend poll only the selected job instead of all jobs when a single job is active/selected?
Pass: When a single job is selected and processing, frontend polls /api/jobs/[id] (single job endpoint) instead of /api/jobs (all jobs). Falls back to full list poll when no selection or on initial load.
Fail: Always polls /api/jobs for the full list regardless of selection state

EVAL 3: Memoized Thumbnails
Question: Are sidebar job thumbnails wrapped in React.memo to prevent unnecessary re-renders?
Pass: Job thumbnail is extracted as a separate component wrapped in React.memo, receiving stable props. Parent only re-renders changed items.
Fail: Thumbnails are inline in the parent's render, re-rendering all 50+ items on every poll update

EVAL 4: Video Autoplay Control
Question: Does the video player avoid autoplay and clean up on unmount?
Pass: Video element does NOT have autoPlay attribute. Video pauses or unloads when user switches to a different job.
Fail: Video has autoPlay and/or continues playing when switching between jobs
