import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // All jobs with timestamps
    const allJobs = await prisma.image.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        fileName: true,
        status: true,
        mediaType: true,
        intensity: true,
        colorMode: true,
        fillOcclusion: true,
        width: true,
        height: true,
        sessionId: true,
        userId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // All users
    const allUsers = await prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        email: true,
        imageCredits: true,
        createdAt: true,
        _count: { select: { images: true, payments: true } },
      },
    });

    // All payments
    const allPayments = await prisma.payment.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        userId: true,
        stripeSessionId: true,
        amount: true,
        credits: true,
        status: true,
        createdAt: true,
        user: { select: { email: true } },
      },
    });

    // Stats
    const totalJobs = allJobs.length;
    const totalUsers = allUsers.length;
    const statusCounts: Record<string, number> = {};
    const typeCounts: Record<string, number> = {};
    const dailyCounts: Record<string, number> = {};
    const uniqueSessions = new Set<string>();

    for (const job of allJobs) {
      statusCounts[job.status] = (statusCounts[job.status] || 0) + 1;
      typeCounts[job.mediaType] = (typeCounts[job.mediaType] || 0) + 1;
      if (job.sessionId) uniqueSessions.add(job.sessionId);

      const day = job.createdAt.toISOString().slice(0, 10);
      dailyCounts[day] = (dailyCounts[day] || 0) + 1;
    }

    // Daily data for chart (last 30 days)
    const dailyData: { date: string; count: number }[] = [];
    const now = new Date();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      dailyData.push({ date: key, count: dailyCounts[key] || 0 });
    }

    // Daily revenue data (last 30 days)
    const dailyRevenue: Record<string, number> = {};
    for (const p of allPayments) {
      if (p.status === "completed") {
        const day = p.createdAt.toISOString().slice(0, 10);
        dailyRevenue[day] = (dailyRevenue[day] || 0) + p.amount;
      }
    }
    const revenueData: { date: string; revenue: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      revenueData.push({ date: key, revenue: (dailyRevenue[key] || 0) / 100 });
    }

    // Active/processing jobs for queue monitor
    const activeJobs = allJobs
      .filter((j) => j.status === "processing" || j.status === "pending")
      .map((j) => ({
        ...j,
        // Include frame progress for videos
      }));

    // Get frame progress for active video jobs
    const activeVideoIds = activeJobs.filter(j => j.mediaType === "video").map(j => j.id);
    const activeVideos = activeVideoIds.length > 0
      ? await prisma.image.findMany({
          where: { id: { in: activeVideoIds } },
          select: { id: true, frameCount: true, framesDone: true, startedAt: true },
        })
      : [];
    const videoProgressMap: Record<string, { frameCount: number | null; framesDone: number; startedAt: Date | null }> = {};
    for (const v of activeVideos) {
      videoProgressMap[v.id] = { frameCount: v.frameCount, framesDone: v.framesDone, startedAt: v.startedAt };
    }

    return NextResponse.json({
      totalJobs,
      totalUsers,
      totalSessions: uniqueSessions.size,
      statusCounts,
      typeCounts,
      dailyData,
      revenueData,
      queueJobs: activeJobs.map((j) => ({
        ...j,
        frameCount: videoProgressMap[j.id]?.frameCount ?? null,
        framesDone: videoProgressMap[j.id]?.framesDone ?? 0,
        startedAt: videoProgressMap[j.id]?.startedAt ?? null,
      })),
      users: allUsers.map((u) => ({
        id: u.id,
        email: u.email,
        credits: u.imageCredits,
        createdAt: u.createdAt,
        jobCount: u._count.images,
        paymentCount: u._count.payments,
      })),
      payments: allPayments.map((p) => ({
        id: p.id,
        email: p.user.email,
        amount: p.amount,
        credits: p.credits,
        status: p.status,
        stripeSessionId: p.stripeSessionId,
        createdAt: p.createdAt,
      })),
      recentJobs: allJobs.slice(0, 100),
    }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("Admin stats error:", err);
    return NextResponse.json({ error: "Failed to load stats" }, { status: 500 });
  }
}
