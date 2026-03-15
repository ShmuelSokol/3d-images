import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSupabase } from "@/lib/supabase";
import sharp from "sharp";
import {
  generateAnaglyphServer,
  generateColorMap,
  rawToPng,
  depthToPng,
} from "@/lib/server-anaglyph";

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const jobId = params.id;

  try {
    // 1. Look up the job
    const job = await prisma.image.findUnique({ where: { id: jobId } });
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    // 2. Extract the uploaded depth PNG from the request
    let depthBuffer: Buffer;
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("depth") as File | null;
      if (!file) {
        return NextResponse.json(
          { error: "Missing 'depth' file in form data" },
          { status: 400 }
        );
      }
      depthBuffer = Buffer.from(await file.arrayBuffer());
    } else {
      // Assume raw PNG body
      depthBuffer = Buffer.from(await request.arrayBuffer());
    }

    if (!depthBuffer.length) {
      return NextResponse.json(
        { error: "Empty depth map" },
        { status: 400 }
      );
    }

    // 3. Decode depth PNG to grayscale Float32Array (0-255 → 0.0-1.0)
    const depthRaw = await sharp(depthBuffer)
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const depthWidth = depthRaw.info.width;
    const depthHeight = depthRaw.info.height;
    const depthData = new Float32Array(depthWidth * depthHeight);
    for (let i = 0; i < depthData.length; i++) {
      depthData[i] = depthRaw.data[i] / 255;
    }

    // 4. Download the original image
    const res = await fetch(job.originalUrl);
    if (!res.ok) {
      return NextResponse.json(
        { error: `Failed to download original image: ${res.status}` },
        { status: 500 }
      );
    }
    const inputBuffer = Buffer.from(await res.arrayBuffer());

    // 5. Auto-rotate + resize to max 1024px (same as job-processor.ts)
    const rotated = Buffer.from(await sharp(inputBuffer).rotate().toBuffer());
    const meta = await sharp(rotated).metadata();
    let w = meta.width || 0;
    let h = meta.height || 0;
    const maxDim = 1024;
    let resized: Buffer = rotated;
    if (w > maxDim || h > maxDim) {
      const s = maxDim / Math.max(w, h);
      w = Math.round(w * s);
      h = Math.round(h * s);
      resized = Buffer.from(
        await sharp(rotated).resize(w, h).jpeg({ quality: 85 }).toBuffer()
      );
    }

    // 6. Decode resized original to raw RGBA
    const { data: rgbaData, info: rgbaInfo } = await sharp(resized)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const rawImage = {
      data: rgbaData,
      width: rgbaInfo.width,
      height: rgbaInfo.height,
    };

    // 7. Generate anaglyph
    const anaglyph = generateAnaglyphServer(
      rawImage,
      depthData,
      depthWidth,
      depthHeight,
      job.intensity,
      job.colorMode === "classic" ? "classic" : "dubois",
      job.fillOcclusion
    );

    // 8. Encode results to PNG
    const [anaglyphPng, depthPng, distanceMapPng] = await Promise.all([
      rawToPng(anaglyph),
      depthToPng(depthData, depthWidth, depthHeight),
      generateColorMap(depthData, depthWidth, depthHeight),
    ]);

    // 9. Upload to Supabase Storage
    const supabase = getSupabase();

    const [anaUpload, depthUpload, distUpload] = await Promise.all([
      supabase.storage
        .from("3d-images")
        .upload(`anaglyph/${jobId}-anaglyph.png`, anaglyphPng, {
          contentType: "image/png",
          upsert: true,
        }),
      supabase.storage
        .from("3d-images")
        .upload(`depth/${jobId}-depth.png`, depthPng, {
          contentType: "image/png",
          upsert: true,
        }),
      supabase.storage
        .from("3d-images")
        .upload(`distance/${jobId}-distance.png`, distanceMapPng, {
          contentType: "image/png",
          upsert: true,
        }),
    ]);

    if (anaUpload.error)
      throw new Error(`Anaglyph upload: ${anaUpload.error.message}`);
    if (depthUpload.error)
      throw new Error(`Depth upload: ${depthUpload.error.message}`);
    if (distUpload.error)
      throw new Error(`Distance map upload: ${distUpload.error.message}`);

    // 10. Get public URLs
    const anaglyphUrl = supabase.storage
      .from("3d-images")
      .getPublicUrl(`anaglyph/${jobId}-anaglyph.png`).data.publicUrl;

    const depthMapUrl = supabase.storage
      .from("3d-images")
      .getPublicUrl(`depth/${jobId}-depth.png`).data.publicUrl;

    const distanceMapUrl = supabase.storage
      .from("3d-images")
      .getPublicUrl(`distance/${jobId}-distance.png`).data.publicUrl;

    // 11. Update the job in the database
    const updatedJob = await prisma.image.update({
      where: { id: jobId },
      data: {
        anaglyphUrl,
        depthMapUrl,
        distanceMapUrl,
        status: "done",
      },
    });

    return NextResponse.json(updatedJob);
  } catch (err) {
    console.error(`[depth-reprocess] Failed for job ${jobId}:`, err);
    return NextResponse.json(
      { error: (err as Error).message || "Reprocessing failed" },
      { status: 500 }
    );
  }
}
