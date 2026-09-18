import sharp from "sharp";

export interface RawImage {
  data: Buffer;
  width: number;
  height: number;
}

/**
 * Gaussian blur a depth map in-place for smoother 3D transitions.
 */
export function blurDepth(
  depth: Float32Array,
  w: number,
  h: number,
  radius: number
): Float32Array {
  const out = new Float32Array(depth.length);
  const tmp = new Float32Array(depth.length);

  // Horizontal pass
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

  // Vertical pass
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

/**
 * Bilinear interpolation for sub-pixel sampling.
 */
function sampleBilinear(
  pixels: Buffer,
  width: number,
  height: number,
  x: number,
  y: number,
  channel: number
): number {
  const x0 = Math.floor(x);
  const x1 = Math.min(x0 + 1, width - 1);
  const y0 = Math.floor(y);
  const y1 = Math.min(y0 + 1, height - 1);
  const fx = x - x0;
  const fy = y - y0;

  const c00 = pixels[(y0 * width + x0) * 4 + channel];
  const c10 = pixels[(y0 * width + x1) * 4 + channel];
  const c01 = pixels[(y1 * width + x0) * 4 + channel];
  const c11 = pixels[(y1 * width + x1) * 4 + channel];

  return (
    c00 * (1 - fx) * (1 - fy) +
    c10 * fx * (1 - fy) +
    c01 * (1 - fx) * fy +
    c11 * fx * fy
  );
}

/**
 * Sample a smoothed depth value at image coordinates.
 */
export function sampleDepth(
  smoothed: Float32Array,
  depthWidth: number,
  depthHeight: number,
  imgX: number,
  imgY: number,
  imgWidth: number,
  imgHeight: number
): number {
  const dxf = (imgX / imgWidth) * (depthWidth - 1);
  const dyf = (imgY / imgHeight) * (depthHeight - 1);
  const dx0 = Math.floor(dxf);
  const dx1 = Math.min(dx0 + 1, depthWidth - 1);
  const dy0 = Math.floor(dyf);
  const dy1 = Math.min(dy0 + 1, depthHeight - 1);
  const fx = dxf - dx0;
  const fy = dyf - dy0;
  return (
    smoothed[dy0 * depthWidth + dx0] * (1 - fx) * (1 - fy) +
    smoothed[dy0 * depthWidth + dx1] * fx * (1 - fy) +
    smoothed[dy1 * depthWidth + dx0] * (1 - fx) * fy +
    smoothed[dy1 * depthWidth + dx1] * fx * fy
  );
}

/**
 * Fill disoccluded (gap) pixels by scanning from the edges inward.
 * When a pixel was sampled from a clamped position, replace it with
 * the nearest valid neighbor on that side.
 */
function fillOcclusions(
  out: Buffer,
  width: number,
  height: number,
  shiftMap: Float32Array
): void {
  for (let y = 0; y < height; y++) {
    // Left-to-right pass: fill pixels where shift pushed source out of left edge
    let lastValidR = 0, lastValidG = 0, lastValidB = 0;
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const shift = shiftMap[y * width + x];
      if (x + shift <= 0.5) {
        // This pixel's red channel was clamped — fill from neighbor
        out[idx] = lastValidR;
      } else {
        lastValidR = out[idx];
      }
      if (x - shift <= 0.5) {
        out[idx + 1] = lastValidG;
        out[idx + 2] = lastValidB;
      } else {
        lastValidG = out[idx + 1];
        lastValidB = out[idx + 2];
      }
    }
    // Right-to-left pass: fill pixels where shift pushed source out of right edge
    lastValidR = 0; lastValidG = 0; lastValidB = 0;
    for (let x = width - 1; x >= 0; x--) {
      const idx = (y * width + x) * 4;
      const shift = shiftMap[y * width + x];
      if (x + shift >= width - 1.5) {
        out[idx] = lastValidR;
      } else {
        lastValidR = out[idx];
      }
      if (x - shift >= width - 1.5) {
        out[idx + 1] = lastValidG;
        out[idx + 2] = lastValidB;
      } else {
        lastValidG = out[idx + 1];
        lastValidB = out[idx + 2];
      }
    }
  }
}

export type ColorMode = "classic" | "dubois";

/**
 * Generate an anaglyph 3D image from raw RGBA pixels + depth map.
 * Supports classic red/cyan and Dubois optimized color modes.
 * Optionally fills disocclusion gaps.
 */
export function generateAnaglyphServer(
  image: RawImage,
  depthData: Float32Array,
  depthWidth: number,
  depthHeight: number,
  intensity: number = 10,
  colorMode: ColorMode = "dubois",
  doFillOcclusion: boolean = true
): RawImage {
  const { data: pixels, width, height } = image;
  const out = Buffer.alloc(width * height * 4);
  const shiftMap = new Float32Array(width * height);

  // Normalize depth to 0-1
  let minD = Infinity,
    maxD = -Infinity;
  for (let i = 0; i < depthData.length; i++) {
    if (depthData[i] < minD) minD = depthData[i];
    if (depthData[i] > maxD) maxD = depthData[i];
  }
  const rangeD = maxD - minD || 1;
  const normalized = new Float32Array(depthData.length);
  for (let i = 0; i < depthData.length; i++) {
    normalized[i] = (depthData[i] - minD) / rangeD;
  }

  // Smooth depth map to reduce noisy edges
  const blurRadius = Math.max(2, Math.round(Math.min(depthWidth, depthHeight) / 150));
  const smoothed = blurDepth(normalized, depthWidth, depthHeight, blurRadius);

  // Dubois optimized matrices (from Eric Dubois' 2001 paper)
  // Left eye (red channel contribution from RGB)
  const duboisL = [0.4561, 0.500484, 0.176381, -0.0434706, -0.0879388, -0.00155529, -0.0152159, -0.0205971, -0.00546856];
  // Right eye (cyan channel contribution from RGB)
  const duboisR = [-0.0434706, -0.0879388, -0.00155529, 0.378476, 0.73364, -0.0184503, -0.0721527, -0.112961, 1.2264];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const d = sampleDepth(smoothed, depthWidth, depthHeight, x, y, width, height);
      const shift = d * intensity;
      shiftMap[y * width + x] = shift;

      const leftX = Math.min(Math.max(x - shift, 0), width - 1);
      const rightX = Math.min(Math.max(x + shift, 0), width - 1);

      const outIdx = (y * width + x) * 4;

      // Sample left and right eye colors
      const lR = sampleBilinear(pixels, width, height, leftX, y, 0) / 255;
      const lG = sampleBilinear(pixels, width, height, leftX, y, 1) / 255;
      const lB = sampleBilinear(pixels, width, height, leftX, y, 2) / 255;
      const rR = sampleBilinear(pixels, width, height, rightX, y, 0) / 255;
      const rG = sampleBilinear(pixels, width, height, rightX, y, 1) / 255;
      const rB = sampleBilinear(pixels, width, height, rightX, y, 2) / 255;

      if (colorMode === "dubois") {
        // Dubois optimized anaglyph — preserves more color
        const oR = duboisL[0]*lR + duboisL[1]*lG + duboisL[2]*lB + duboisR[0]*rR + duboisR[1]*rG + duboisR[2]*rB;
        const oG = duboisL[3]*lR + duboisL[4]*lG + duboisL[5]*lB + duboisR[3]*rR + duboisR[4]*rG + duboisR[5]*rB;
        const oB = duboisL[6]*lR + duboisL[7]*lG + duboisL[8]*lB + duboisR[6]*rR + duboisR[7]*rG + duboisR[8]*rB;
        out[outIdx]     = Math.round(Math.min(Math.max(oR, 0), 1) * 255);
        out[outIdx + 1] = Math.round(Math.min(Math.max(oG, 0), 1) * 255);
        out[outIdx + 2] = Math.round(Math.min(Math.max(oB, 0), 1) * 255);
      } else {
        // Classic red/cyan
        out[outIdx]     = Math.round(lR * 255);
        out[outIdx + 1] = Math.round(rG * 255);
        out[outIdx + 2] = Math.round(rB * 255);
      }
      out[outIdx + 3] = 255;
    }
  }

  if (doFillOcclusion) {
    fillOcclusions(out, width, height, shiftMap);
  }

  return { data: out, width, height };
}

/**
 * Generate a color map: colorized depth visualization (blue=far, red=close).
 */
export async function generateColorMap(
  depthData: Float32Array,
  width: number,
  height: number
): Promise<Buffer> {
  // Normalize depth to 0-1
  let minD = Infinity, maxD = -Infinity;
  for (let i = 0; i < depthData.length; i++) {
    if (depthData[i] < minD) minD = depthData[i];
    if (depthData[i] > maxD) maxD = depthData[i];
  }
  const rangeD = maxD - minD || 1;

  // Create colorized depth map (blue=far, red=close)
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const d = (depthData[i] - minD) / rangeD; // 0=far, 1=close
    // Blue → Cyan → Green → Yellow → Red
    let r: number, g: number, b: number;
    if (d < 0.25) {
      const t = d / 0.25;
      r = 0; g = Math.round(t * 255); b = 255;
    } else if (d < 0.5) {
      const t = (d - 0.25) / 0.25;
      r = 0; g = 255; b = Math.round((1 - t) * 255);
    } else if (d < 0.75) {
      const t = (d - 0.5) / 0.25;
      r = Math.round(t * 255); g = 255; b = 0;
    } else {
      const t = (d - 0.75) / 0.25;
      r = 255; g = Math.round((1 - t) * 255); b = 0;
    }
    rgba[i * 4] = r;
    rgba[i * 4 + 1] = g;
    rgba[i * 4 + 2] = b;
    rgba[i * 4 + 3] = 255;
  }

  return sharp(rgba, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
}

/**
 * Render a depth map Float32Array as a grayscale PNG buffer.
 */
export async function depthToPng(
  depthData: Float32Array,
  width: number,
  height: number
): Promise<Buffer> {
  const buf = Buffer.alloc(width * height);
  let minD = Infinity,
    maxD = -Infinity;
  for (let i = 0; i < depthData.length; i++) {
    if (depthData[i] < minD) minD = depthData[i];
    if (depthData[i] > maxD) maxD = depthData[i];
  }
  const rangeD = maxD - minD || 1;
  for (let i = 0; i < depthData.length; i++) {
    buf[i] = Math.round(((depthData[i] - minD) / rangeD) * 255);
  }
  return sharp(buf, { raw: { width, height, channels: 1 } })
    .png()
    .toBuffer();
}

/**
 * Encode raw RGBA image to PNG buffer.
 */
export async function rawToPng(image: RawImage): Promise<Buffer> {
  return sharp(image.data, {
    raw: { width: image.width, height: image.height, channels: 4 },
  })
    .png()
    .toBuffer();
}

/**
 * The pipeline's working size. Depth estimation runs here regardless of output
 * resolution — it's the model's native scale, and more pixels don't improve it.
 */
export const WORKING_MAX_DIM = 1024;

/**
 * Auto-rotate by EXIF and shrink to the working size.
 *
 * Shared so the depth editor and the worker can't drift apart on what "the
 * image the depth map was computed from" means — if they disagree, edited depth
 * maps line up against the wrong pixels.
 */
export async function toWorkingSize(
  input: Buffer
): Promise<{ buffer: Buffer; width: number; height: number }> {
  const rotated = Buffer.from(await sharp(input).rotate().toBuffer());
  const meta = await sharp(rotated).metadata();
  let w = meta.width || 0;
  let h = meta.height || 0;
  if (w <= WORKING_MAX_DIM && h <= WORKING_MAX_DIM) {
    return { buffer: rotated, width: w, height: h };
  }
  const scale = WORKING_MAX_DIM / Math.max(w, h);
  w = Math.round(w * scale);
  h = Math.round(h * scale);
  const buffer = Buffer.from(
    await sharp(rotated).resize(w, h).jpeg({ quality: 85 }).toBuffer()
  );
  return { buffer, width: w, height: h };
}

/**
 * Encode raw RGBA to JPEG. Used for high-resolution output, where PNG would
 * be tens of megabytes and can exceed the storage object-size limit.
 */
export async function rawToJpeg(
  image: RawImage,
  quality = 92,
  chromaSubsampling = "4:2:0"
): Promise<Buffer> {
  return sharp(image.data, {
    raw: { width: image.width, height: image.height, channels: 4 },
  })
    // Deliberately NOT mozjpeg. Its trellis quantisation measured 23x slower
    // here (1837ms vs 81ms on a 3072x2304 frame) to save roughly 5% of file
    // size — and this runs inside the job queue, which processes one job at a
    // time, so every second is a second every other queued job waits.
    .jpeg({ quality, chromaSubsampling })
    .toBuffer();
}

/**
 * Encode a black-and-white image as a 2-colour palette PNG.
 *
 * For the autostereogram this is lossless *and* about five times smaller than
 * an RGB PNG (466KB -> 95KB measured). JPEG is not an option there: it is both
 * larger on dot noise and its ringing softens the dot edges, which is exactly
 * what the eye needs crisp in order to fuse the image.
 */
export async function rawToPngBW(image: RawImage): Promise<Buffer> {
  return sharp(image.data, {
    raw: { width: image.width, height: image.height, channels: 4 },
  })
    .png({ colors: 2, effort: 7 })
    .toBuffer();
}

/**
 * Decode an image buffer (JPEG/PNG/etc) to raw RGBA pixels.
 */
export async function decodeToRaw(
  input: Buffer
): Promise<RawImage> {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/**
 * Generate a Single Image Random Dot Stereogram (Magic Eye) from a depth map.
 */
export function generateAutostereogram(
  depthData: Float32Array,
  depthWidth: number,
  depthHeight: number,
  outputWidth: number,
  outputHeight: number
): RawImage {
  // Normalize depth (0 = far, 1 = close)
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
  // Light blur: hard depth steps produce constraint conflicts that read as noise.
  const blurRadius = Math.max(2, Math.round(Math.min(depthWidth, depthHeight) / 200));
  const smoothed = blurDepth(normalized, depthWidth, depthHeight, blurRadius);

  // Eye separation is an ABSOLUTE pixel distance — it models the gap between a
  // viewer's pupils, which does not grow just because the image is bigger.
  // (Deriving it from the image width gave a 439px separation on a 3072px
  // render: wider than anyone can diverge, so the image simply cannot fuse.)
  // ~2.5in at 72dpi. MU is the depth of field; together these put the
  // separation between about 72px (near) and 90px (far) — a ~20% swing, which
  // the eye can track. Much more than that and fusion breaks at depth edges.
  const EYE_SEP = 180;
  const MU = 1 / 3;
  const sepFor = (z: number) =>
    Math.round(((1 - MU * z) * EYE_SEP) / (2 - MU * z));

  const out = Buffer.alloc(outputWidth * outputHeight * 4);

  // Seeded so a re-run of the same job reproduces the same image.
  let seed = 42;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) & 0xffffffff;
    return (seed >>> 0) / 0x100000000;
  };

  const same = new Int32Array(outputWidth);
  const zRow = new Float32Array(outputWidth);
  const pix = new Uint8Array(outputWidth);

  for (let y = 0; y < outputHeight; y++) {
    for (let x = 0; x < outputWidth; x++) {
      zRow[x] = sampleDepth(smoothed, depthWidth, depthHeight, x, y, outputWidth, outputHeight);
      same[x] = x;
    }

    for (let x = 0; x < outputWidth; x++) {
      const z = zRow[x];
      const s = sepFor(z);
      let left = x - ((s + (s & 1)) >> 1);
      let right = left + s;
      if (left < 0 || right >= outputWidth) continue;

      // Hidden-surface removal (Thimbleby, Inglis & Witten 1994). Without this
      // check, a point occluded by a nearer surface still gets linked to its
      // partner, which smears the edges of shapes.
      let visible = true;
      let zt = 0;
      let t = 1;
      do {
        zt = z + (2 * (2 - MU * z) * t) / (MU * EYE_SEP);
        const li = x - t;
        const ri = x + t;
        visible =
          (li < 0 || zRow[li] < zt) && (ri >= outputWidth || zRow[ri] < zt);
        t++;
      } while (visible && zt < 1);
      if (!visible) continue;

      // Merge the two positions into one constraint class.
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

    // Right to left, so a pixel's partner is always already decided. Dots are
    // black or white: independent random RGB gives coloured confetti whose
    // luminance edges are far weaker, and it is noticeably harder to fuse.
    for (let x = outputWidth - 1; x >= 0; x--) {
      pix[x] = same[x] === x ? (rand() < 0.5 ? 0 : 255) : pix[same[x]];
      const idx = (y * outputWidth + x) * 4;
      out[idx] = pix[x];
      out[idx + 1] = pix[x];
      out[idx + 2] = pix[x];
      out[idx + 3] = 255;
    }
  }

  return { data: out, width: outputWidth, height: outputHeight };
}

/**
 * Generate a side-by-side stereogram (cross-eye 3D) from raw image + depth.
 */
export function generateSideBySide(
  image: RawImage,
  depthData: Float32Array,
  depthWidth: number,
  depthHeight: number,
  intensity: number = 10
): RawImage {
  const { data: pixels, width, height } = image;

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

  const blurRadius = Math.max(2, Math.round(Math.min(depthWidth, depthHeight) / 150));
  const smoothed = blurDepth(normalized, depthWidth, depthHeight, blurRadius);

  const outWidth = width * 2 + 2; // 2px divider
  const out = Buffer.alloc(outWidth * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const d = sampleDepth(smoothed, depthWidth, depthHeight, x, y, width, height);
      const shift = d * intensity;

      // Left eye (shifted right — cross-eye format)
      const leftSrcX = Math.min(Math.max(x + shift, 0), width - 1);
      const lIdx = (y * outWidth + x) * 4;
      out[lIdx] = sampleBilinear(pixels, width, height, leftSrcX, y, 0);
      out[lIdx + 1] = sampleBilinear(pixels, width, height, leftSrcX, y, 1);
      out[lIdx + 2] = sampleBilinear(pixels, width, height, leftSrcX, y, 2);
      out[lIdx + 3] = 255;

      // Right eye (shifted left)
      const rightSrcX = Math.min(Math.max(x - shift, 0), width - 1);
      const rIdx = (y * outWidth + width + 2 + x) * 4;
      out[rIdx] = sampleBilinear(pixels, width, height, rightSrcX, y, 0);
      out[rIdx + 1] = sampleBilinear(pixels, width, height, rightSrcX, y, 1);
      out[rIdx + 2] = sampleBilinear(pixels, width, height, rightSrcX, y, 2);
      out[rIdx + 3] = 255;
    }

    // Divider line
    const d1 = (y * outWidth + width) * 4;
    const d2 = (y * outWidth + width + 1) * 4;
    out[d1] = out[d2] = 60;
    out[d1 + 1] = out[d2 + 1] = 60;
    out[d1 + 2] = out[d2 + 2] = 60;
    out[d1 + 3] = out[d2 + 3] = 255;
  }

  return { data: out, width: outWidth, height };
}

/**
 * Generate Wiggle 3D — two depth-shifted views (left/right eye).
 * Caller combines into an animated GIF or looping video for glasses-free 3D.
 */
export function generateWiggle3D(
  image: RawImage,
  depthData: Float32Array,
  depthWidth: number,
  depthHeight: number,
  intensity: number = 6
): { left: RawImage; right: RawImage } {
  const { data: pixels, width, height } = image;

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
  const blurRadius = Math.max(2, Math.round(Math.min(depthWidth, depthHeight) / 150));
  const smoothed = blurDepth(normalized, depthWidth, depthHeight, blurRadius);

  const leftBuf = Buffer.alloc(width * height * 4);
  const rightBuf = Buffer.alloc(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const d = sampleDepth(smoothed, depthWidth, depthHeight, x, y, width, height);
      const shift = d * intensity;
      const idx = (y * width + x) * 4;

      const lx = Math.min(Math.max(x + shift, 0), width - 1);
      leftBuf[idx] = sampleBilinear(pixels, width, height, lx, y, 0);
      leftBuf[idx + 1] = sampleBilinear(pixels, width, height, lx, y, 1);
      leftBuf[idx + 2] = sampleBilinear(pixels, width, height, lx, y, 2);
      leftBuf[idx + 3] = 255;

      const rx = Math.min(Math.max(x - shift, 0), width - 1);
      rightBuf[idx] = sampleBilinear(pixels, width, height, rx, y, 0);
      rightBuf[idx + 1] = sampleBilinear(pixels, width, height, rx, y, 1);
      rightBuf[idx + 2] = sampleBilinear(pixels, width, height, rx, y, 2);
      rightBuf[idx + 3] = 255;
    }
  }

  return {
    left: { data: leftBuf, width, height },
    right: { data: rightBuf, width, height },
  };
}

/**
 * Generate a Color Stereogram using strip-based feedback.
 * The leftmost strip is seeded from the original image, then each subsequent
 * strip copies from the previous one with a depth-dependent horizontal shift.
 * This creates clean repetition that encodes 3D depth for cross-eye viewing.
 */
export function generateColorStereogram(
  image: RawImage,
  depthData: Float32Array,
  depthWidth: number,
  depthHeight: number
): RawImage {
  const { data: pixels, width: outW, height: outH } = image;

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

  // Light depth blur to smooth edges
  const blurRadius = Math.max(3, Math.round(Math.min(depthWidth, depthHeight) / 100));
  const smoothed = blurDepth(normalized, depthWidth, depthHeight, blurRadius);

  const stripWidth = Math.round(outW / 7);
  const maxShift = Math.round(stripWidth * 0.05);
  const out = Buffer.alloc(outW * outH * 4);

  for (let y = 0; y < outH; y++) {
    // Seed: first strip from original image
    for (let x = 0; x < stripWidth && x < outW; x++) {
      const idx = (y * outW + x) * 4;
      out[idx] = pixels[idx];
      out[idx + 1] = pixels[idx + 1];
      out[idx + 2] = pixels[idx + 2];
      out[idx + 3] = 255;
    }

    // Each subsequent strip: copy from previous strip + depth shift
    for (let x = stripWidth; x < outW; x++) {
      const d = sampleDepth(smoothed, depthWidth, depthHeight, x, y, outW, outH);
      const shift = Math.round(d * maxShift);
      let srcX = x - stripWidth + shift;
      srcX = Math.max(0, Math.min(srcX, outW - 1));
      const dstIdx = (y * outW + x) * 4;
      const srcIdx = (y * outW + srcX) * 4;
      out[dstIdx] = out[srcIdx];
      out[dstIdx + 1] = out[srcIdx + 1];
      out[dstIdx + 2] = out[srcIdx + 2];
      out[dstIdx + 3] = 255;
    }
  }

  return { data: out, width: outW, height: outH };
}
