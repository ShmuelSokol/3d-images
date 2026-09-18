import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSupabase } from "@/lib/supabase";
import { getSessionId, getUserId, isAdmin, SESSION_COOKIE } from "@/lib/session";
import sharp from "sharp";
import { jobQueue } from "@/lib/job-queue";

/**
 * A job belongs to the caller if they own it while logged in, or — for
 * anonymous jobs — if it was created in this browser session. Admins pass.
 * Note we read the session cookie directly rather than via getSessionId(),
 * which mints a fresh id when none exists and would never match.
 */
function ownsJob(
  job: { userId: string | null; sessionId: string | null },
  req: NextRequest
): boolean {
  if (isAdmin(req)) return true;
  const userId = getUserId(req);
  if (job.userId) return userId !== null && job.userId === userId;
  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  return !!job.sessionId && !!cookie && job.sessionId === cookie;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const job = await prisma.image.findUnique({
      where: { id: params.id },
    });
    if (!job) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    // Published results are readable by anyone; everything else is private.
    // 404 rather than 403 so IDs can't be probed for existence.
    if (!job.isPublic && !ownsJob(job, req)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(job);
  } catch (err) {
    console.error("Fetch job error:", err);
    return NextResponse.json({ error: "Fetch failed" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json();

    // Every mutating action requires ownership of the job.
    const existing = await prisma.image.findUnique({
      where: { id: params.id },
      select: { userId: true, sessionId: true, status: true },
    });
    if (!existing || !ownsJob(existing, req)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (body.action === "publish" || body.action === "unpublish") {
      const publish = body.action === "publish";
      if (publish && existing.status !== "done") {
        return NextResponse.json(
          { error: "Only finished results can be shared to the library." },
          { status: 400 }
        );
      }
      const job = await prisma.image.update({
        where: { id: params.id },
        data: { isPublic: publish, publishedAt: publish ? new Date() : null },
      });
      return NextResponse.json(job);
    }

    if (body.action === "cancel") {
      await prisma.image.update({
        where: { id: params.id },
        data: { status: "cancelled" },
      });
      return NextResponse.json({ ok: true });
    }

    if (body.action === "retry") {
      const job = await prisma.image.update({
        where: { id: params.id },
        data: { status: "pending", error: null, framesDone: 0 },
      });
      jobQueue.kick().catch(console.error);
      return NextResponse.json(job);
    }

    if (body.action === "reprocess") {
      const updates: Record<string, unknown> = { status: "pending", error: null, framesDone: 0 };
      if (body.intensity !== undefined) {
        const val = parseInt(body.intensity);
        if (isNaN(val) || val < 1 || val > 40) {
          return NextResponse.json({ error: "Invalid intensity" }, { status: 400 });
        }
        updates.intensity = val;
      }
      if (body.colorMode !== undefined) {
        updates.colorMode = body.colorMode === "classic" ? "classic" : "dubois";
      }
      if (body.fillOcclusion !== undefined) {
        updates.fillOcclusion = !!body.fillOcclusion;
      }
      const job = await prisma.image.update({
        where: { id: params.id },
        data: updates,
      });
      jobQueue.kick().catch(console.error);
      return NextResponse.json(job);
    }

    if (body.action === "rotate") {
      const angle = parseInt(body.angle) || 90;
      const job = await prisma.image.findUnique({ where: { id: params.id } });
      if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });

      // Download original
      const res = await fetch(job.originalUrl);
      if (!res.ok) return NextResponse.json({ error: "Download failed" }, { status: 500 });
      const buf = Buffer.from(await res.arrayBuffer());

      // Rotate with sharp
      const rotated = await sharp(buf).rotate(angle).toBuffer();
      const meta = await sharp(rotated).metadata();

      // Upload rotated as new original
      const supabase = getSupabase();
      const ext = job.fileName.split(".").pop() || "jpg";
      const storageName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("3d-images")
        .upload(`originals/${storageName}`, rotated, {
          contentType: `image/${ext === "png" ? "png" : "jpeg"}`,
        });
      if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 });

      const { data: { publicUrl } } = supabase.storage
        .from("3d-images")
        .getPublicUrl(`originals/${storageName}`);

      // Create new job with rotated image
      const sessionId = getSessionId(req);
      const userId = getUserId(req);
      const newJob = await prisma.image.create({
        data: {
          originalUrl: publicUrl,
          fileName: `${job.fileName} (rotated ${angle}°)`,
          width: meta.width || 0,
          height: meta.height || 0,
          intensity: job.intensity,
          colorMode: job.colorMode,
          fillOcclusion: job.fillOcclusion,
          status: "pending",
          mediaType: "image",
          sessionId,
          userId,
        },
      });

      jobQueue.kick().catch(console.error);
      return NextResponse.json(newJob);
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    console.error("Patch job error:", err);
    return NextResponse.json({ error: "Patch failed" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const existing = await prisma.image.findUnique({
      where: { id: params.id },
      select: { userId: true, sessionId: true },
    });
    if (!existing || !ownsJob(existing, req)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    await prisma.image.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Delete job error:", err);
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
}
