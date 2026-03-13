import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSupabase } from "@/lib/supabase";
import { jobQueue } from "@/lib/job-queue";
import sharp from "sharp";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const intensity = parseFloat(formData.get("intensity") as string) || 10;
    const isVideo = file.type.startsWith("video/");
    const buffer = Buffer.from(await file.arrayBuffer());

    // Upload original to Supabase Storage
    const supabase = getSupabase();
    const ext = file.name.split(".").pop() || (isVideo ? "mp4" : "jpg");
    const storageName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const folder = isVideo ? "originals/videos" : "originals";

    const { error: uploadError } = await supabase.storage
      .from("3d-images")
      .upload(`${folder}/${storageName}`, buffer, {
        contentType: file.type,
      });

    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
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
        const meta = await sharp(buffer).metadata();
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
        status: "pending",
        mediaType: isVideo ? "video" : "image",
      },
    });

    // Kick the queue (fire and forget)
    jobQueue.kick().catch(console.error);

    return NextResponse.json(job);
  } catch (err) {
    console.error("Upload error:", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}

export async function GET() {
  try {
    const jobs = await prisma.image.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return NextResponse.json(jobs);
  } catch (err) {
    console.error("Fetch error:", err);
    return NextResponse.json({ error: "Fetch failed" }, { status: 500 });
  }
}
