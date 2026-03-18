# Autoresearch Changelog — Credits & Payments

## Experiment 0 — baseline

**Score:** 0/6 (0%)
**Change:** None — no usage limits, no credits, no payments
**Eval Results:** All 6 fail — completely free and unlimited

## Experiment 1 — keep

**Score:** 6/6 (100%)
**Change:** Full credits and payment system
**Result:** All 6 evals pass.
**Specific changes:**

### Database (raw SQL migrations)
- `td_user.imageCredits` (INT, default 50) — user credit balance
- `td_coupon` — code, credits, maxRedemptions, timesRedeemed, expiresAt
- `td_coupon_redemption` — couponId + userId (unique pair)
- `td_payment` — userId, stripeSessionId, amount, credits, status

### API Endpoints
- **POST /api/jobs** — checks anonymous limit (20 by sessionId) or user credits (decrement atomically), returns 403 with `NO_CREDITS` or `ANON_LIMIT` code
- **GET /api/credits** — returns `{ type, credits, used, limit, remaining }` for both anonymous and logged-in users
- **POST /api/coupons/redeem** — validates code (exists, not expired, not max-redeemed, not already used by this user), adds credits in transaction
- **POST /api/checkout** — creates Stripe Checkout session ($20 for 100 credits), records pending payment
- **POST /api/webhooks/stripe** — handles `checkout.session.completed`, adds credits atomically
- **GET/POST/DELETE /api/admin/coupons** — admin CRUD for coupon codes

### Frontend (ImageProcessor.tsx)
- Header shows "X credits remaining" for logged-in users or "X/20 free" for anonymous
- Upgrade panel appears when credits <= 5 or on 403 error: "Buy 100 Credits — $20" button + coupon code input
- Anonymous users see "Free limit reached" prompt to sign up
- Credits refreshed after upload, login, register, logout, coupon redemption

### Admin (admin/page.tsx)
- New "Coupons" tab with create form (code, credits, max uses) and table showing all coupons + redemption history
- Delete button per coupon
