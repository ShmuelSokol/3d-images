# Credits & Payment Evals — 3D Image Generator

EVAL 1: Anonymous Usage Limits
Question: Are non-logged-in users limited to 20 images?
Pass: POST /api/jobs checks session image count and returns 403 with clear message when >= 20. Frontend shows remaining count and prompts to sign up.
Fail: No limit enforcement, or limit checked only client-side

EVAL 2: Credit System
Question: Do logged-in users start with 50 free credits and get charged 1 credit per image?
Pass: User model has imageCredits field (default 50). POST /api/jobs decrements credits atomically. GET /api/credits returns current balance. Upload blocked when credits <= 0.
Fail: No credit tracking, or credits not decremented on upload

EVAL 3: Stripe Payment
Question: Can users purchase 100 credits for $20 via Stripe Checkout?
Pass: POST /api/checkout creates Stripe Checkout session. Webhook at /api/webhooks/stripe handles checkout.session.completed and adds 100 credits atomically. Success/cancel URLs work.
Fail: No Stripe integration, or credits not added after payment

EVAL 4: Coupon System
Question: Can users redeem coupon codes for 100 free credits?
Pass: POST /api/coupons/redeem accepts a code, validates it (exists, not expired, not max-redeemed, not already used by this user), and adds 100 credits. Returns clear error messages for invalid codes.
Fail: No coupon endpoint, or no validation of redemption limits

EVAL 5: Admin Coupon Management
Question: Can admin create and view coupon codes?
Pass: GET /api/admin/coupons lists all coupons with redemption counts. POST /api/admin/coupons creates new coupon with code, max redemptions, optional expiry. Admin page has Coupons tab.
Fail: No admin coupon endpoints or UI

EVAL 6: Usage UI
Question: Does the frontend show credits/usage and prompt upgrades?
Pass: Header area shows "X credits remaining" for logged-in users or "X/20 free" for anonymous. When limit reached, upload area shows upgrade prompt (sign up or buy credits). Coupon redemption input visible in account area.
Fail: No usage display, or no upgrade prompt when limit reached
