import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionId, getUserId, isAdmin } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const userId = getUserId(req);
    const sessionId = getSessionId(req);

    // The admin cookie is separate from the customer one, so an admin with no
    // customer account would otherwise be treated as an anonymous visitor —
    // shown a login prompt and capped at the free limit on their own site.
    if (isAdmin(req) && !userId) {
      return NextResponse.json({
        type: "admin",
        credits: null,
        plan: "pro",
        hdCredits: 0,
        limit: null,
      });
    }

    if (userId) {
      // Logged-in user: return credits + plan
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { imageCredits: true, plan: true, hdCredits: true },
      });
      return NextResponse.json({
        type: "user",
        credits: user?.imageCredits ?? 0,
        plan: user?.plan ?? "free",
        hdCredits: user?.hdCredits ?? 0,
        limit: null,
      });
    }

    // Anonymous user: count images by session
    const count = await prisma.image.count({
      where: { sessionId, userId: null },
    });
    return NextResponse.json({
      type: "anonymous",
      credits: null,
      used: count,
      limit: 20,
      remaining: Math.max(0, 20 - count),
    });
  } catch (err) {
    console.error("Credits error:", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
