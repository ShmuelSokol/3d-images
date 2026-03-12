/**
 * Generate an anaglyph 3D image from an original image and its depth map.
 *
 * Algorithm:
 * 1. Normalize the depth map to 0–1 range
 * 2. For each pixel, compute a horizontal shift proportional to depth
 * 3. Left eye (red channel): sample from (x + shift)
 * 4. Right eye (cyan channels): sample from (x - shift)
 * 5. Combine: output = (leftR, rightG, rightB)
 */

export function generateAnaglyph(
  imageData: ImageData,
  depthData: Float32Array | number[],
  depthWidth: number,
  depthHeight: number,
  intensity: number = 10
): ImageData {
  const { width, height, data: pixels } = imageData;
  const output = new ImageData(width, height);
  const out = output.data;

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
      // Map pixel coords to depth map coords
      const dx = Math.floor((x / width) * depthWidth);
      const dy = Math.floor((y / height) * depthHeight);
      const dIdx = dy * depthWidth + dx;
      const normalizedDepth = (depthData[dIdx] - minD) / rangeD;

      // Shift proportional to depth (closer = more shift)
      const shift = Math.round((normalizedDepth - 0.5) * intensity);

      // Left eye position (for red channel)
      const leftX = Math.min(Math.max(x + shift, 0), width - 1);
      const leftIdx = (y * width + leftX) * 4;

      // Right eye position (for cyan channels)
      const rightX = Math.min(Math.max(x - shift, 0), width - 1);
      const rightIdx = (y * width + rightX) * 4;

      const outIdx = (y * width + x) * 4;
      out[outIdx] = pixels[leftIdx]; // Red from left eye
      out[outIdx + 1] = pixels[rightIdx + 1]; // Green from right eye
      out[outIdx + 2] = pixels[rightIdx + 2]; // Blue from right eye
      out[outIdx + 3] = 255; // Alpha
    }
  }

  return output;
}
