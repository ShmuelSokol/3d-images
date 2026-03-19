#!/usr/bin/env node
/**
 * Temporal Stereogram Generator
 *
 * Generates temporally-stable Magic Eye frames for video by using a FIXED
 * base random pattern across all frames. Only depth-driven displacement
 * changes between frames, so the dot pattern doesn't jump around.
 *
 * Resumable: saves each frame to disk immediately. On restart, skips
 * existing frames.
 *
 * Usage:
 *   node scripts/temporal-stereogram.js [--frames N] [--resume]
 *
 * Options:
 *   --frames N    Only process first N frames (default: all)
 *   --resume      Skip already-processed frames (default: true)
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// Config
const VIDEO_URL = "https://ushngszdltlctmqlwgot.supabase.co/storage/v1/object/public/3d-images/originals/1773859284614-demo-video.mp4";
const JOB_DIR = "/tmp/temporal-stereogram";
const FRAMES_DIR = path.join(JOB_DIR, "input-frames");
const DEPTH_DIR = path.join(JOB_DIR, "depth");
const OUT_DIR = path.join(JOB_DIR, "output-frames");
const BASE_PATTERN_FILE = path.join(JOB_DIR, "base-pattern.json");
const FPS = 15;

// Parse args
const args = process.argv.slice(2);
let maxFrames = Infinity;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--frames" && args[i + 1]) maxFrames = parseInt(args[i + 1]);
}

async function main() {
  // Create dirs
  [JOB_DIR, FRAMES_DIR, DEPTH_DIR, OUT_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));

  // Step 1: Download video if needed
  const videoPath = path.join(JOB_DIR, "input.mp4");
  if (!fs.existsSync(videoPath)) {
    console.log("[1/4] Downloading video...");
    execSync(`curl -sL "${VIDEO_URL}" -o "${videoPath}"`, { stdio: "inherit" });
  } else {
    console.log("[1/4] Video already downloaded");
  }

  // Step 2: Extract frames if needed
  const existingInputFrames = fs.readdirSync(FRAMES_DIR).filter(f => f.endsWith(".png")).length;
  if (existingInputFrames === 0) {
    console.log("[2/4] Extracting frames...");
    execSync(`ffmpeg -y -i "${videoPath}" -vf "fps=${FPS}" "${FRAMES_DIR}/frame-%04d.png"`, { stdio: "pipe" });
  }
  const totalFrames = fs.readdirSync(FRAMES_DIR).filter(f => f.endsWith(".png")).length;
  const framesToProcess = Math.min(totalFrames, maxFrames);
  console.log(`[2/4] ${totalFrames} frames extracted, processing ${framesToProcess}`);

  // Step 3: Load depth estimation model
  console.log("[3/4] Loading depth estimation model...");
  const { pipeline, RawImage: HfRawImage, env } = require("@huggingface/transformers");
  env.cacheDir = process.env.TRANSFORMERS_CACHE || process.env.HF_HOME || path.join(JOB_DIR, ".cache");
  const model = "onnx-community/depth-anything-v2-large";
  const estimator = await pipeline("depth-estimation", model, { device: "cpu" });
  console.log("[3/4] Model ready");

  // Step 4: Process frames
  console.log("[4/4] Processing frames with temporal coherence...");

  // Load or generate base pattern
  let basePattern = null;
  if (fs.existsSync(BASE_PATTERN_FILE)) {
    basePattern = JSON.parse(fs.readFileSync(BASE_PATTERN_FILE, "utf-8"));
    console.log("  Loaded existing base pattern");
  }

  const sharp = require("sharp");
  const startTime = Date.now();
  let processed = 0;

  for (let i = 1; i <= framesToProcess; i++) {
    const pad = String(i).padStart(4, "0");
    const outFile = path.join(OUT_DIR, `frame-${pad}.png`);

    // Skip if already done
    if (fs.existsSync(outFile)) {
      processed++;
      continue;
    }

    const frameStart = Date.now();
    const inputFile = path.join(FRAMES_DIR, `frame-${pad}.png`);

    // Read frame
    const inputBuf = fs.readFileSync(inputFile);
    const meta = await sharp(inputBuf).metadata();
    const w = meta.width;
    const h = meta.height;

    // Estimate depth
    const jpegBuf = await sharp(inputBuf).jpeg({ quality: 85 }).toBuffer();
    const blob = new Blob([jpegBuf], { type: "image/jpeg" });
    const hfImage = await HfRawImage.fromBlob(blob);
    const result = await estimator(hfImage);
    const depthTensor = result.predicted_depth ?? result.depth;
    const depthData = depthTensor.data;
    const depthW = depthTensor.dims[1];
    const depthH = depthTensor.dims[0];

    // Generate stereogram with temporal coherence
    const stereoResult = generateTemporalStereogram(
      depthData, depthW, depthH, w, h, basePattern
    );

    // Save base pattern from first frame
    if (!basePattern) {
      basePattern = stereoResult.basePattern;
      fs.writeFileSync(BASE_PATTERN_FILE, JSON.stringify(basePattern));
      console.log("  Saved base pattern for temporal coherence");
    }

    // Write output frame
    await sharp(stereoResult.data, { raw: { width: w, height: h, channels: 4 } })
      .png()
      .toFile(outFile);

    processed++;
    const elapsed = (Date.now() - startTime) / 1000;
    const perFrame = elapsed / processed;
    const remaining = Math.round((framesToProcess - i) * perFrame / 60);
    const frameSec = ((Date.now() - frameStart) / 1000).toFixed(1);
    console.log(`  Frame ${i}/${framesToProcess} (${frameSec}s) | ${processed} done | ~${remaining}min remaining`);
  }

  console.log(`\nDone! ${processed} frames in ${OUT_DIR}`);
  console.log(`To reassemble: ffmpeg -y -framerate ${FPS} -i "${OUT_DIR}/frame-%04d.png" -c:v libx264 -pix_fmt yuv420p -crf 28 -movflags +faststart "${JOB_DIR}/stereogram-temporal.mp4"`);
}

// --- Temporal Stereogram Algorithm ---
// Uses a fixed base pattern across all frames. Only depth displacement changes.

function sampleDepth(data, dW, dH, x, y, oW, oH) {
  const sx = (x / oW) * dW;
  const sy = (y / oH) * dH;
  const x0 = Math.floor(sx), y0 = Math.floor(sy);
  const x1 = Math.min(x0 + 1, dW - 1), y1 = Math.min(y0 + 1, dH - 1);
  const fx = sx - x0, fy = sy - y0;
  const tl = data[y0 * dW + x0], tr = data[y0 * dW + x1];
  const bl = data[y1 * dW + x0], br = data[y1 * dW + x1];
  return tl * (1 - fx) * (1 - fy) + tr * fx * (1 - fy) + bl * (1 - fx) * fy + br * fx * fy;
}

function generateTemporalStereogram(depthData, depthW, depthH, outW, outH, existingBasePattern) {
  // Normalize depth
  let minD = Infinity, maxD = -Infinity;
  for (let i = 0; i < depthData.length; i++) {
    if (depthData[i] < minD) minD = depthData[i];
    if (depthData[i] > maxD) maxD = depthData[i];
  }
  const rangeD = maxD - minD || 1;
  const normalized = new Float32Array(depthData.length);
  for (let i = 0; i < depthData.length; i++) {
    normalized[i] = (depthData[i] - minD) / rangeD;
  }

  const stripWidth = Math.round(outW / 7);
  const maxShift = Math.round(stripWidth * 0.35);

  // Base pattern: a full-width strip of random colors per row
  // FIXED across all frames for temporal stability
  let basePattern = existingBasePattern;
  if (!basePattern) {
    let seed = 42;
    function rand() {
      seed = (seed * 1664525 + 1013904223) & 0xffffffff;
      return (seed >>> 0) / 0xffffffff;
    }
    // Generate a repeating random strip pattern for each row
    basePattern = [];
    for (let y = 0; y < outH; y++) {
      const row = [];
      for (let x = 0; x < stripWidth; x++) {
        row.push([Math.floor(rand() * 256), Math.floor(rand() * 256), Math.floor(rand() * 256)]);
      }
      basePattern.push(row);
    }
  }

  const out = Buffer.alloc(outW * outH * 4);

  for (let y = 0; y < outH; y++) {
    const strip = basePattern[y];

    // Build link array based on depth
    const same = new Int32Array(outW);
    for (let x = 0; x < outW; x++) same[x] = x;

    for (let x = 0; x < outW; x++) {
      const d = sampleDepth(normalized, depthW, depthH, x, y, outW, outH);
      const sep = stripWidth - Math.round(d * maxShift);
      const left = Math.round(x - sep / 2);
      const right = left + sep;
      if (left >= 0 && right < outW) {
        let l = left, r = right;
        while (same[l] !== l) l = same[l];
        while (same[r] !== r) r = same[r];
        if (l !== r) {
          if (l < r) same[r] = l;
          else same[l] = r;
        }
      }
    }

    // Resolve chains
    for (let x = 0; x < outW; x++) {
      let root = x;
      while (same[root] !== root) root = same[root];
      same[x] = root;
    }

    // Assign colors from the FIXED base pattern (not random per frame)
    // The root of each link chain determines the color via the base strip
    for (let x = 0; x < outW; x++) {
      const root = same[x];
      // Use the base pattern at the root's position within the strip
      const c = strip[root % stripWidth];
      const idx = (y * outW + x) * 4;
      out[idx] = c[0];
      out[idx + 1] = c[1];
      out[idx + 2] = c[2];
      out[idx + 3] = 255;
    }
  }

  return { data: out, width: outW, height: outH, basePattern };
}

// Handle SIGTERM/SIGINT gracefully — frames already saved to disk
process.on("SIGTERM", () => { console.log("\nSIGTERM received, exiting (frames saved to disk)"); process.exit(0); });
process.on("SIGINT", () => { console.log("\nInterrupted, exiting (frames saved to disk)"); process.exit(0); });

main().catch(e => { console.error(e); process.exit(1); });
