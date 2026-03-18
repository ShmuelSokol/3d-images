import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserId } from "@/lib/session";

export async function POST(req: NextRequest) {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return NextResponse.json({ error: "You must be logged in to redeem a coupon" }, { status: 401 });
    }

    const body = await req.json();
    const code = (body.code || "").trim().toUpperCase();
    if (!code) {
      return NextResponse.json({ error: "No coupon code provided" }, { status: 400 });
    }

    // Find coupon
    const coupon = await prisma.coupon.findUnique({ where: { code } });
    if (!coupon) {
      return NextResponse.json({ error: "Invalid coupon code" }, { status: 404 });
    }

    // Check expiry
    if (coupon.expiresAt && coupon.expiresAt < new Date()) {
      return NextResponse.json({ error: "This coupon has expired" }, { status: 400 });
    }

    // Check max redemptions
    if (coupon.timesRedeemed >= coupon.maxRedemptions) {
      return NextResponse.json({ error: "This coupon has been fully redeemed" }, { status: 400 });
    }

    // Check if user already redeemed
    const existing = await prisma.couponRedemption.findUnique({
      where: { couponId_userId: { couponId: coupon.id, userId } },
    });
    if (existing) {
      return NextResponse.json({ error: "You have already redeemed this coupon" }, { status: 400 });
    }

    // Redeem: add credits + create redemption + increment counter
    const [user] = await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: { imageCredits: { increment: coupon.credits } },
        select: { imageCredits: true },
      }),
      prisma.couponRedemption.create({
        data: { couponId: coupon.id, userId },
      }),
      prisma.coupon.update({
        where: { id: coupon.id },
        data: { timesRedeemed: { increment: 1 } },
      }),
    ]);

    return NextResponse.json({
      credits: user.imageCredits,
      added: coupon.credits,
      message: `Added ${coupon.credits} credits!`,
    });
  } catch (err) {
    console.error("Coupon redeem error:", err);
    return NextResponse.json({ error: "Redemption failed" }, { status: 500 });
  }
}
