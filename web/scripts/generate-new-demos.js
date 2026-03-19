#!/usr/bin/env node
/**
 * Generate Wiggle 3D + Color Stereogram demos for existing demo images.
 * Downloads each original, runs depth estimation, generates new outputs, uploads to Supabase.
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const DEMOS = [
  { id: "cmmukn84k0001100wlhq1jqy7", orig: "1773749482004-6vqotz14l2.jpeg" },
  { id: "cmmugaa000015hw68b9jx7jrq", orig: "1773742159582-4itnjyhj0w6.jpeg" },
  { id: "cmmugacm7001bhw68xb6mkz34", orig: "1773742163001-yjr1ihnh3g.jpeg" },
  { id: "cmmuga4w7000thw68kq8rvuy3", orig: "1773742152987-ok99or8nboi.jpeg" },
];

const BASE = "https://ushngszdltlctmqlwgot.supabase.co/storage/v1/object/public/3d-images";
const TMP = "/tmp/new-demos";

async function main() {
  fs.mkdirSync(TMP, { recursive: true });

  const sharp = require("sharp");
  const { pipeline, RawImage: HfRawImage, env } = require("@huggingface/transformers");
  env.cacheDir = process.env.TRANSFORMERS_CACHE || process.env.HF_HOME || path.join(TMP, ".cache");

  const { createClient } = require("@supabase/supabase-js");
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  console.log("Loading depth model...");
  const estimator = await pipeline("depth-estimation", "onnx-community/depth-anything-v2-large", { device: "cpu" });
  console.log("Model ready\n");

  for (const demo of DEMOS) {
    console.log(`Processing ${demo.id}...`);

    // Download original
    const origPath = path.join(TMP, `${demo.id}-orig.jpeg`);
    if (!fs.existsSync(origPath)) {
      execSync(`curl -sL "${BASE}/originals/${demo.orig}" -o "${origPath}"`);
    }

    // Check if outputs already exist in Supabase
    const wigglePath = `wiggle/${demo.id}-wiggle.mp4`;
    const colorStereoPath = `color-stereo/${demo.id}-color-stereo.png`;
    const { data: existingWiggle } = supabase.storage.from("3d-images").getPublicUrl(wigglePath);

    // Read & prepare image
    const inputBuf = fs.readFileSync(origPath);
    const rotated = await sharp(inputBuf).rotate().toBuffer();
    const meta = await sharp(rotated).metadata();
    let w = meta.width, h = meta.height;
    const maxDim = 1024;
    let resized = rotated;
    if (w > maxDim || h > maxDim) {
      const s = maxDim / Math.max(w, h);
      w = Math.round(w * s);
      h = Math.round(h * s);
      resized = await sharp(rotated).resize(w, h).jpeg({ quality: 85 }).toBuffer();
    }

    // Depth estimation
    const jpegBuf = await sharp(resized).jpeg({ quality: 85 }).toBuffer();
    const blob = new Blob([jpegBuf], { type: "image/jpeg" });
    const hfImage = await HfRawImage.fromBlob(blob);
    const result = await estimator(hfImage);
    const depthTensor = result.predicted_depth ?? result.depth;
    const depthData = depthTensor.data;
    const depthW = depthTensor.dims[1];
    const depthH = depthTensor.dims[0];

    // Get raw RGBA
    const { data: rawData, info: rawInfo } = await sharp(resized).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const rawImg = { data: rawData, width: rawInfo.width, height: rawInfo.height };

    // --- Wiggle 3D ---
    console.log("  Generating Wiggle 3D...");
    const wiggle = generateWiggle3DLocal(rawImg, depthData, depthW, depthH);

    const leftPng = path.join(TMP, `${demo.id}-left.png`);
    const rightPng = path.join(TMP, `${demo.id}-right.png`);
    const wiggleMp4 = path.join(TMP, `${demo.id}-wiggle.mp4`);

    await sharp(wiggle.left.data, { raw: { width: w, height: h, channels: 4 } }).png().toFile(leftPng);
    await sharp(wiggle.right.data, { raw: { width: w, height: h, channels: 4 } }).png().toFile(rightPng);

    // Create looping MP4: left→right→left→right at 6fps (166ms per frame)
    // Use concat with multiple repetitions for smooth loop
    const concatFile = path.join(TMP, `${demo.id}-concat.txt`);
    fs.writeFileSync(concatFile, `file '${leftPng}'\nduration 0.15\nfile '${rightPng}'\nduration 0.15\nfile '${leftPng}'\n`);
    execSync(`ffmpeg -y -f concat -safe 0 -i "${concatFile}" -vf "loop=150:1:0" -t 10 -c:v libx264 -pix_fmt yuv420p -crf 18 -movflags +faststart "${wiggleMp4}"`, { stdio: "pipe" });

    // Upload wiggle
    const wiggleBuf = fs.readFileSync(wiggleMp4);
    console.log(`  Uploading wiggle (${(wiggleBuf.length/1024/1024).toFixed(1)}MB)...`);
    const { error: wErr } = await supabase.storage.from("3d-images").upload(wigglePath, wiggleBuf, { contentType: "video/mp4", upsert: true });
    if (wErr) console.error("  Wiggle upload error:", wErr.message);
    else console.log("  Wiggle uploaded");

    // --- Color Stereogram ---
    console.log("  Generating Color Stereogram...");
    const colorStereo = generateColorStereogramLocal(rawImg, depthData, depthW, depthH);
    const colorStereoPng = await sharp(colorStereo.data, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();

    console.log(`  Uploading color stereogram (${(colorStereoPng.length/1024).toFixed(0)}KB)...`);
    const { error: csErr } = await supabase.storage.from("3d-images").upload(colorStereoPath, colorStereoPng, { contentType: "image/png", upsert: true });
    if (csErr) console.error("  Color stereo upload error:", csErr.message);
    else console.log("  Color stereogram uploaded");

    console.log(`  Done: ${demo.id}\n`);
  }

  console.log("All demos generated!");
  console.log("\nURLs:");
  for (const demo of DEMOS) {
    const wiggleUrl = supabase.storage.from("3d-images").getPublicUrl(`wiggle/${demo.id}-wiggle.mp4`).data.publicUrl;
    const csUrl = supabase.storage.from("3d-images").getPublicUrl(`color-stereo/${demo.id}-color-stereo.png`).data.publicUrl;
    console.log(`  ${demo.id}:`);
    console.log(`    Wiggle: ${wiggleUrl}`);
    console.log(`    Color Stereo: ${csUrl}`);
  }
}

// --- Inline implementations (can't import TS directly) ---

function sampleDepthLocal(data, dW, dH, x, y, oW, oH) {
  const sx = (x / oW) * (dW - 1);
  const sy = (y / oH) * (dH - 1);
  const x0 = Math.floor(sx), y0 = Math.floor(sy);
  const x1 = Math.min(x0 + 1, dW - 1), y1 = Math.min(y0 + 1, dH - 1);
  const fx = sx - x0, fy = sy - y0;
  return data[y0 * dW + x0] * (1-fx)*(1-fy) + data[y0 * dW + x1] * fx*(1-fy) + data[y1 * dW + x0] * (1-fx)*fy + data[y1 * dW + x1] * fx*fy;
}

function sampleBilinearLocal(pixels, w, h, x, y, ch) {
  const x0 = Math.floor(x), x1 = Math.min(x0+1, w-1);
  const y0 = Math.floor(y), y1 = Math.min(y0+1, h-1);
  const fx = x - x0, fy = y - y0;
  return pixels[(y0*w+x0)*4+ch]*(1-fx)*(1-fy) + pixels[(y0*w+x1)*4+ch]*fx*(1-fy) + pixels[(y1*w+x0)*4+ch]*(1-fx)*fy + pixels[(y1*w+x1)*4+ch]*fx*fy;
}

function blurDepthLocal(depth, w, h, radius) {
  const tmp = new Float32Array(depth.length);
  const out = new Float32Array(depth.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let sum = 0, weight = 0;
    for (let dx = -radius; dx <= radius; dx++) {
      const sx = Math.min(Math.max(x+dx, 0), w-1);
      const g = Math.exp(-(dx*dx)/(2*(radius*0.5)*(radius*0.5)));
      sum += depth[y*w+sx] * g; weight += g;
    }
    tmp[y*w+x] = sum / weight;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let sum = 0, weight = 0;
    for (let dy = -radius; dy <= radius; dy++) {
      const sy = Math.min(Math.max(y+dy, 0), h-1);
      const g = Math.exp(-(dy*dy)/(2*(radius*0.5)*(radius*0.5)));
      sum += tmp[sy*w+x] * g; weight += g;
    }
    out[y*w+x] = sum / weight;
  }
  return out;
}

function generateWiggle3DLocal(image, depthData, depthW, depthH, intensity = 6) {
  const { data: pixels, width, height } = image;
  let minD = Infinity, maxD = -Infinity;
  for (let i = 0; i < depthData.length; i++) { if (depthData[i] < minD) minD = depthData[i]; if (depthData[i] > maxD) maxD = depthData[i]; }
  const rangeD = maxD - minD || 1;
  const normalized = new Float32Array(depthData.length);
  for (let i = 0; i < depthData.length; i++) normalized[i] = (depthData[i] - minD) / rangeD;
  const blurRadius = Math.max(2, Math.round(Math.min(depthW, depthH) / 150));
  const smoothed = blurDepthLocal(normalized, depthW, depthH, blurRadius);
  const leftBuf = Buffer.alloc(width * height * 4);
  const rightBuf = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const d = sampleDepthLocal(smoothed, depthW, depthH, x, y, width, height);
    const shift = d * intensity;
    const idx = (y * width + x) * 4;
    const lx = Math.min(Math.max(x + shift, 0), width - 1);
    leftBuf[idx] = sampleBilinearLocal(pixels, width, height, lx, y, 0);
    leftBuf[idx+1] = sampleBilinearLocal(pixels, width, height, lx, y, 1);
    leftBuf[idx+2] = sampleBilinearLocal(pixels, width, height, lx, y, 2);
    leftBuf[idx+3] = 255;
    const rx = Math.min(Math.max(x - shift, 0), width - 1);
    rightBuf[idx] = sampleBilinearLocal(pixels, width, height, rx, y, 0);
    rightBuf[idx+1] = sampleBilinearLocal(pixels, width, height, rx, y, 1);
    rightBuf[idx+2] = sampleBilinearLocal(pixels, width, height, rx, y, 2);
    rightBuf[idx+3] = 255;
  }
  return { left: { data: leftBuf, width, height }, right: { data: rightBuf, width, height } };
}

function generateColorStereogramLocal(image, depthData, depthW, depthH) {
  const { data: pixels, width: outW, height: outH } = image;
  let minD = Infinity, maxD = -Infinity;
  for (let i = 0; i < depthData.length; i++) { if (depthData[i] < minD) minD = depthData[i]; if (depthData[i] > maxD) maxD = depthData[i]; }
  const rangeD = maxD - minD || 1;
  const normalized = new Float32Array(depthData.length);
  for (let i = 0; i < depthData.length; i++) normalized[i] = (depthData[i] - minD) / rangeD;
  const stripWidth = Math.round(outW / 7);
  const maxShift = Math.round(stripWidth * 0.35);
  const out = Buffer.alloc(outW * outH * 4);
  for (let y = 0; y < outH; y++) {
    const same = new Int32Array(outW);
    for (let x = 0; x < outW; x++) same[x] = x;
    for (let x = 0; x < outW; x++) {
      const d = sampleDepthLocal(normalized, depthW, depthH, x, y, outW, outH);
      const sep = stripWidth - Math.round(d * maxShift);
      const left = Math.round(x - sep / 2);
      const right = left + sep;
      if (left >= 0 && right < outW) {
        let l = left, r = right;
        while (same[l] !== l) l = same[l];
        while (same[r] !== r) r = same[r];
        if (l !== r) { if (l < r) same[r] = l; else same[l] = r; }
      }
    }
    for (let x = 0; x < outW; x++) { let root = x; while (same[root] !== root) root = same[root]; same[x] = root; }
    for (let x = 0; x < outW; x++) {
      const srcX = same[x] % outW;
      const srcIdx = (y * outW + srcX) * 4;
      const dstIdx = (y * outW + x) * 4;
      out[dstIdx] = pixels[srcIdx]; out[dstIdx+1] = pixels[srcIdx+1]; out[dstIdx+2] = pixels[srcIdx+2]; out[dstIdx+3] = 255;
    }
  }
  return { data: out, width: outW, height: outH };
}

main().catch(e => { console.error(e); process.exit(1); });
