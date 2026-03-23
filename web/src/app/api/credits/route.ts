import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionId, getUserId } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const userId = getUserId(req);
    const sessionId = getSessionId(req);

    if (userId) {
      // Logged-in user: return credits + plan
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { imageCredits: true, plan: true },
      });
      return NextResponse.json({
        type: "user",
        credits: user?.imageCredits ?? 0,
        plan: user?.plan ?? "free",
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
