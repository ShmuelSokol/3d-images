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
 * Generate an anaglyph 3D image from raw RGBA pixels + depth map.
 * Uses Gaussian-smoothed depth, sub-pixel interpolation, and edge-aware blending.
 */
export function generateAnaglyphServer(
  image: RawImage,
  depthData: Float32Array,
  depthWidth: number,
  depthHeight: number,
  intensity: number = 10
): RawImage {
  const { data: pixels, width, height } = image;
  const out = Buffer.alloc(width * height * 4);

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

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Map to depth coordinates with bilinear sampling
      const dxf = (x / width) * (depthWidth - 1);
      const dyf = (y / height) * (depthHeight - 1);
      const dx0 = Math.floor(dxf);
      const dx1 = Math.min(dx0 + 1, depthWidth - 1);
      const dy0 = Math.floor(dyf);
      const dy1 = Math.min(dy0 + 1, depthHeight - 1);
      const fx = dxf - dx0;
      const fy = dyf - dy0;

      // Bilinear interpolation of smoothed depth
      const d =
        smoothed[dy0 * depthWidth + dx0] * (1 - fx) * (1 - fy) +
        smoothed[dy0 * depthWidth + dx1] * fx * (1 - fy) +
        smoothed[dy1 * depthWidth + dx0] * (1 - fx) * fy +
        smoothed[dy1 * depthWidth + dx1] * fx * fy;

      // Proportional shift: far=0 (at screen), close=max (pops out)
      const shift = d * intensity;

      const leftX = Math.min(Math.max(x + shift, 0), width - 1);
      const rightX = Math.min(Math.max(x - shift, 0), width - 1);

      const outIdx = (y * width + x) * 4;

      // Sub-pixel sampled colors for smooth result
      out[outIdx] = Math.round(sampleBilinear(pixels, width, height, leftX, y, 0));       // Red from left eye
      out[outIdx + 1] = Math.round(sampleBilinear(pixels, width, height, rightX, y, 1));  // Green from right eye
      out[outIdx + 2] = Math.round(sampleBilinear(pixels, width, height, rightX, y, 2));  // Blue from right eye
      out[outIdx + 3] = 255;
    }
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
