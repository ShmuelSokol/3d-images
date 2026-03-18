import sharp from "sharp";
import { prisma } from "./prisma";
import { getSupabase } from "./supabase";
import { estimateDepth } from "./depth-estimator";
import {
  generateAnaglyphServer,
  generateColorMap,
  generateAutostereogram,
  generateSideBySide,
  decodeToRaw,
  rawToPng,
  depthToPng,
} from "./server-anaglyph";
import { processVideoJob } from "./server-video";



const MODELS: Record<string, string> = {
  fast: "onnx-community/depth-anything-v2-small",
  hd: "onnx-community/depth-anything-v2-large",
};

async function processImageJob(
  jobId: string,
  originalUrl: string,
  intensity: number,
  quality: string,
  colorMode: string,
  fillOcclusion: boolean
): Promise<void> {
  const model = MODELS[quality] || MODELS.hd;

  // Download original image
  console.log(`[job] Processing image: ${jobId}`);
  const res = await fetch(originalUrl);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const inputBuffer = Buffer.from(await res.arrayBuffer());

  // Auto-rotate based on EXIF orientation, then resize if needed
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
    resized = Buffer.from(await sharp(rotated).resize(w, h).jpeg({ quality: 85 }).toBuffer());
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
    intensity,
    (colorMode === "classic" ? "classic" : "dubois"),
    fillOcclusion
  );

  // Generate additional formats
  const stereogram = generateAutostereogram(depth.data, depth.width, depth.height, w, h);
  const sbs = generateSideBySide(raw, depth.data, depth.width, depth.height, intensity);

  // Encode results
  const [anaglyphPng, depthPng, distanceMapPng, stereogramPng, sbsPng] = await Promise.all([
    rawToPng(anaglyph),
    depthToPng(depth.data, depth.width, depth.height),
    generateColorMap(depth.data, depth.width, depth.height),
    rawToPng(stereogram),
    rawToPng(sbs),
  ]);

  // Upload to Supabase
  const supabase = getSupabase();

  const [anaUpload, depthUpload, distUpload, stereoUpload, sbsUpload] = await Promise.all([
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
    supabase.storage
      .from("3d-images")
      .upload(`stereogram/${jobId}-stereogram.png`, stereogramPng, {
        contentType: "image/png",
        upsert: true,
      }),
    supabase.storage
      .from("3d-images")
      .upload(`sbs/${jobId}-sbs.png`, sbsPng, {
        contentType: "image/png",
        upsert: true,
      }),
  ]);

  if (anaUpload.error) throw new Error(`Anaglyph upload: ${anaUpload.error.message}`);
  if (depthUpload.error) throw new Error(`Depth upload: ${depthUpload.error.message}`);
  if (distUpload.error) throw new Error(`Distance map upload: ${distUpload.error.message}`);
  if (stereoUpload.error) throw new Error(`Stereogram upload: ${stereoUpload.error.message}`);
  if (sbsUpload.error) throw new Error(`SBS upload: ${sbsUpload.error.message}`);

  const anaglyphUrl = supabase.storage
    .from("3d-images")
    .getPublicUrl(`anaglyph/${jobId}-anaglyph.png`).data.publicUrl;

  const depthMapUrl = supabase.storage
    .from("3d-images")
    .getPublicUrl(`depth/${jobId}-depth.png`).data.publicUrl;

  const distanceMapUrl = supabase.storage
    .from("3d-images")
    .getPublicUrl(`distance/${jobId}-distance.png`).data.publicUrl;

  const stereogramUrl = supabase.storage
    .from("3d-images")
    .getPublicUrl(`stereogram/${jobId}-stereogram.png`).data.publicUrl;

  const sbsUrl = supabase.storage
    .from("3d-images")
    .getPublicUrl(`sbs/${jobId}-sbs.png`).data.publicUrl;

  // Update DB
  await prisma.image.update({
    where: { id: jobId },
    data: {
      anaglyphUrl,
      depthMapUrl,
      distanceMapUrl,
      stereogramUrl,
      sbsUrl,
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
      const { videoUrl, stereogramUrl, sbsUrl } = await processVideoJob(
        jobId,
        job.originalUrl,
        job.intensity,
        MODELS.hd,
        job.colorMode,
        job.fillOcclusion
      );
      await prisma.image.update({
        where: { id: jobId },
        data: { status: "done", videoUrl, stereogramUrl, sbsUrl, framesDone: job.frameCount || 0 },
      });
      console.log(`[job] Video done: ${jobId}`);
    } else {
      await processImageJob(jobId, job.originalUrl, job.intensity, "hd", job.colorMode, job.fillOcclusion);
    }
  } catch (err) {
    const msg = (err as Error).message || "Processing failed";
    if (msg === "Job cancelled by user") {
      console.log(`[job] Cancelled: ${jobId}`);
    } else {
      console.error(`[job] Failed: ${jobId}`, err);
      await prisma.image.update({
        where: { id: jobId },
        data: {
          status: "error",
          error: msg,
        },
      });
    }
  }
}
