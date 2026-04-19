# Roadmap

Priority order. Top = next. Delete from this list the moment it ships or becomes irrelevant.

## Now

- **Step 9 of migration** — drop `td_*` tables from old shared Supabase project + delete old `3d-images` bucket. Wait a few days for rollback window first. (See [migration/README](migration/README.md).)
- **Stripe webhook events** — confirm `customer.subscription.deleted` and `invoice.paid` are configured in Stripe dashboard alongside existing `checkout.session.completed`.
- **Cron for `db:backup`** — set up on Mac Mini (`0 3 * * * cd /.../3d-images/web && npm run db:backup`).

## Next

- **Wiggle 3D in worker** — currently only in demo/server-anaglyph.ts, not wired into production image pipeline. Add `wiggleUrl` column to `td_image`.
- **Color stereogram in worker** — same. Add `colorStereogramUrl` column.
- **Pro upgrade prompt on video attempt** — frontend currently shows a generic alert; replace with inline upgrade card with Stripe CTA.
- **Local dev on its own Supabase project** — today local `.env` points at prod. Split for safety (see [safety](safety.md)).

## Later

- **JSON-to-DB restore script** — we can back up, we can't restore. Write the inverse of `db-backup.js`.
- **Off-Supabase backup** — today everything is in-region. Consider S3/R2 for DB dumps + Storage snapshots.
- **Admin refund flow** — exists in code but no UI. Not urgent — user-ask volume is tiny.
- **V3 depth model** — revisit if HF publishes a monocular V3 export with `preprocessor_config.json`. Today the ONNX variants are multi-view only.

## Parked

- Subscription cancellation flow in the UI (today: "manage billing" portal link via Stripe)
- Metric depth output (Depth Anything V2 is relative only)
- Client-side preview of anaglyph before upload
