# Decisions

Rolling log. Newest at the top. What we decided, why, so future-us doesn't relitigate.

## 2026-04-19 — Migrate off shared Supabase project

**Decision:** 3D Images moves to its own Supabase project (`fslwkomtwcxsnprhknyw`), away from shared `ushngszdltlctmqlwgot`.

**Why:** OCR Hebrew's schema was wiped on 2026-04-19 by a stray `prisma db push` from a sibling app sharing the same project. Our tables (`td_*`) were one misstep away from the same fate. The free tier covers the cost.

**Consequence:** Zero-downtime migration completed same day. Added `/api/health` table check, `db-push-guarded.js`, `db-backup.js`. Full writeup in [migration/README](migration/README.md).

## 2026-04-19 — Pro subscription for video

**Decision:** Video processing moves behind a $9.99/mo Pro plan. Free and Credits-Pack users get images only.

**Why:** Video is cost-inverse to the current pricing — a 60s clip is ~900 frames of depth estimation, far more than the credit pricing covers. Pro plan aligns cost to compute. Also creates a recurring-revenue line.

**Consequence:** Server + frontend gate video on `plan === "pro"`. Webhook handles monthly renewal (200 credits added via `invoice.paid`). Stripe dashboard must have all three event types enabled.

## 2026-04-19 — Depth Anything V3 abandoned

**Decision:** Stay on V2 Large. Don't pursue V3 unless a monocular ONNX variant lands.

**Why:** V3 is a multi-view model (5D input, `[batch, views, channels, h, w]`). The `@huggingface/transformers` `depth-estimation` pipeline expects 4D monocular input. All three `onnx-community/depth-anything-v3-*` exports + `TillBeemelmanns` metric variant are multi-view. Tried it, got `Invalid rank for input: pixel_values. Got: 4. Expected: 5`.

**Consequence:** Reverted to `v2-large`. Revisit when HF ships a monocular V3 ONNX export.

## 2026-04-19 — Color stereogram: strip-feedback, not union-find

**Decision:** Color-photo stereograms use strip-based feedback. Random-dot stereograms keep using union-find.

**Why:** Union-find forces duplicate colors across the depth shift — invisible for random dots, catastrophic for photo textures (ghosting, tearing, image unrecognizable). Strip-feedback preserves texture coherence within each depth band.

**Consequence:** `generateColorStereogram` fully rewritten in `src/lib/server-anaglyph.ts`. Parameters: strip width = `outW/7`, max shift = 5% of strip width.

## 2026-04-19 — Temporal stereogram for video

**Decision:** Video stereograms use one fixed base pattern across all frames.

**Why:** Per-frame randomization made the Magic Eye flicker — viewer loses focus every 1/15s. A single pattern means the eye locks in once.

**Consequence:** `scripts/temporal-stereogram.js` separate from `worker.js`; generates base pattern up front, reuses across 900 frames.

## 2026-04-19 — Rerun + Reprocess buttons

**Decision:** Done jobs get a **Rerun** button (regenerate with current settings); cancelled jobs get **Reprocess**.

**Why:** Users wanted to iterate on a given image with different intensity settings without re-uploading.

**Consequence:** Both buttons hit `POST /api/jobs/[id]` with `action: "reprocess"` — flips status to pending, kicks queue.
