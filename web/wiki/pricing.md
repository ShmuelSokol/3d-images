# Pricing

Three tiers. Credit-based pay-as-you-go plus a Pro subscription for video.

| | **Free** | **Pro** | **Credits Pack** |
|---|---|---|---|
| Price | $0 | **$9.99/mo** | $20 one-time |
| Credits | 20 (anon) / 50 (signup) | 200/month | 100 |
| Video | ❌ | ✅ | ❌ |
| Renews | never | monthly | never |
| Expires | never | never | never |

Added 2026-04-19. Before that it was credit-only; video was free-for-all.

## Why $9.99/mo for Pro

Video is the cost driver — a 60s clip at 15fps is 900 depth-estimation passes. One depth pass at CPU-inference takes ~1s on Railway's containers, so a full video is ~15 min of wall clock. That's not something a $0.20/image plan can cover. $9.99 + 200 credits = covers ~13 videos/month worst case, well within margin.

## Why Credits Pack exists separately

Some users want lots of images without a subscription. $20 for 100 images = cheaper per image than Pro ($0.05 vs $0.20) but no video and no renewal. Good for photographers batch-processing once.

## Stripe setup

- Pro = `mode: "subscription"`, $9.99/mo recurring, handled in `api/checkout/pro/route.ts`
- Credits = `mode: "payment"`, $20 one-time, in `api/checkout/route.ts`
- Webhook (`api/webhooks/stripe/route.ts`) handles:
  - `checkout.session.completed` — subscription or one-time
  - `customer.subscription.deleted` — downgrade to free
  - `invoice.paid` (billing_reason === subscription_cycle) — renew 200 credits

Webhook must be configured in Stripe dashboard to receive all three event types.

## Pro cancellation behavior

When a Pro user cancels: `stripeSubscriptionId` is cleared, `plan` flips to `"free"`. **Their remaining credits stay** (they already paid for them). Video uploads are blocked once the plan changes.

## What's deliberate

- No customer-facing refund UI — admin-only. Low support volume.
- Credits never expire, even on Pro. Paying for nothing is worse than the storage cost.
- Anonymous users blocked from video (server-side `PRO_REQUIRED`). Prevents "sign up → burn videos → delete account" loop.
