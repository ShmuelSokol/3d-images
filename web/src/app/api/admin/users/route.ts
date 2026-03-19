import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/admin/users — adjust credits or suspend a user
 * body: { userId, action: "adjustCredits" | "suspend" | "unsuspend", amount?: number, reason?: string }
 */
export async function PATCH(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { userId, action, amount, reason } = await req.json();

    if (!userId || !action) {
      return NextResponse.json({ error: "userId and action required" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (action === "adjustCredits") {
      if (typeof amount !== "number") {
        return NextResponse.json({ error: "amount required" }, { status: 400 });
      }
      const updated = await prisma.user.update({
        where: { id: userId },
        data: { imageCredits: { increment: amount } },
        select: { id: true, email: true, imageCredits: true },
      });
      console.log(`[admin] Adjusted credits for ${user.email}: ${amount > 0 ? "+" : ""}${amount} (reason: ${reason || "none"})`);
      return NextResponse.json({ user: updated });
    }

    if (action === "suspend") {
      await prisma.user.update({
        where: { id: userId },
        data: { imageCredits: 0 },
      });
      console.log(`[admin] Suspended user ${user.email} (reason: ${reason || "none"})`);
      return NextResponse.json({ ok: true, message: `Suspended ${user.email}` });
    }

    if (action === "unsuspend") {
      await prisma.user.update({
        where: { id: userId },
        data: { imageCredits: 50 },
      });
      console.log(`[admin] Unsuspended user ${user.email}, reset to 50 credits`);
      return NextResponse.json({ ok: true, message: `Unsuspended ${user.email}` });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    console.error("Admin users error:", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

/**
 * GET /api/admin/users/export — CSV export
 */
export async function GET(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  if (url.searchParams.get("format") !== "csv") {
    return NextResponse.json({ error: "Use ?format=csv" }, { status: 400 });
  }

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      imageCredits: true,
      createdAt: true,
      _count: { select: { images: true, payments: true } },
    },
  });

  const payments = await prisma.payment.findMany({
    where: { status: "completed" },
    select: { userId: true, amount: true },
  });

  const revenueByUser: Record<string, number> = {};
  for (const p of payments) {
    revenueByUser[p.userId] = (revenueByUser[p.userId] || 0) + p.amount;
  }

  const header = "Email,Credits,Uploads,Payments,Total Spent,Registered";
  const rows = users.map((u) => {
    const spent = ((revenueByUser[u.id] || 0) / 100).toFixed(2);
    return `${u.email},${u.imageCredits},${u._count.images},${u._count.payments},$${spent},${u.createdAt.toISOString().slice(0, 10)}`;
  });

  const csv = [header, ...rows].join("\n");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="users-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
