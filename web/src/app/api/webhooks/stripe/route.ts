import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import Stripe from "stripe";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.text();
    const sig = req.headers.get("stripe-signature");
    if (!sig) {
      return NextResponse.json({ error: "Missing signature" }, { status: 400 });
    }

    const webhookSecret = process.env["STRIPE_WEBHOOK_SECRET"] || "";
    const stripe = getStripe();

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
    } catch (err) {
      console.error("Webhook signature verification failed:", err);
      return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.userId;
      if (!userId) {
        console.error("No userId in session metadata");
        return NextResponse.json({ received: true });
      }

      if (session.mode === "subscription") {
        // Pro subscription activated
        const subscriptionId = typeof session.subscription === "string"
          ? session.subscription
          : session.subscription?.id;
        await prisma.user.update({
          where: { id: userId },
          data: {
            plan: "pro",
            stripeSubscriptionId: subscriptionId || null,
            imageCredits: { increment: 200 },
          },
        });
        console.log(`[stripe] User ${userId} upgraded to Pro (subscription: ${subscriptionId})`);
      } else {
        // One-time credit purchase
        const payment = await prisma.payment.findUnique({
          where: { stripeSessionId: session.id },
        });

        if (payment && payment.status === "pending") {
          await prisma.$transaction([
            prisma.payment.update({
              where: { id: payment.id },
              data: { status: "completed" },
            }),
            prisma.user.update({
              where: { id: userId },
              data: { imageCredits: { increment: payment.credits } },
            }),
          ]);
          console.log(`[stripe] Added ${payment.credits} credits to user ${userId}`);
        }
      }
    }

    // Subscription cancelled or expired
    if (event.type === "customer.subscription.deleted") {
      const subscription = event.data.object as Stripe.Subscription;
      const userId = subscription.metadata?.userId;
      if (userId) {
        await prisma.user.update({
          where: { id: userId },
          data: { plan: "free", stripeSubscriptionId: null },
        });
        console.log(`[stripe] User ${userId} downgraded to free (subscription cancelled)`);
      }
    }

    // Monthly renewal — add 200 credits
    if (event.type === "invoice.paid") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const invoice = event.data.object as any;
      // Only for subscription renewals (not first payment which is handled above)
      if (invoice.billing_reason === "subscription_cycle") {
        const subscriptionId = typeof invoice.subscription === "string"
          ? invoice.subscription
          : invoice.subscription?.id;
        if (subscriptionId) {
          const user = await prisma.user.findFirst({
            where: { stripeSubscriptionId: subscriptionId },
          });
          if (user) {
            await prisma.user.update({
              where: { id: user.id },
              data: { imageCredits: { increment: 200 } },
            });
            console.log(`[stripe] Renewed 200 credits for user ${user.id}`);
          }
        }
      }
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("Webhook error:", err);
    return NextResponse.json({ error: "Webhook failed" }, { status: 500 });
  }
}
