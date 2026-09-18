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

  // ---- One-time setup ----
  // This all used to live inside the per-message handler, and the process
  // exited after a single job — so every job paid the full model load (and,
  // with no persistent cache volume, sometimes a full re-download). The worker
  // now stays alive and reuses the loaded model across jobs.
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
      // fp16 rather than the default fp32: roughly half the download and half
      // the load time, for a depth map that is smoothed and normalised anyway.
      const MODEL_DTYPE = "fp16";

      // --- Depth estimator ---
      // Cached per model: a warm worker may see both standard and HD jobs, and
      // reloading on every switch would undo the point of staying alive.
      const estimators = new Map();
      async function getEstimator(modelName) {
        if (!estimators.has(modelName)) {
          console.log(`[worker] Loading model: ${modelName}`);
          estimators.set(
            modelName,
            await pipeline("depth-estimation", modelName, { device: "cpu", dtype: MODEL_DTYPE })
          );
          console.log(`[worker] Model ready: ${modelName}`);
        }
        return estimators.get(modelName);
      }

      async function estimateDepth(imageBuffer, modelName = MODELS.fast) {
        const estimator = await getEstimator(modelName);
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


  // Handle SIGTERM — finish the current frame, save progress, then exit.
  // `busy` matters now that the worker is long-lived: it used to exit after
  // every job, so it was never sitting idle when a shutdown arrived. An idle
  // worker must exit immediately, or it outlives the parent as an orphan still
  // holding the depth model in memory.
  let shutdownRequested = false;
  let busy = false;
  process.on("SIGTERM", async () => {
    shutdownRequested = true;
    if (!busy) {
      console.log("[worker] SIGTERM received while idle, exiting");
      await prisma.$disconnect().catch(() => {});
      process.exit(0);
    }
    console.log("[worker] SIGTERM received, will exit after current job");
  });

  process.on("message", async (msg) => {
    const jobId = msg.jobId;
    busy = true;
    try {
      const job = await prisma.image.findUnique({ where: { id: jobId } });
      if (!job || job.status !== "processing") {
        // The finally block reports completion — sending here too would emit a
        // duplicate "done" for the same job.
        return;
      }

      if (job.mediaType === "video") {
        // Video processing — import server-video logic inline
        const { execSync } = require("child_process");
        const { mkdirSync, rmSync, readdirSync, readFileSync, writeFileSync, existsSync } = require("fs");
        const { join } = require("path");

        const TMP_DIR = "/tmp/3d-jobs";
        const jobDir = join(TMP_DIR, jobId);
        const framesDir = join(jobDir, "frames");
        const outAnaglyph = join(jobDir, "out-anaglyph");
        const outStereo = join(jobDir, "out-stereo");
        const outSbs = join(jobDir, "out-sbs");
        const inputPath = join(jobDir, "input");
        const anaglyphPath = join(jobDir, "output-anaglyph.mp4");
        const stereoPath = join(jobDir, "output-stereo.mp4");
        const sbsPath = join(jobDir, "output-sbs.mp4");

        const FRAME_PREFIX = `frames/${jobId}`;
        const resumeFrom = job.framesDone || 0;
        const selectedFormats = (job.formats || "anaglyph,stereogram,sbs").split(",");
        const doAnaglyph = selectedFormats.includes("anaglyph");
        const doStereo = selectedFormats.includes("stereogram");
        const doSbs = selectedFormats.includes("sbs");
        console.log(`[worker] Selected formats: ${selectedFormats.join(", ")}`);

        try {
          mkdirSync(framesDir, { recursive: true });
          mkdirSync(outAnaglyph, { recursive: true });
          mkdirSync(outStereo, { recursive: true });
          mkdirSync(outSbs, { recursive: true });

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
          console.log(`[worker] Processing ${frameFiles.length} frames (resuming from frame ${resumeFrom})`);

          // Resume: download already-processed frames from Supabase
          if (resumeFrom > 0) {
            console.log(`[worker] Downloading ${resumeFrom} previously processed frames from Supabase...`);
            for (let i = 0; i < resumeFrom; i++) {
              const pad = String(i + 1).padStart(4, "0");
              try {
                const downloads = [];
                if (doAnaglyph) downloads.push({ key: "anaglyph", dir: outAnaglyph, remote: `${FRAME_PREFIX}/anaglyph-${pad}.png` });
                if (doStereo) downloads.push({ key: "stereo", dir: outStereo, remote: `${FRAME_PREFIX}/stereo-${pad}.png` });
                if (doSbs) downloads.push({ key: "sbs", dir: outSbs, remote: `${FRAME_PREFIX}/sbs-${pad}.png` });

                const results = await Promise.all(downloads.map(d => supabase.storage.from("3d-images").download(d.remote)));
                let failed = false;
                for (let r = 0; r < results.length; r++) {
                  if (results[r].error) { failed = true; break; }
                  writeFileSync(join(downloads[r].dir, `frame-${pad}.png`), Buffer.from(await results[r].data.arrayBuffer()));
                }
                if (failed) {
                  console.error(`[worker] Missing resume frame ${i + 1}, reprocessing from here`);
                  await prisma.image.update({ where: { id: jobId }, data: { framesDone: i } });
                  break;
                }
              } catch (dlErr) {
                console.error(`[worker] Error downloading resume frame ${i + 1}:`, dlErr.message);
                await prisma.image.update({ where: { id: jobId }, data: { framesDone: i } });
                break;
              }
            }
            console.log(`[worker] Resume frames downloaded, continuing from frame ${resumeFrom}`);
          }

          // Get frame dimensions
          const firstFrame = Buffer.from(readFileSync(join(framesDir, frameFiles[0])));
          const { info: firstInfo } = await sharp(firstFrame).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
          const frameW = firstInfo.width;
          const frameH = firstInfo.height;

          // Get actual resume point (may have been adjusted if downloads failed)
          const actualResume = (await prisma.image.findUnique({ where: { id: jobId }, select: { framesDone: true } }))?.framesDone || 0;

          // For temporal stereogram: fixed base pattern across all frames
          let stereoBasePattern = null;

          for (let i = actualResume; i < frameFiles.length; i++) {
            // Check for shutdown request between frames
            if (shutdownRequested) {
              console.log(`[worker] Shutdown requested, saving progress at frame ${i}`);
              await prisma.image.update({ where: { id: jobId }, data: { framesDone: i } });
              process.exit(0);
              return;
            }

            if (i % 3 === 0) {
              const check = await prisma.image.findUnique({ where: { id: jobId }, select: { status: true } });
              if (check?.status === "cancelled") throw new Error("Job cancelled by user");
            }

            const framePath = join(framesDir, frameFiles[i]);
            const frameBuffer = Buffer.from(readFileSync(framePath));
            // Per frame, so model speed dominates completely: at ~6.5s a frame
            // the large model would take over an hour for a 60s clip.
            const depth = await estimateDepth(frameBuffer, MODELS.fast);

            const { data: rawData, info: rawInfo } = await sharp(frameBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
            const rawImg = { data: rawData, width: rawInfo.width, height: rawInfo.height };

            // Generate selected formats only
            const pad = String(i + 1).padStart(4, "0");
            const backupUploads = [];

            if (doAnaglyph) {
              const anaglyph = generateAnaglyphServer(rawImg, depth.data, depth.width, depth.height, job.intensity, job.colorMode === "classic" ? "classic" : "dubois", job.fillOcclusion);
              const anaPng = await sharp(anaglyph.data, { raw: { width: anaglyph.width, height: anaglyph.height, channels: 4 } }).png().toBuffer();
              writeFileSync(join(outAnaglyph, `frame-${pad}.png`), anaPng);
              backupUploads.push(supabase.storage.from("3d-images").upload(`${FRAME_PREFIX}/anaglyph-${pad}.png`, anaPng, { contentType: "image/png", upsert: true }));
            }
            if (doStereo) {
              const stereoResult = generateTemporalStereogram(depth.data, depth.width, depth.height, frameW, frameH, stereoBasePattern);
              if (!stereoBasePattern) stereoBasePattern = stereoResult.basePattern;
              const sterPng = await sharp(stereoResult.data, { raw: { width: stereoResult.width, height: stereoResult.height, channels: 4 } }).png().toBuffer();
              writeFileSync(join(outStereo, `frame-${pad}.png`), sterPng);
              backupUploads.push(supabase.storage.from("3d-images").upload(`${FRAME_PREFIX}/stereo-${pad}.png`, sterPng, { contentType: "image/png", upsert: true }));
            }
            if (doSbs) {
              const sbs = generateSideBySide(rawImg, depth.data, depth.width, depth.height, job.intensity);
              const sbsPng = await sharp(sbs.data, { raw: { width: sbs.width, height: sbs.height, channels: 4 } }).png().toBuffer();
              writeFileSync(join(outSbs, `frame-${pad}.png`), sbsPng);
              backupUploads.push(supabase.storage.from("3d-images").upload(`${FRAME_PREFIX}/sbs-${pad}.png`, sbsPng, { contentType: "image/png", upsert: true }));
            }

            // Upload frames to Supabase for resume capability (fire-and-forget)
            Promise.all(backupUploads).catch(err => console.error(`[worker] Frame ${i + 1} backup upload failed:`, err.message));

            if (i % 5 === 0 || i === frameFiles.length - 1) {
              await prisma.image.update({ where: { id: jobId }, data: { framesDone: i + 1 } });
            }
          }

          // Reassemble selected videos
          const formatCount = [doAnaglyph, doStereo, doSbs].filter(Boolean).length;
          console.log(`[worker] Reassembling ${formatCount} video(s)`);
          const ffmpegCmd = (inDir, outPath, crf = 23, extraFlags = "") => `ffmpeg -y -framerate ${fps} -i "${inDir}/frame-%04d.png" -i "${inputPath}" -map 0:v -map 1:a? -c:v libx264 -c:a aac -pix_fmt yuv420p -crf ${crf} ${extraFlags} -shortest -movflags +faststart "${outPath}"`;
          if (doAnaglyph) execSync(ffmpegCmd(outAnaglyph, anaglyphPath, 23), { stdio: "pipe" });
          // Stereogram patterns are high-entropy noise — CRF 31 keeps quality while staying under 50MB Supabase upload limit
          if (doStereo) execSync(ffmpegCmd(outStereo, stereoPath, 31), { stdio: "pipe" });
          if (doSbs) execSync(ffmpegCmd(outSbs, sbsPath, 23), { stdio: "pipe" });

          // Upload selected videos — don't fail the whole job if one upload fails
          const uploadList = [];
          if (doAnaglyph) uploadList.push({ local: anaglyphPath, remote: `videos/${jobId}-anaglyph.mp4`, field: "videoUrl" });
          if (doStereo) uploadList.push({ local: stereoPath, remote: `videos/${jobId}-stereogram.mp4`, field: "stereogramUrl" });
          if (doSbs) uploadList.push({ local: sbsPath, remote: `videos/${jobId}-sbs.mp4`, field: "sbsUrl" });
          const updateData = { status: "done", framesDone: totalFrames };
          for (const u of uploadList) {
            try {
              const buf = readFileSync(u.local);
              console.log(`[worker] Uploading ${u.remote} (${(buf.length / 1024 / 1024).toFixed(1)}MB)`);
              const { error } = await supabase.storage.from("3d-images").upload(u.remote, buf, { contentType: "video/mp4", upsert: true });
              if (error) { console.error(`[worker] Upload failed (${u.remote}): ${error.message}`); continue; }
              updateData[u.field] = supabase.storage.from("3d-images").getPublicUrl(u.remote).data.publicUrl;
            } catch (uploadErr) {
              console.error(`[worker] Upload error (${u.remote}):`, uploadErr.message);
            }
          }

          if (!updateData.videoUrl && !updateData.stereogramUrl && !updateData.sbsUrl) {
            throw new Error("All 3 video uploads failed");
          }

          await prisma.image.update({ where: { id: jobId }, data: updateData });
          console.log(`[worker] Video done: ${jobId}`);

          // Clean up: local temp files
          try { rmSync(jobDir, { recursive: true, force: true }); } catch {}

          // Clean up: intermediate frames from Supabase
          try {
            const { data: storedFrames } = await supabase.storage.from("3d-images").list(FRAME_PREFIX);
            if (storedFrames && storedFrames.length > 0) {
              // Supabase remove takes max 100 at a time
              const paths = storedFrames.map(f => `${FRAME_PREFIX}/${f.name}`);
              for (let b = 0; b < paths.length; b += 100) {
                await supabase.storage.from("3d-images").remove(paths.slice(b, b + 100));
              }
              console.log(`[worker] Cleaned up ${paths.length} intermediate frames from Supabase`);
            }
          } catch (cleanErr) {
            console.error(`[worker] Frame cleanup from Supabase failed:`, cleanErr.message);
          }
        } catch (videoErr) {
          // On error, keep temp files for debugging — log the path
          console.error(`[worker] Video processing failed, temp files kept at: ${jobDir}`);
          throw videoErr;
        }
      } else {
        // Image processing
        console.log(`[worker] Processing image: ${jobId}`);
        const res = await fetch(job.originalUrl);
        if (!res.ok) throw new Error(`Download failed: ${res.status}`);
        const inputBuffer = Buffer.from(await res.arrayBuffer());

        // Shared with the depth editor — if the two disagree on the working
        // size, an edited depth map lines up against different pixels.
        const rotated = Buffer.from(await sharp(inputBuffer).rotate().toBuffer());
        const meta = await sharp(rotated).metadata();
        const { buffer: resized, width: w, height: h } = await toWorkingSize(inputBuffer);
        const jpegBuf = Buffer.from(await sharp(resized).jpeg({ quality: 85 }).toBuffer());

        // Depth always runs on the <=1024px copy — that's the model's working
        // resolution, more pixels wouldn't improve it.
        // The small model runs ~12x faster (0.97s vs 11.5s warm, measured) and
        // its depth map is near-identical here — and the renderer blurs the
        // depth before using it anyway, discarding most of the large model's
        // extra fidelity. HD jobs still get the large model.
        const depth = await estimateDepth(jpegBuf, job.hiRes ? MODELS.hd : MODELS.fast);

        // HD renders the 3D effect at the image's own resolution instead of the
        // 1024px working copy. The renderers sample depth by relative position,
        // so a small depth map drives a large image correctly.
        const HD_MAX_DIM = 3072;
        let renderSource = resized;
        if (job.hiRes) {
          const ow = meta.width || 0;
          const oh = meta.height || 0;
          const longest = Math.max(ow, oh);
          if (longest > HD_MAX_DIM) {
            const sc = HD_MAX_DIM / longest;
            renderSource = Buffer.from(
              await sharp(rotated).resize(Math.round(ow * sc), Math.round(oh * sc)).toBuffer()
            );
          } else {
            renderSource = rotated;
          }
          console.log(`[worker] HD render for ${jobId}`);
        }

        const { data: rawData, info: rawInfo } = await sharp(renderSource).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const rawImg = { data: rawData, width: rawInfo.width, height: rawInfo.height };
        const outW = rawInfo.width;
        const outH = rawInfo.height;

        const anaglyph = generateAnaglyphServer(rawImg, depth.data, depth.width, depth.height, job.intensity, job.colorMode === "classic" ? "classic" : "dubois", job.fillOcclusion);
        // Stereograms stay at the 1024px working size at any setting: their dot
        // separation is an absolute pixel distance, so a bigger canvas only
        // pushes it below what a viewer can fuse once the image is fitted to
        // their screen. Random dots have no detail to preserve either.
        const stereogram = generateAutostereogram(depth.data, depth.width, depth.height, w, h);
        const sbs = generateSideBySide(rawImg, depth.data, depth.width, depth.height, job.intensity);

        // Photographic outputs ship as JPEG. A PNG of a photo measured ~9x
        // larger for no visible gain, and that size is paid twice: once
        // uploading from the worker (slowing the job) and again by every
        // viewer. The anaglyph keeps 4:4:4 chroma because each eye lives in a
        // different colour channel — subsampling bleeds them into each other
        // and measurably doubles the red-channel error.
        const [anaglyphPng, depthPng, colorMapPng, stereogramPng, sbsPng] = await Promise.all([
          rawToJpeg(anaglyph, 92, "4:4:4"),
          depthToPng(depth.data, depth.width, depth.height),
          generateColorMap(depth.data, depth.width, depth.height),
          rawToPngBW(stereogram),
          rawToJpeg(sbs, 90),
        ]);

        const [anaUpload, depthUpload, distUpload, stereoUpload, sbsUpload] = await Promise.all([
          supabase.storage.from("3d-images").upload(`anaglyph/${jobId}-anaglyph.jpg`, anaglyphPng, { contentType: "image/jpeg", upsert: true }),
          supabase.storage.from("3d-images").upload(`depth/${jobId}-depth.png`, depthPng, { contentType: "image/png", upsert: true }),
          supabase.storage.from("3d-images").upload(`distance/${jobId}-distance.png`, colorMapPng, { contentType: "image/png", upsert: true }),
          supabase.storage.from("3d-images").upload(`stereogram/${jobId}-stereogram.png`, stereogramPng, { contentType: "image/png", upsert: true }),
          supabase.storage.from("3d-images").upload(`sbs/${jobId}-sbs.jpg`, sbsPng, { contentType: "image/jpeg", upsert: true }),
        ]);

        if (anaUpload.error) throw new Error(`Anaglyph upload: ${anaUpload.error.message}`);
        if (depthUpload.error) throw new Error(`Depth upload: ${depthUpload.error.message}`);
        if (distUpload.error) throw new Error(`Color map upload: ${distUpload.error.message}`);
        if (stereoUpload.error) throw new Error(`Stereogram upload: ${stereoUpload.error.message}`);
        if (sbsUpload.error) throw new Error(`SBS upload: ${sbsUpload.error.message}`);

        const anaglyphUrl = supabase.storage.from("3d-images").getPublicUrl(`anaglyph/${jobId}-anaglyph.jpg`).data.publicUrl;
        const depthMapUrl = supabase.storage.from("3d-images").getPublicUrl(`depth/${jobId}-depth.png`).data.publicUrl;
        const distanceMapUrl = supabase.storage.from("3d-images").getPublicUrl(`distance/${jobId}-distance.png`).data.publicUrl;
        const stereogramUrl = supabase.storage.from("3d-images").getPublicUrl(`stereogram/${jobId}-stereogram.png`).data.publicUrl;
        const sbsUrl = supabase.storage.from("3d-images").getPublicUrl(`sbs/${jobId}-sbs.jpg`).data.publicUrl;

        await prisma.image.update({
          where: { id: jobId },
          data: { anaglyphUrl, depthMapUrl, distanceMapUrl, stereogramUrl, sbsUrl, width: outW, height: outH, status: "done" },
        });
        console.log(`[worker] Image done: ${jobId}`);

        // Record how long it took, so the UI shows a real duration rather than
        // an open-ended spinner.
        if (job.startedAt) {
          await prisma.image
            .update({
              where: { id: jobId },
              data: { processingMs: Date.now() - new Date(job.startedAt).getTime() },
            })
            .catch(() => {});
        }
      }
    } catch (err) {
      const msg = err.message || "Processing failed";
      if (msg === "Job cancelled by user") {
        console.log(`[worker] Cancelled: ${jobId}`);
      } else {
        console.error(`[worker] Failed: ${jobId}`, err);
        await prisma.image.update({ where: { id: jobId }, data: { status: "error", error: msg } }).catch(() => {});

        // Refund the credit — a failed job must never cost the user anything.
        // Guarded by `refunded` so retry/reprocess can't mint credits: the job
        // was charged once at upload, so it can be refunded at most once.
        try {
          const failed = await prisma.image.findUnique({
            where: { id: jobId },
            select: { userId: true, refunded: true, hdCreditUsed: true },
          });
          if (failed && failed.userId && !failed.refunded) {
            const claimed = await prisma.image.updateMany({
              where: { id: jobId, refunded: false },
              data: { refunded: true },
            });
            if (claimed.count === 1) {
              await prisma.user.update({
                where: { id: failed.userId },
                data: {
                  imageCredits: { increment: 1 },
                  ...(failed.hdCreditUsed ? { hdCredits: { increment: 1 } } : {}),
                },
              });
              console.log(`[worker] Refunded 1 credit${failed.hdCreditUsed ? " + 1 HD export" : ""} to ${failed.userId}`);
            }
          }
        } catch (refundErr) {
          console.error(`[worker] Refund failed for ${jobId}:`, refundErr.message);
        }
      }
    } finally {
      busy = false;
      // Stay alive: the loaded model is the expensive part, and the queue sends
      // the next job to this same process. The parent kills us on shutdown.
      if (process.send) process.send({ done: true, jobId });
      if (shutdownRequested) {
        await prisma.$disconnect().catch(() => {});
        process.exit(0);
      }
    }
  });

  if (process.send) process.send({ ready: true });
}

// --- Render maths ---
// Compiled from src/lib/server-anaglyph.ts at build time (npm run build:render-lib).
// These used to be hand-copied into this file, which is how a fixed Magic Eye
// algorithm, and an HD render path, could sit in the TypeScript source while
// production quietly kept running the old duplicate. One source of truth now.
const {
  sampleDepth,
  generateAnaglyphServer,
  generateColorMap,
  depthToPng,
  rawToPng,
  rawToJpeg,
  rawToPngBW,
  generateAutostereogram,
  generateSideBySide,
  toWorkingSize,
} = require(path.join(__dirname, "lib", "server-anaglyph.js"));

function generateTemporalStereogram(depthData, dw, dh, outputWidth, outputHeight, existingBasePattern) {
  let minD = Infinity, maxD = -Infinity;
  for (let i = 0; i < depthData.length; i++) {
    if (depthData[i] < minD) minD = depthData[i];
    if (depthData[i] > maxD) maxD = depthData[i];
  }
  const rangeD = maxD - minD || 1;
  const normalized = new Float32Array(depthData.length);
  for (let i = 0; i < depthData.length; i++) normalized[i] = (depthData[i] - minD) / rangeD;

  // Same constants as the still-image stereogram: an absolute pixel separation
  // (~72px near to ~90px far), because it models the gap between the viewer's
  // pupils and must not scale with the frame size. Deriving it from the width
  // gave ~183px on a 720p frame — wider than anyone can diverge.
  const EYE_SEP = 180;
  const MU = 1 / 3;
  const sepFor = (z) => Math.round(((1 - MU * z) * EYE_SEP) / (2 - MU * z));
  const FAR_SEP = sepFor(0);

  // The base pattern is what keeps successive frames coherent — without it the
  // dots re-randomise every frame and the video boils. Black and white, for the
  // same reason as the still version: colour noise fuses badly.
  let basePattern = existingBasePattern;
  if (!basePattern) {
    let seed = 42;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) & 0xffffffff;
      return (seed >>> 0) / 0x100000000;
    };
    basePattern = [];
    for (let y = 0; y < outputHeight; y++) {
      const row = new Uint8Array(FAR_SEP);
      for (let x = 0; x < FAR_SEP; x++) row[x] = rand() < 0.5 ? 0 : 255;
      basePattern.push(row);
    }
  }

  const out = Buffer.alloc(outputWidth * outputHeight * 4);
  const same = new Int32Array(outputWidth);
  const zRow = new Float32Array(outputWidth);
  const pix = new Uint8Array(outputWidth);

  for (let y = 0; y < outputHeight; y++) {
    const rowPattern = basePattern[y] || basePattern[basePattern.length - 1];
    for (let x = 0; x < outputWidth; x++) {
      zRow[x] = sampleDepth(normalized, dw, dh, x, y, outputWidth, outputHeight);
      same[x] = x;
    }

    for (let x = 0; x < outputWidth; x++) {
      const z = zRow[x];
      const sp = sepFor(z);
      let left = x - ((sp + (sp & 1)) >> 1);
      let right = left + sp;
      if (left < 0 || right >= outputWidth) continue;

      // Hidden-surface check — without it, points behind a nearer surface still
      // get linked and shape edges smear.
      let visible = true;
      let zt = 0;
      let t = 1;
      do {
        zt = z + (2 * (2 - MU * z) * t) / (MU * EYE_SEP);
        const li = x - t;
        const ri = x + t;
        visible = (li < 0 || zRow[li] < zt) && (ri >= outputWidth || zRow[ri] < zt);
        t++;
      } while (visible && zt < 1);
      if (!visible) continue;

      let k = same[left];
      while (k !== left && k !== right) {
        if (k < right) {
          left = k;
          k = same[left];
        } else {
          same[left] = right;
          left = right;
          right = k;
          k = same[left];
        }
      }
      same[left] = right;
    }

    // Right to left so each pixel's partner is already decided. Unconstrained
    // pixels take their value from the stable base pattern rather than fresh
    // randomness, which is what holds the image still between frames.
    for (let x = outputWidth - 1; x >= 0; x--) {
      pix[x] = same[x] === x ? rowPattern[x % rowPattern.length] : pix[same[x]];
      const idx = (y * outputWidth + x) * 4;
      out[idx] = pix[x];
      out[idx + 1] = pix[x];
      out[idx + 2] = pix[x];
      out[idx + 3] = 255;
    }
  }

  // Shape must match what the video loop destructures: .data/.width/.height
  // plus the basePattern it threads into the next frame.
  return { data: out, width: outputWidth, height: outputHeight, basePattern };
}

main().catch((err) => {
  console.error("[worker] Fatal:", err);
  process.exit(1);
});
