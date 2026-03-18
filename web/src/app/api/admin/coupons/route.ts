import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/session";

export async function GET(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const coupons = await prisma.coupon.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      redemptions: {
        include: { user: { select: { email: true } } },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  return NextResponse.json(coupons);
}

export async function POST(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const code = (body.code || "").trim().toUpperCase();
    if (!code || code.length < 3) {
      return NextResponse.json({ error: "Code must be at least 3 characters" }, { status: 400 });
    }

    const existing = await prisma.coupon.findUnique({ where: { code } });
    if (existing) {
      return NextResponse.json({ error: "Code already exists" }, { status: 409 });
    }

    const credits = parseInt(body.credits) || 100;
    const maxRedemptions = parseInt(body.maxRedemptions) || 1;
    const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;

    const coupon = await prisma.coupon.create({
      data: { code, credits, maxRedemptions, expiresAt },
    });

    return NextResponse.json(coupon);
  } catch (err) {
    console.error("Create coupon error:", err);
    return NextResponse.json({ error: "Failed to create coupon" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  await prisma.coupon.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
