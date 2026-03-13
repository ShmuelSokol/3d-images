import sharp from "sharp";
import { prisma } from "./prisma";
import { getSupabase } from "./supabase";
import { estimateDepth } from "./depth-estimator";
import {
  generateAnaglyphServer,
  decodeToRaw,
  rawToPng,
  depthToPng,
} from "./server-anaglyph";
import { processVideoJob } from "./server-video";



const MODELS: Record<string, string> = {
  fast: "Xenova/depth-anything-v2-small-hf",
  hd: "Xenova/depth-anything-v2-base-hf",
};

async function processImageJob(
  jobId: string,
  originalUrl: string,
  intensity: number,
  quality: string
): Promise<void> {
  const model = MODELS[quality] || MODELS.hd;

  // Download original image
  console.log(`[job] Processing image: ${jobId}`);
  const res = await fetch(originalUrl);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const inputBuffer = Buffer.from(await res.arrayBuffer());

  // Resize if needed (max 1024px)
  const meta = await sharp(inputBuffer).metadata();
  let w = meta.width || 0;
  let h = meta.height || 0;
  const maxDim = 1024;
  let resized: Buffer = inputBuffer;
  if (w > maxDim || h > maxDim) {
    const s = maxDim / Math.max(w, h);
    w = Math.round(w * s);
    h = Math.round(h * s);
    resized = Buffer.from(await sharp(inputBuffer).resize(w, h).jpeg({ quality: 85 }).toBuffer());
  }

  // Convert to JPEG buffer for depth estimation
  const jpegBuf = Buffer.from(await sharp(resized).jpeg({ quality: 85 }).toBuffer());

  // Depth estimation
  const depth = await estimateDepth(jpegBuf, model);

  // Decode to raw RGBA for anaglyph
  const raw = await decodeToRaw(resized);

  // Generate anaglyph
  const anaglyph = generateAnaglyphServer(
    raw,
    depth.data,
    depth.width,
    depth.height,
    intensity
  );

  // Encode results
  const [anaglyphPng, depthPng] = await Promise.all([
    rawToPng(anaglyph),
    depthToPng(depth.data, depth.width, depth.height),
  ]);

  // Upload to Supabase
  const supabase = getSupabase();

  const [anaUpload, depthUpload] = await Promise.all([
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
  ]);

  if (anaUpload.error) throw new Error(`Anaglyph upload: ${anaUpload.error.message}`);
  if (depthUpload.error) throw new Error(`Depth upload: ${depthUpload.error.message}`);

  const anaglyphUrl = supabase.storage
    .from("3d-images")
    .getPublicUrl(`anaglyph/${jobId}-anaglyph.png`).data.publicUrl;

  const depthMapUrl = supabase.storage
    .from("3d-images")
    .getPublicUrl(`depth/${jobId}-depth.png`).data.publicUrl;

  // Update DB
  await prisma.image.update({
    where: { id: jobId },
    data: {
      anaglyphUrl,
      depthMapUrl,
      width: w,
      height: h,
      status: "done",
    },
  });

  console.log(`[job] Image done: ${jobId}`);
}

/**
 * Process a single job (image or video).
 */
export async function processJob(jobId: string): Promise<void> {
  const job = await prisma.image.findUnique({ where: { id: jobId } });
  if (!job || job.status !== "processing") return;

  try {
    if (job.mediaType === "video") {
      const { videoUrl } = await processVideoJob(
        jobId,
        job.originalUrl,
        job.intensity,
        MODELS.hd
      );
      await prisma.image.update({
        where: { id: jobId },
        data: { status: "done", videoUrl, framesDone: job.frameCount || 0 },
      });
      console.log(`[job] Video done: ${jobId}`);
    } else {
      await processImageJob(jobId, job.originalUrl, job.intensity, "hd");
    }
  } catch (err) {
    console.error(`[job] Failed: ${jobId}`, err);
    await prisma.image.update({
      where: { id: jobId },
      data: {
        status: "error",
        error: (err as Error).message || "Processing failed",
      },
    });
  }
}
