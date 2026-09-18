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
  rawToJpeg,
  depthToPng,
} from "./server-anaglyph";
import { processVideoJob } from "./server-video";



const MODELS: Record<string, string> = {
  fast: "onnx-community/depth-anything-v2-small",
  hd: "onnx-community/depth-anything-v2-large",
};

/**
 * Ceiling for HD rendering. The render loops are O(pixels) and the side-by-side
 * output is twice this wide, so raising this costs time and memory sharply.
 *
 * Measured peak RSS for the render stage alone (source + one output at a time,
 * mozjpeg encode): ~544MB at 4096px, ~330MB at 3072px. On top of that sits the
 * depth model (~335MB) plus the ONNX runtime and Node baseline, so 4096 lands
 * near 1GB and risks an OOM-kill that would take down the whole queue — jobs
 * run one at a time. 3072 keeps the total comfortably clear. Raise this only
 * alongside more container memory.
 */
const HD_MAX_DIM = 3072;

async function processImageJob(
  jobId: string,
  originalUrl: string,
  intensity: number,
  quality: string,
  colorMode: string,
  fillOcclusion: boolean,
  hiRes = false
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

  // Depth estimation always runs on the <=1024px copy — that's the model's
  // working resolution, and more pixels wouldn't make it better.
  const depth = await estimateDepth(jpegBuf, model);

  // HD output renders the 3D effect at the image's own resolution instead of
  // the 1024px working copy. The renderers sample depth by relative position
  // (see sampleDepth in server-anaglyph), so a small depth map drives a large
  // image correctly: depth is low-frequency, so scaling it up costs almost
  // nothing visually while the output keeps the original's real detail.
  let renderSource: Buffer = resized;
  if (hiRes) {
    const ow = meta.width || 0;
    const oh = meta.height || 0;
    const longest = Math.max(ow, oh);
    if (longest > HD_MAX_DIM) {
      const s = HD_MAX_DIM / longest;
      renderSource = Buffer.from(
        await sharp(rotated).resize(Math.round(ow * s), Math.round(oh * s)).toBuffer()
      );
    } else {
      renderSource = rotated;
    }
  }

  // Decode to raw RGBA for anaglyph
  const raw = await decodeToRaw(renderSource);
  const outW = raw.width;
  const outH = raw.height;

  // At HD the three large outputs go out as JPEG — a 4096px PNG runs to tens of
  // megabytes, and the side-by-side one (double width) can exceed the storage
  // object-size limit outright.
  const ext = hiRes ? "jpg" : "png";
  const contentType = hiRes ? "image/jpeg" : "image/png";
  const encodeMain = (img: Parameters<typeof rawToPng>[0]) =>
    hiRes ? rawToJpeg(img) : rawToPng(img);

  // Generate and encode one output at a time, letting each raw RGBA buffer go
  // out of scope before the next is allocated. This matters at HD: these
  // buffers are 4 bytes per pixel and the side-by-side one is double width, so
  // holding all three at 4096px would be ~250MB of pixels alive at once on top
  // of the source. Block scoping keeps the peak at roughly one output plus the
  // source, not the sum of all three. (Node Buffers are off-heap, so this is
  // about container RSS, not --max-old-space-size.)
  let anaglyphPng: Buffer;
  {
    const anaglyph = generateAnaglyphServer(
      raw,
      depth.data,
      depth.width,
      depth.height,
      intensity,
      (colorMode === "classic" ? "classic" : "dubois"),
      fillOcclusion
    );
    anaglyphPng = await encodeMain(anaglyph);
  }

  let stereogramPng: Buffer;
  {
    // Deliberately NOT rendered at HD. A random-dot stereogram carries no
    // image detail to preserve, and its dot separation is an absolute pixel
    // distance: enlarging the canvas just means that when the viewer fits the
    // image to their screen, the separation scales below what they can fuse.
    // The 1024px working size keeps it viewable at 100% zoom.
    const stereogram = generateAutostereogram(depth.data, depth.width, depth.height, w, h);
    stereogramPng = await encodeMain(stereogram);
  }

  let sbsPng: Buffer;
  {
    const sbs = generateSideBySide(raw, depth.data, depth.width, depth.height, intensity);
    sbsPng = await encodeMain(sbs);
  }

  const depthPng = await depthToPng(depth.data, depth.width, depth.height);
  const distanceMapPng = await generateColorMap(depth.data, depth.width, depth.height);

  // Upload to Supabase
  const supabase = getSupabase();

  const [anaUpload, depthUpload, distUpload, stereoUpload, sbsUpload] = await Promise.all([
    supabase.storage
      .from("3d-images")
      .upload(`anaglyph/${jobId}-anaglyph.${ext}`, anaglyphPng, {
        contentType,
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
      .upload(`stereogram/${jobId}-stereogram.${ext}`, stereogramPng, {
        contentType,
        upsert: true,
      }),
    supabase.storage
      .from("3d-images")
      .upload(`sbs/${jobId}-sbs.${ext}`, sbsPng, {
        contentType,
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
    .getPublicUrl(`anaglyph/${jobId}-anaglyph.${ext}`).data.publicUrl;

  const depthMapUrl = supabase.storage
    .from("3d-images")
    .getPublicUrl(`depth/${jobId}-depth.png`).data.publicUrl;

  const distanceMapUrl = supabase.storage
    .from("3d-images")
    .getPublicUrl(`distance/${jobId}-distance.png`).data.publicUrl;

  const stereogramUrl = supabase.storage
    .from("3d-images")
    .getPublicUrl(`stereogram/${jobId}-stereogram.${ext}`).data.publicUrl;

  const sbsUrl = supabase.storage
    .from("3d-images")
    .getPublicUrl(`sbs/${jobId}-sbs.${ext}`).data.publicUrl;

  // Update DB
  await prisma.image.update({
    where: { id: jobId },
    data: {
      anaglyphUrl,
      depthMapUrl,
      distanceMapUrl,
      stereogramUrl,
      sbsUrl,
      width: outW,
      height: outH,
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
      // `hiRes` persists on the row, so re-check entitlement at processing
      // time — otherwise someone who was Pro at upload keeps getting HD
      // renders from retry/reprocess long after their subscription lapsed.
      // A job that spent a granted HD export stays entitled either way: it
      // was already paid for.
      // Only a customer account needs re-checking: a subscription can lapse
      // between upload and render. A job with no userId that still carries
      // hiRes can only have come from an admin — the upload route rejects HD
      // for anonymous callers outright — so it stays entitled. (Processing has
      // no request context, so isAdmin() isn't available here; this relies on
      // that invariant in src/app/api/jobs/route.ts.)
      let renderHiRes = job.hiRes;
      if (renderHiRes && !job.hdCreditUsed && job.userId) {
        const owner = await prisma.user.findUnique({
          where: { id: job.userId },
          select: { plan: true },
        });
        renderHiRes = owner?.plan === "pro";
      }

      await processImageJob(
        jobId,
        job.originalUrl,
        job.intensity,
        "hd",
        job.colorMode,
        job.fillOcclusion,
        renderHiRes
      );
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
      // Refund the credit — a failed job must never cost the user anything.
      // Guarded by `refunded` so retry/reprocess can't mint credits: the job
      // was charged once at upload, so it can be refunded at most once.
      if (job.userId && !job.refunded) {
        const claimed = await prisma.image.updateMany({
          where: { id: jobId, refunded: false },
          data: { refunded: true },
        });
        // updateMany reports 0 if another worker already claimed the refund.
        if (claimed.count === 1) {
          await prisma.user.update({
            where: { id: job.userId },
            data: {
              imageCredits: { increment: 1 },
              // A granted HD export is refunded too — same rule: a failed job
              // must never cost the user anything.
              ...(job.hdCreditUsed ? { hdCredits: { increment: 1 } } : {}),
            },
          });
          console.log(
            `[job] Refunded 1 credit${job.hdCreditUsed ? " + 1 HD export" : ""} to ${job.userId}`
          );
        }
      }
    }
  }
}
