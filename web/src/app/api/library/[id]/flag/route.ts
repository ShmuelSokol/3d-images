import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionId, getUserId, setSessionCookie } from "@/lib/session";
import { rateLimit } from "@/lib/rate-limit";
import { sendAlert } from "@/lib/notify";

const REASONS = ["sexual", "violent", "hateful", "copyright", "other"] as const;

/**
 * POST /api/library/[id]/flag — report a shared result.
 *
 * A first flag on an un-reviewed image hides it from the library immediately;
 * the owner is told why and can appeal. An image an admin has already cleared
 * is NOT re-hidden by a single flag — otherwise one person could grief a
 * reinstated image forever — it is only re-queued for review.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const { allowed } = rateLimit(`flag:${ip}`, 10, 3600_000);
    if (!allowed) {
      return NextResponse.json(
        { error: "Too many reports. Try again later." },
        { status: 429 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const reason = String(body.reason || "other");
    if (!REASONS.includes(reason as (typeof REASONS)[number])) {
      return NextResponse.json({ error: "Invalid reason" }, { status: 400 });
    }
    const detail =
      typeof body.detail === "string" ? body.detail.slice(0, 1000) : null;

    const image = await prisma.image.findUnique({
      where: { id: params.id },
      select: { id: true, isPublic: true, status: true, moderationStatus: true },
    });
    // Only published results are reportable, and we 404 rather than confirm
    // the existence of anything private.
    if (!image || !image.isPublic || image.status !== "done") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const userId = getUserId(req);
    const sessionId = getSessionId(req);
    const flaggerKey = userId || sessionId;

    try {
      await prisma.imageFlag.create({
        data: { imageId: image.id, flaggerKey, reason, detail },
      });
    } catch {
      // Unique (imageId, flaggerKey) violation — already reported by this
      // person. Report success so the UI stays idempotent.
      const res = NextResponse.json({ ok: true, alreadyReported: true });
      setSessionCookie(res, sessionId, req);
      return res;
    }

    // Only an un-reviewed image is auto-hidden. An image a moderator already
    // cleared stays visible — the new flag is still recorded, and the admin
    // queue surfaces it via flags newer than `moderatedAt`, so one person
    // can't grief a reinstated image by re-reporting it forever.
    const hide = image.moderationStatus === "ok";
    await prisma.image.update({
      where: { id: image.id },
      data: {
        flagCount: { increment: 1 },
        ...(hide ? { moderationStatus: "flagged", hiddenAt: new Date() } : {}),
      },
    });

    // Tell the admin out of band — otherwise a report is only ever seen by
    // someone who happens to open the moderation tab. Deliberately not awaited:
    // the reporter's request shouldn't wait on, or fail with, an email.
    void sendAlert(
      hide ? "3D Images: content reported and hidden" : "3D Images: content reported",
      [
        `A shared result was reported as: ${reason}`,
        detail ? `Detail: ${detail}` : null,
        hide
          ? "It has been hidden from the library immediately, pending review."
          : "It was already reviewed and cleared, so it remains visible.",
        "",
        `Review: https://3d.kbrlive.com/admin (Moderation tab)`,
      ]
        .filter(Boolean)
        .join("\n")
    );

    const res = NextResponse.json({ ok: true, hidden: hide });
    setSessionCookie(res, sessionId, req);
    return res;
  } catch (err) {
    console.error("Flag error:", err);
    return NextResponse.json({ error: "Could not submit report" }, { status: 500 });
  }
}
