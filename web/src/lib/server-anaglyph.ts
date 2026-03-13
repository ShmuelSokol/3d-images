import sharp from "sharp";

export interface RawImage {
  data: Buffer;
  width: number;
  height: number;
}

/**
 * Gaussian blur a depth map in-place for smoother 3D transitions.
 */
function blurDepth(
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
function sampleDepth(
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
      const shift = (0.05 + d * 0.95) * intensity;
      shiftMap[y * width + x] = shift;

      const leftX = Math.min(Math.max(x + shift, 0), width - 1);
      const rightX = Math.min(Math.max(x - shift, 0), width - 1);

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
