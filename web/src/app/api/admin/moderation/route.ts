import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * GET — the moderation queue: everything hidden by a flag, everything the
 * owner has appealed, and anything re-reported since it was last cleared.
 */
export async function GET(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [pending, cleared, removed, publishedCount] = await Promise.all([
    prisma.image.findMany({
      where: { moderationStatus: { in: ["flagged", "appealed"] } },
      orderBy: [{ appealedAt: "desc" }, { hiddenAt: "desc" }],
      take: 100,
      select: {
        id: true,
        anaglyphUrl: true,
        stereogramUrl: true,
        videoUrl: true,
        fileName: true,
        mediaType: true,
        moderationStatus: true,
        flagCount: true,
        hiddenAt: true,
        appealText: true,
        appealedAt: true,
        isPublic: true,
        createdAt: true,
        user: { select: { email: true } },
        flags: {
          orderBy: { createdAt: "desc" },
          take: 20,
          select: { reason: true, detail: true, createdAt: true },
        },
      },
    }),
    // Cleared results that have been reported again since the decision —
    // worth a second look without hiding them automatically.
    prisma.image.findMany({
      where: { moderationStatus: "cleared" },
      orderBy: { moderatedAt: "desc" },
      take: 100,
      select: {
        id: true,
        anaglyphUrl: true,
        fileName: true,
        mediaType: true,
        flagCount: true,
        moderatedAt: true,
        moderatorNote: true,
        isPublic: true,
        user: { select: { email: true } },
        flags: {
          orderBy: { createdAt: "desc" },
          take: 20,
          select: { reason: true, detail: true, createdAt: true },
        },
      },
    }),
    prisma.image.count({ where: { moderationStatus: "removed" } }),
    prisma.image.count({
      where: { isPublic: true, status: "done", moderationStatus: { in: ["ok", "cleared"] } },
    }),
  ]);

  // Only surface a cleared item if it was flagged again after being cleared.
  const reflagged = cleared.filter(
    (img) =>
      img.moderatedAt && img.flags.some((f) => f.createdAt > img.moderatedAt!)
  );

  return NextResponse.json({
    pending,
    reflagged,
    removedCount: removed,
    publishedCount,
  });
}

/**
 * PATCH — act on a reported result.
 * action: "clear"   → visible again, immune to single-flag auto-hide
 *         "remove"  → permanently unpublished, owner can't re-share it
 *         "unshare" → plain unpublish (no wrongdoing implied)
 */
export async function PATCH(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { imageId, action, note } = await req.json();
  if (!imageId || !action) {
    return NextResponse.json({ error: "imageId and action required" }, { status: 400 });
  }

  const moderatorNote = typeof note === "string" ? note.slice(0, 1000) : null;
  const now = new Date();

  if (action === "clear") {
    const updated = await prisma.image.update({
      where: { id: imageId },
      data: {
        moderationStatus: "cleared",
        hiddenAt: null,
        moderatedAt: now,
        moderatorNote,
      },
    });
    return NextResponse.json(updated);
  }

  if (action === "remove") {
    const updated = await prisma.image.update({
      where: { id: imageId },
      data: {
        moderationStatus: "removed",
        isPublic: false,
        publishedAt: null,
        hiddenAt: now,
        moderatedAt: now,
        moderatorNote,
      },
    });
    return NextResponse.json(updated);
  }

  if (action === "unshare") {
    const updated = await prisma.image.update({
      where: { id: imageId },
      data: { isPublic: false, publishedAt: null, moderatedAt: now, moderatorNote },
    });
    return NextResponse.json(updated);
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
