import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSupabase } from "@/lib/supabase";
import { jobQueue } from "@/lib/job-queue";
import { getSessionId, getUserId, setSessionCookie } from "@/lib/session";
import sharp from "sharp";

// Supabase rejects storage objects over 50 MB — keep headroom under that.
const STORAGE_LIMIT_BYTES = 45 * 1024 * 1024;
// Absolute ceiling on an incoming request body.
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

function formatMb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const intensity = parseFloat(formData.get("intensity") as string) || 10;
    const colorMode = (formData.get("colorMode") as string) || "dubois";
    const fillOcclusion = (formData.get("fillOcclusion") as string) !== "false";
    const formats = (formData.get("formats") as string) || "anaglyph,stereogram,sbs";
    const isVideo = file.type.startsWith("video/");
    const buffer = Buffer.from(await file.arrayBuffer());

    if (buffer.length > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        {
          error: `File is too large (${formatMb(buffer.length)}). Maximum is ${formatMb(MAX_UPLOAD_BYTES)}.`,
          code: "FILE_TOO_LARGE",
        },
        { status: 413 }
      );
    }
    // Oversized stills are shrunk before storage (below); videos can't be, so stop here.
    if (isVideo && buffer.length > STORAGE_LIMIT_BYTES) {
      return NextResponse.json(
        {
          error: `Video is too large (${formatMb(buffer.length)}). Maximum is ${formatMb(STORAGE_LIMIT_BYTES)} — trim it or lower the resolution.`,
          code: "FILE_TOO_LARGE",
        },
        { status: 413 }
      );
    }

    const sessionId = getSessionId(req);
    const userId = getUserId(req);

    // ── Usage limit check ──
    if (userId) {
      // Logged-in user: check credits + plan
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { imageCredits: true, plan: true },
      });
      if (!user || user.imageCredits <= 0) {
        return NextResponse.json(
          { error: "No credits remaining. Purchase more or redeem a coupon.", code: "NO_CREDITS" },
          { status: 403 }
        );
      }
      // Video requires Pro plan
      if (isVideo && user.plan !== "pro") {
        return NextResponse.json(
          { error: "Video processing requires Pro plan. Upgrade for $9.99/month.", code: "PRO_REQUIRED" },
          { status: 403 }
        );
      }
      // The credit is charged only once the job row exists (see below), so a
      // failed upload can never burn a credit without producing a job.
    } else {
      // Anonymous: no video
      if (isVideo) {
        return NextResponse.json(
          { error: "Video processing requires Pro plan. Sign up and upgrade!", code: "PRO_REQUIRED" },
          { status: 403 }
        );
      }
      // Anonymous user: max 20 images
      const count = await prisma.image.count({
        where: { sessionId, userId: null },
      });
      if (count >= 20) {
        return NextResponse.json(
          { error: "Free limit reached (20 images). Sign up for 50 free credits!", code: "ANON_LIMIT" },
          { status: 403 }
        );
      }
    }

    // Re-encode stills that exceed the storage cap. Processing downscales to
    // 1024px anyway (job-processor), so nothing useful is lost — this turns a
    // hard rejection from Supabase into a job that simply works.
    let storedBuffer = buffer;
    let storedType = file.type;
    let storedExt = file.name.split(".").pop() || (isVideo ? "mp4" : "jpg");

    if (!isVideo && storedBuffer.length > STORAGE_LIMIT_BYTES) {
      try {
        storedBuffer = Buffer.from(
          await sharp(buffer, { limitInputPixels: false })
            .rotate()
            .resize(4096, 4096, { fit: "inside", withoutEnlargement: true })
            .jpeg({ quality: 88 })
            .toBuffer()
        );
        storedType = "image/jpeg";
        storedExt = "jpg";
        console.log(
          `[upload] Shrank ${formatMb(buffer.length)} -> ${formatMb(storedBuffer.length)}`
        );
      } catch (err) {
        console.error("Downscale failed:", err);
        return NextResponse.json(
          { error: "Could not read that image — try re-saving it as a JPEG or PNG.", code: "BAD_IMAGE" },
          { status: 400 }
        );
      }
    }

    if (storedBuffer.length > STORAGE_LIMIT_BYTES) {
      return NextResponse.json(
        {
          error: `File is too large to store (${formatMb(storedBuffer.length)}). Maximum is ${formatMb(STORAGE_LIMIT_BYTES)}.`,
          code: "FILE_TOO_LARGE",
        },
        { status: 413 }
      );
    }

    // Upload original to Supabase Storage
    const supabase = getSupabase();
    const storageName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${storedExt}`;
    const folder = isVideo ? "originals/videos" : "originals";

    const { error: uploadError } = await supabase.storage
      .from("3d-images")
      .upload(`${folder}/${storageName}`, storedBuffer, {
        contentType: storedType,
      });

    if (uploadError) {
      console.error("Storage upload failed:", uploadError.message);
      return NextResponse.json(
        { error: "Upload failed — please try a smaller file.", code: "UPLOAD_FAILED" },
        { status: 500 }
      );
    }

    const {
      data: { publicUrl },
    } = supabase.storage
      .from("3d-images")
      .getPublicUrl(`${folder}/${storageName}`);

    // Get image dimensions (for images only)
    let width = 0,
      height = 0;
    if (!isVideo) {
      try {
        const meta = await sharp(storedBuffer, { limitInputPixels: false }).metadata();
        width = meta.width || 0;
        height = meta.height || 0;
      } catch {
        /* ignore dimension detection failure */
      }
    }

    // Create DB record
    const job = await prisma.image.create({
      data: {
        originalUrl: publicUrl,
        fileName: file.name,
        width,
        height,
        intensity,
        colorMode,
        fillOcclusion,
        formats: isVideo ? formats : "anaglyph,stereogram,sbs",
        status: "pending",
        mediaType: isVideo ? "video" : "image",
        sessionId,
        userId,
      },
    });

    // Charge the credit only now that the job row exists.
    if (userId) {
      await prisma.user.update({
        where: { id: userId },
        data: { imageCredits: { decrement: 1 } },
      });
    }

    // Kick the queue (fire and forget)
    jobQueue.kick().catch(console.error);

    const res = NextResponse.json(job);
    setSessionCookie(res, sessionId, req);
    return res;
  } catch (err) {
    console.error("Upload error:", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const userId = getUserId(req);
    const sessionId = getSessionId(req);

    // If logged in, show all user's jobs; otherwise show session's jobs
    const where = userId
      ? { userId }
      : { sessionId };

    const jobs = await prisma.image.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        originalUrl: true,
        depthMapUrl: true,
        distanceMapUrl: true,
        anaglyphUrl: true,
        stereogramUrl: true,
        sbsUrl: true,
        videoUrl: true,
        fileName: true,
        width: true,
        height: true,
        intensity: true,
        colorMode: true,
        fillOcclusion: true,
        status: true,
        error: true,
        mediaType: true,
        duration: true,
        frameCount: true,
        framesDone: true,
        createdAt: true,
      },
    });

    const res = NextResponse.json(jobs, {
      headers: { "Cache-Control": "private, max-age=0, stale-while-revalidate=3" },
    });
    setSessionCookie(res, sessionId, req);
    return res;
  } catch (err) {
    console.error("Fetch error:", err);
    return NextResponse.json({ error: "Fetch failed" }, { status: 500 });
  }
}
