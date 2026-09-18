import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const PAGE_SIZE = 24;

/**
 * GET /api/library — public gallery of results their creators chose to share.
 * Deliberately exposes no owner identity and no source file name.
 */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const page = Math.max(0, parseInt(url.searchParams.get("page") || "0") || 0);
    const mediaType = url.searchParams.get("type");

    const where = {
      isPublic: true,
      status: "done",
      // Flagged / appealed / removed results are invisible to everyone.
      // Only never-reported ("ok") and moderator-cleared results show.
      moderationStatus: { in: ["ok", "cleared"] },
      ...(mediaType === "video" || mediaType === "image" ? { mediaType } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.image.findMany({
        where,
        orderBy: { publishedAt: "desc" },
        skip: page * PAGE_SIZE,
        take: PAGE_SIZE,
        // No fileName, userId or sessionId — sharing a result must not
        // reveal who made it or what their file was called.
        select: {
          id: true,
          anaglyphUrl: true,
          stereogramUrl: true,
          sbsUrl: true,
          videoUrl: true,
          width: true,
          height: true,
          intensity: true,
          colorMode: true,
          mediaType: true,
          publishedAt: true,
        },
      }),
      prisma.image.count({ where }),
    ]);

    return NextResponse.json(
      { items, total, page, pageSize: PAGE_SIZE, hasMore: (page + 1) * PAGE_SIZE < total },
      { headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=300" } }
    );
  } catch (err) {
    console.error("Library fetch error:", err);
    return NextResponse.json({ error: "Failed to load library" }, { status: 500 });
  }
}

export const dynamic = "force-dynamic";
