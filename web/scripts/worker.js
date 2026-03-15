/**
 * Worker child process for job processing.
 * Forked by the job queue so heavy processing doesn't block the main server.
 *
 * Usage: Receives { jobId } message, processes it, then exits.
 */

// Set up module aliases to match Next.js standalone paths
const path = require("path");

// In standalone mode, server chunks are at .next/server/chunks/
// We need to load the actual processing modules
async function main() {
  // Dynamic imports to load the processing pipeline
  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();

  process.on("message", async (msg) => {
    const jobId = msg.jobId;
    try {
      const job = await prisma.image.findUnique({ where: { id: jobId } });
      if (!job || job.status !== "processing") {
        process.exit(0);
        return;
      }

      // Dynamically import heavy modules
      const sharp = require("sharp");
      const { pipeline, RawImage, env } = require("@huggingface/transformers");

      env.cacheDir = process.env.TRANSFORMERS_CACHE || process.env.HF_HOME || "/tmp/.cache";

      const { createClient } = require("@supabase/supabase-js");
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
      );

      const MODELS = {
        fast: "onnx-community/depth-anything-v2-small",
        hd: "onnx-community/depth-anything-v2-large",
      };
      const model = MODELS.hd;

      // --- Depth estimator ---
      let estimator = null;
      async function estimateDepth(imageBuffer) {
        if (!estimator) {
          console.log(`[worker] Loading model: ${model}`);
          estimator = await pipeline("depth-estimation", model, { device: "cpu" });
          console.log(`[worker] Model ready: ${model}`);
        }
        const { data: pixels, info } = await sharp(imageBuffer)
          .removeAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        const img = new RawImage(new Uint8ClampedArray(pixels), info.width, info.height, 3);
        const raw = await estimator(img);
        const r = Array.isArray(raw) ? raw[0] : raw;
        const src = r.predicted_depth.data;
        const out = new Float32Array(src.length);
        out.set(src);
        return { data: out, width: r.predicted_depth.dims[1], height: r.predicted_depth.dims[0] };
      }

      if (job.mediaType === "video") {
        // Video processing — import server-video logic inline
        const { execSync } = require("child_process");
        const { mkdirSync, rmSync, readdirSync, readFileSync, writeFileSync } = require("fs");
        const { join } = require("path");

        const TMP_DIR = "/tmp/3d-jobs";
        const jobDir = join(TMP_DIR, jobId);
        const framesDir = join(jobDir, "frames");
        const outDir = join(jobDir, "out");
        const inputPath = join(jobDir, "input");
        const outputPath = join(jobDir, "output.mp4");

        try {
          mkdirSync(framesDir, { recursive: true });
          mkdirSync(outDir, { recursive: true });

          // Download
          console.log(`[worker] Downloading video: ${job.originalUrl}`);
          const res = await fetch(job.originalUrl);
          if (!res.ok) throw new Error(`Download failed: ${res.status}`);
          const buf = Buffer.from(await res.arrayBuffer());
          writeFileSync(inputPath, buf);

          // Probe
          const probeJson = execSync(`ffprobe -v quiet -print_format json -show_streams "${inputPath}"`, { encoding: "utf-8" });
          const probe = JSON.parse(probeJson);
          const videoStream = probe.streams.find(s => s.codec_type === "video");
          if (!videoStream) throw new Error("No video stream");

          const duration = Math.min(parseFloat(videoStream.duration || "60"), 60);
          const fps = 15;
          const totalFrames = Math.ceil(duration * fps);

          await prisma.image.update({ where: { id: jobId }, data: { frameCount: totalFrames, duration } });

          // Extract frames
          console.log(`[worker] Extracting ${totalFrames} frames`);
          execSync(`ffmpeg -y -i "${inputPath}" -t ${duration} -vf "fps=${fps},scale='min(720,iw)':'min(720,ih)':force_original_aspect_ratio=decrease,pad=ceil(iw/2)*2:ceil(ih/2)*2" -q:v 2 "${framesDir}/frame-%04d.jpg"`, { stdio: "pipe" });

          const frameFiles = readdirSync(framesDir).sort();
          console.log(`[worker] Processing ${frameFiles.length} frames`);

          for (let i = 0; i < frameFiles.length; i++) {
            if (i % 3 === 0) {
              const check = await prisma.image.findUnique({ where: { id: jobId }, select: { status: true } });
              if (check?.status === "cancelled") throw new Error("Job cancelled by user");
            }

            const framePath = join(framesDir, frameFiles[i]);
            const frameBuffer = Buffer.from(readFileSync(framePath));
            const depth = await estimateDepth(frameBuffer);

            const { data: rawData, info: rawInfo } = await sharp(frameBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
            const rawImg = { data: rawData, width: rawInfo.width, height: rawInfo.height };

            const anaglyph = generateAnaglyphServer(rawImg, depth.data, depth.width, depth.height, job.intensity, job.colorMode === "classic" ? "classic" : "dubois", job.fillOcclusion);
            const outPath = join(outDir, `frame-${String(i + 1).padStart(4, "0")}.png`);
            const pngBuf = await sharp(anaglyph.data, { raw: { width: anaglyph.width, height: anaglyph.height, channels: 4 } }).png().toBuffer();
            writeFileSync(outPath, pngBuf);

            if (i % 5 === 0 || i === frameFiles.length - 1) {
              await prisma.image.update({ where: { id: jobId }, data: { framesDone: i + 1 } });
            }
          }

          // Reassemble
          console.log(`[worker] Reassembling video`);
          execSync(`ffmpeg -y -framerate ${fps} -i "${outDir}/frame-%04d.png" -c:v libx264 -pix_fmt yuv420p -crf 23 -movflags +faststart "${outputPath}"`, { stdio: "pipe" });

          const resultBuf = readFileSync(outputPath);
          const storagePath = `videos/${jobId}-anaglyph.mp4`;
          const { error: uploadError } = await supabase.storage.from("3d-images").upload(storagePath, resultBuf, { contentType: "video/mp4", upsert: true });
          if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);
          const { data: { publicUrl: videoUrl } } = supabase.storage.from("3d-images").getPublicUrl(storagePath);

          await prisma.image.update({ where: { id: jobId }, data: { status: "done", videoUrl, framesDone: totalFrames } });
          console.log(`[worker] Video done: ${jobId}`);
        } finally {
          try { rmSync(jobDir, { recursive: true, force: true }); } catch {}
        }
      } else {
        // Image processing
        console.log(`[worker] Processing image: ${jobId}`);
        const res = await fetch(job.originalUrl);
        if (!res.ok) throw new Error(`Download failed: ${res.status}`);
        const inputBuffer = Buffer.from(await res.arrayBuffer());

        const rotated = Buffer.from(await sharp(inputBuffer).rotate().toBuffer());
        const meta = await sharp(rotated).metadata();
        let w = meta.width || 0;
        let h = meta.height || 0;
        const maxDim = 1024;
        let resized = rotated;
        if (w > maxDim || h > maxDim) {
          const s = maxDim / Math.max(w, h);
          w = Math.round(w * s);
          h = Math.round(h * s);
          resized = Buffer.from(await sharp(rotated).resize(w, h).jpeg({ quality: 85 }).toBuffer());
        }
        const jpegBuf = Buffer.from(await sharp(resized).jpeg({ quality: 85 }).toBuffer());

        const depth = await estimateDepth(jpegBuf);
        const { data: rawData, info: rawInfo } = await sharp(resized).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const rawImg = { data: rawData, width: rawInfo.width, height: rawInfo.height };

        const anaglyph = generateAnaglyphServer(rawImg, depth.data, depth.width, depth.height, job.intensity, job.colorMode === "classic" ? "classic" : "dubois", job.fillOcclusion);

        const [anaglyphPng, depthPng, colorMapPng] = await Promise.all([
          sharp(anaglyph.data, { raw: { width: anaglyph.width, height: anaglyph.height, channels: 4 } }).png().toBuffer(),
          depthToPng(depth.data, depth.width, depth.height),
          generateColorMap(depth.data, depth.width, depth.height),
        ]);

        const [anaUpload, depthUpload, distUpload] = await Promise.all([
          supabase.storage.from("3d-images").upload(`anaglyph/${jobId}-anaglyph.png`, anaglyphPng, { contentType: "image/png", upsert: true }),
          supabase.storage.from("3d-images").upload(`depth/${jobId}-depth.png`, depthPng, { contentType: "image/png", upsert: true }),
          supabase.storage.from("3d-images").upload(`distance/${jobId}-distance.png`, colorMapPng, { contentType: "image/png", upsert: true }),
        ]);

        if (anaUpload.error) throw new Error(`Anaglyph upload: ${anaUpload.error.message}`);
        if (depthUpload.error) throw new Error(`Depth upload: ${depthUpload.error.message}`);
        if (distUpload.error) throw new Error(`Color map upload: ${distUpload.error.message}`);

        const anaglyphUrl = supabase.storage.from("3d-images").getPublicUrl(`anaglyph/${jobId}-anaglyph.png`).data.publicUrl;
        const depthMapUrl = supabase.storage.from("3d-images").getPublicUrl(`depth/${jobId}-depth.png`).data.publicUrl;
        const distanceMapUrl = supabase.storage.from("3d-images").getPublicUrl(`distance/${jobId}-distance.png`).data.publicUrl;

        await prisma.image.update({
          where: { id: jobId },
          data: { anaglyphUrl, depthMapUrl, distanceMapUrl, width: w, height: h, status: "done" },
        });
        console.log(`[worker] Image done: ${jobId}`);
      }
    } catch (err) {
      const msg = err.message || "Processing failed";
      if (msg === "Job cancelled by user") {
        console.log(`[worker] Cancelled: ${jobId}`);
      } else {
        console.error(`[worker] Failed: ${jobId}`, err);
        await prisma.image.update({ where: { id: jobId }, data: { status: "error", error: msg } }).catch(() => {});
      }
    } finally {
      await prisma.$disconnect();
      process.exit(0);
    }
  });

  if (process.send) process.send({ ready: true });
}

// --- Inline anaglyph functions (to avoid import issues in standalone) ---

function blurDepth(depth, w, h, radius) {
  const out = new Float32Array(depth.length);
  const tmp = new Float32Array(depth.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0, weight = 0;
      for (let dx = -radius; dx <= radius; dx++) {
        const sx = Math.min(Math.max(x + dx, 0), w - 1);
        const g = Math.exp(-(dx * dx) / (2 * (radius * 0.5) * (radius * 0.5)));
        sum += depth[y * w + sx] * g;
        weight += g;
      }
      tmp[y * w + x] = sum / weight;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0, weight = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        const sy = Math.min(Math.max(y + dy, 0), h - 1);
        const g = Math.exp(-(dy * dy) / (2 * (radius * 0.5) * (radius * 0.5)));
        sum += tmp[sy * w + x] * g;
        weight += g;
      }
      out[y * w + x] = sum / weight;
    }
  }
  return out;
}

function sampleBilinear(pixels, width, height, x, y, channel) {
  const x0 = Math.floor(x), x1 = Math.min(x0 + 1, width - 1);
  const y0 = Math.floor(y), y1 = Math.min(y0 + 1, height - 1);
  const fx = x - x0, fy = y - y0;
  return pixels[(y0 * width + x0) * 4 + channel] * (1 - fx) * (1 - fy) +
         pixels[(y0 * width + x1) * 4 + channel] * fx * (1 - fy) +
         pixels[(y1 * width + x0) * 4 + channel] * (1 - fx) * fy +
         pixels[(y1 * width + x1) * 4 + channel] * fx * fy;
}

function sampleDepth(smoothed, dw, dh, ix, iy, iw, ih) {
  const dxf = (ix / iw) * (dw - 1), dyf = (iy / ih) * (dh - 1);
  const dx0 = Math.floor(dxf), dx1 = Math.min(dx0 + 1, dw - 1);
  const dy0 = Math.floor(dyf), dy1 = Math.min(dy0 + 1, dh - 1);
  const fx = dxf - dx0, fy = dyf - dy0;
  return smoothed[dy0 * dw + dx0] * (1 - fx) * (1 - fy) +
         smoothed[dy0 * dw + dx1] * fx * (1 - fy) +
         smoothed[dy1 * dw + dx0] * (1 - fx) * fy +
         smoothed[dy1 * dw + dx1] * fx * fy;
}

function fillOcclusions(out, width, height, shiftMap) {
  for (let y = 0; y < height; y++) {
    let lastValidR = 0, lastValidG = 0, lastValidB = 0;
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const shift = shiftMap[y * width + x];
      if (x + shift <= 0.5) { out[idx] = lastValidR; } else { lastValidR = out[idx]; }
      if (x - shift <= 0.5) { out[idx + 1] = lastValidG; out[idx + 2] = lastValidB; } else { lastValidG = out[idx + 1]; lastValidB = out[idx + 2]; }
    }
    lastValidR = 0; lastValidG = 0; lastValidB = 0;
    for (let x = width - 1; x >= 0; x--) {
      const idx = (y * width + x) * 4;
      const shift = shiftMap[y * width + x];
      if (x + shift >= width - 1.5) { out[idx] = lastValidR; } else { lastValidR = out[idx]; }
      if (x - shift >= width - 1.5) { out[idx + 1] = lastValidG; out[idx + 2] = lastValidB; } else { lastValidG = out[idx + 1]; lastValidB = out[idx + 2]; }
    }
  }
}

function generateAnaglyphServer(image, depthData, depthWidth, depthHeight, intensity, colorMode, doFillOcclusion) {
  const { data: pixels, width, height } = image;
  const out = Buffer.alloc(width * height * 4);
  const shiftMap = new Float32Array(width * height);

  let minD = Infinity, maxD = -Infinity;
  for (let i = 0; i < depthData.length; i++) {
    if (depthData[i] < minD) minD = depthData[i];
    if (depthData[i] > maxD) maxD = depthData[i];
  }
  const rangeD = maxD - minD || 1;
  const normalized = new Float32Array(depthData.length);
  for (let i = 0; i < depthData.length; i++) normalized[i] = (depthData[i] - minD) / rangeD;

  const blurRadius = Math.max(2, Math.round(Math.min(depthWidth, depthHeight) / 150));
  const smoothed = blurDepth(normalized, depthWidth, depthHeight, blurRadius);

  const duboisL = [0.4561, 0.500484, 0.176381, -0.0434706, -0.0879388, -0.00155529, -0.0152159, -0.0205971, -0.00546856];
  const duboisR = [-0.0434706, -0.0879388, -0.00155529, 0.378476, 0.73364, -0.0184503, -0.0721527, -0.112961, 1.2264];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const d = sampleDepth(smoothed, depthWidth, depthHeight, x, y, width, height);
      const shift = d * intensity;
      shiftMap[y * width + x] = shift;
      const leftX = Math.min(Math.max(x - shift, 0), width - 1);
      const rightX = Math.min(Math.max(x + shift, 0), width - 1);
      const outIdx = (y * width + x) * 4;
      const lR = sampleBilinear(pixels, width, height, leftX, y, 0) / 255;
      const lG = sampleBilinear(pixels, width, height, leftX, y, 1) / 255;
      const lB = sampleBilinear(pixels, width, height, leftX, y, 2) / 255;
      const rR = sampleBilinear(pixels, width, height, rightX, y, 0) / 255;
      const rG = sampleBilinear(pixels, width, height, rightX, y, 1) / 255;
      const rB = sampleBilinear(pixels, width, height, rightX, y, 2) / 255;
      if (colorMode === "dubois") {
        const oR = duboisL[0]*lR + duboisL[1]*lG + duboisL[2]*lB + duboisR[0]*rR + duboisR[1]*rG + duboisR[2]*rB;
        const oG = duboisL[3]*lR + duboisL[4]*lG + duboisL[5]*lB + duboisR[3]*rR + duboisR[4]*rG + duboisR[5]*rB;
        const oB = duboisL[6]*lR + duboisL[7]*lG + duboisL[8]*lB + duboisR[6]*rR + duboisR[7]*rG + duboisR[8]*rB;
        out[outIdx] = Math.round(Math.min(Math.max(oR, 0), 1) * 255);
        out[outIdx + 1] = Math.round(Math.min(Math.max(oG, 0), 1) * 255);
        out[outIdx + 2] = Math.round(Math.min(Math.max(oB, 0), 1) * 255);
      } else {
        out[outIdx] = Math.round(lR * 255);
        out[outIdx + 1] = Math.round(rG * 255);
        out[outIdx + 2] = Math.round(rB * 255);
      }
      out[outIdx + 3] = 255;
    }
  }
  if (doFillOcclusion) fillOcclusions(out, width, height, shiftMap);
  return { data: out, width, height };
}

async function depthToPng(depthData, width, height) {
  const sharp = require("sharp");
  const buf = Buffer.alloc(width * height);
  let minD = Infinity, maxD = -Infinity;
  for (let i = 0; i < depthData.length; i++) {
    if (depthData[i] < minD) minD = depthData[i];
    if (depthData[i] > maxD) maxD = depthData[i];
  }
  const rangeD = maxD - minD || 1;
  for (let i = 0; i < depthData.length; i++) buf[i] = Math.round(((depthData[i] - minD) / rangeD) * 255);
  return sharp(buf, { raw: { width, height, channels: 1 } }).png().toBuffer();
}

async function generateColorMap(depthData, width, height) {
  const sharp = require("sharp");
  let minD = Infinity, maxD = -Infinity;
  for (let i = 0; i < depthData.length; i++) {
    if (depthData[i] < minD) minD = depthData[i];
    if (depthData[i] > maxD) maxD = depthData[i];
  }
  const rangeD = maxD - minD || 1;
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const d = (depthData[i] - minD) / rangeD;
    let r, g, b;
    if (d < 0.25) { const t = d / 0.25; r = 0; g = Math.round(t * 255); b = 255; }
    else if (d < 0.5) { const t = (d - 0.25) / 0.25; r = 0; g = 255; b = Math.round((1 - t) * 255); }
    else if (d < 0.75) { const t = (d - 0.5) / 0.25; r = Math.round(t * 255); g = 255; b = 0; }
    else { const t = (d - 0.75) / 0.25; r = 255; g = Math.round((1 - t) * 255); b = 0; }
    rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b; rgba[i * 4 + 3] = 255;
  }
  return sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

main().catch((err) => {
  console.error("[worker] Fatal:", err);
  process.exit(1);
});
