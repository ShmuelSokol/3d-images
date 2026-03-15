import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSupabase } from "@/lib/supabase";
import { getSessionId, getUserId } from "@/lib/session";
import sharp from "sharp";
import { jobQueue } from "@/lib/job-queue";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const job = await prisma.image.findUnique({
      where: { id: params.id },
    });
    if (!job) {
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
      const newIntensity = parseInt(body.intensity);
      if (isNaN(newIntensity) || newIntensity < 1 || newIntensity > 40) {
        return NextResponse.json({ error: "Invalid intensity" }, { status: 400 });
      }
      const job = await prisma.image.update({
        where: { id: params.id },
        data: { intensity: newIntensity, status: "pending", error: null, framesDone: 0 },
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
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await prisma.image.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Delete job error:", err);
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
}
