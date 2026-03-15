import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "../auth/route";

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
        createdAt: true,
        _count: { select: { images: true } },
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

    return NextResponse.json({
      totalJobs,
      totalUsers,
      totalSessions: uniqueSessions.size,
      statusCounts,
      typeCounts,
      dailyData,
      users: allUsers.map((u) => ({
        id: u.id,
        email: u.email,
        createdAt: u.createdAt,
        jobCount: u._count.images,
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
