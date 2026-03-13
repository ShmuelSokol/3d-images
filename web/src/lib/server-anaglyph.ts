import sharp from "sharp";

export interface RawImage {
  data: Buffer;
  width: number;
  height: number;
}

/**
 * Generate an anaglyph 3D image from raw RGBA pixels + depth map.
 * Port of the client-side algorithm to work with raw buffers.
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

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = Math.floor((x / width) * depthWidth);
      const dy = Math.floor((y / height) * depthHeight);
      const dIdx = dy * depthWidth + dx;
      const normalizedDepth = (depthData[dIdx] - minD) / rangeD;

      const shift = Math.round((normalizedDepth - 0.5) * intensity);

      const leftX = Math.min(Math.max(x + shift, 0), width - 1);
      const leftIdx = (y * width + leftX) * 4;

      const rightX = Math.min(Math.max(x - shift, 0), width - 1);
      const rightIdx = (y * width + rightX) * 4;

      const outIdx = (y * width + x) * 4;
      out[outIdx] = pixels[leftIdx]; // Red from left eye
      out[outIdx + 1] = pixels[rightIdx + 1]; // Green from right eye
      out[outIdx + 2] = pixels[rightIdx + 2]; // Blue from right eye
      out[outIdx + 3] = 255; // Alpha
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
