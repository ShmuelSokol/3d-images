import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserId } from "@/lib/session";
import { getStripe } from "@/lib/stripe";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return NextResponse.json({ error: "You must be logged in to purchase credits" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const origin = req.headers.get("origin") || "https://3d.kbrlive.com";
    const stripe = getStripe();

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: user.email,
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: "100 Image Credits",
              description: "Process 100 images with AI 3D depth estimation",
            },
            unit_amount: 2000, // $20.00
          },
          quantity: 1,
        },
      ],
      payment_intent_data: {
        receipt_email: user.email,
      },
      invoice_creation: {
        enabled: true,
      },
      metadata: { userId },
      success_url: `${origin}?payment=success`,
      cancel_url: `${origin}?payment=cancelled`,
    });

    // Record pending payment
    await prisma.payment.create({
      data: {
        userId,
        stripeSessionId: session.id,
        amount: 2000,
        credits: 100,
        status: "pending",
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("Checkout error:", err);
    return NextResponse.json({ error: "Checkout failed" }, { status: 500 });
  }
}
