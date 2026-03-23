import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserId } from "@/lib/session";
import { getStripe } from "@/lib/stripe";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return NextResponse.json({ error: "You must be logged in" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, plan: true, stripeCustomerId: true },
    });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    if (user.plan === "pro") {
      return NextResponse.json({ error: "Already on Pro plan" }, { status: 400 });
    }

    const origin = req.headers.get("origin") || "https://3d.kbrlive.com";
    const stripe = getStripe();

    // Reuse or create Stripe customer
    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { userId },
      });
      customerId = customer.id;
      await prisma.user.update({
        where: { id: userId },
        data: { stripeCustomerId: customerId },
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: "Pro Plan",
              description: "Unlimited video processing + 200 credits/month",
            },
            unit_amount: 999, // $9.99/month
            recurring: { interval: "month" },
          },
          quantity: 1,
        },
      ],
      metadata: { userId },
      subscription_data: {
        metadata: { userId },
      },
      success_url: `${origin}?payment=pro-success`,
      cancel_url: `${origin}?payment=cancelled`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("Pro checkout error:", err);
    return NextResponse.json({ error: "Checkout failed" }, { status: 500 });
  }
}
