import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/session";
import { getStripe } from "@/lib/stripe";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/refund — refund a payment via Stripe
 * body: { paymentId, reason?: string }
 */
export async function POST(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { paymentId, reason } = await req.json();

    if (!paymentId) {
      return NextResponse.json({ error: "paymentId required" }, { status: 400 });
    }

    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: { user: { select: { id: true, email: true, imageCredits: true } } },
    });

    if (!payment) {
      return NextResponse.json({ error: "Payment not found" }, { status: 404 });
    }

    if (payment.status === "refunded") {
      return NextResponse.json({ error: "Already refunded" }, { status: 400 });
    }

    if (payment.status !== "completed") {
      return NextResponse.json({ error: "Can only refund completed payments" }, { status: 400 });
    }

    // Get the Stripe session to find the payment intent
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(payment.stripeSessionId);

    if (!session.payment_intent) {
      return NextResponse.json({ error: "No payment intent found for this session" }, { status: 400 });
    }

    // Issue refund via Stripe
    const refund = await stripe.refunds.create({
      payment_intent: session.payment_intent as string,
      reason: "requested_by_customer",
    });

    // Update payment status and deduct credits
    await prisma.$transaction([
      prisma.payment.update({
        where: { id: paymentId },
        data: { status: "refunded" },
      }),
      prisma.user.update({
        where: { id: payment.userId },
        data: {
          imageCredits: {
            decrement: Math.min(payment.credits, payment.user.imageCredits),
          },
        },
      }),
    ]);

    console.log(`[admin] Refunded payment ${paymentId} ($${(payment.amount / 100).toFixed(2)}) for ${payment.user.email} (reason: ${reason || "none"}, stripe refund: ${refund.id})`);

    return NextResponse.json({
      ok: true,
      refundId: refund.id,
      creditsRemoved: Math.min(payment.credits, payment.user.imageCredits),
    });
  } catch (err) {
    console.error("Admin refund error:", err);
    return NextResponse.json({ error: "Refund failed" }, { status: 500 });
  }
}
