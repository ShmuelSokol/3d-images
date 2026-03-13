import { generateAnaglyph } from "./anaglyph";

export interface DepthData {
  data: Float32Array;
  width: number;
  height: number;
}

export type VideoProgress = {
  phase: "extracting" | "processing" | "recording";
  current: number;
  total: number;
};

export type EstimateFn = (
  buffer: ArrayBuffer,
  id: string,
  model: string
) => Promise<DepthData>;

/**
 * Process a video file into a 3D anaglyph video.
 *
 * Phase 1: Extract frames + depth estimation + anaglyph generation
 * Phase 2: Record processed frames into a WebM video via MediaRecorder
 */
export async function processVideo(
  file: File,
  estimate: EstimateFn,
  intensity: number,
  model: string,
  onProgress: (p: VideoProgress) => void,
  abortSignal?: AbortSignal
): Promise<Blob> {
  // Load video metadata
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.src = URL.createObjectURL(file);
  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error("Failed to load video"));
  });

  const fps = 15;
  const maxDim = 720;
  const maxDuration = 60; // seconds
  const duration = Math.min(video.duration, maxDuration);
  const totalFrames = Math.ceil(duration * fps);

  let w = video.videoWidth,
    h = video.videoHeight;
  if (w > maxDim || h > maxDim) {
    const s = maxDim / Math.max(w, h);
    w = Math.round(w * s);
    h = Math.round(h * s);
  }
  // Ensure even dimensions (required by some codecs)
  w = w % 2 === 0 ? w : w + 1;
  h = h % 2 === 0 ? h : h + 1;

  const frameCanvas = document.createElement("canvas");
  frameCanvas.width = w;
  frameCanvas.height = h;
  const frameCtx = frameCanvas.getContext("2d")!;

  // ── Phase 1: Process frames ──
  // Store as JPEG blobs to save memory (~50-100KB each vs ~1.4MB as ImageData)
  const processedBlobs: Blob[] = [];

  for (let i = 0; i < totalFrames; i++) {
    if (abortSignal?.aborted) throw new Error("Aborted");

    // Seek to frame
    video.currentTime = i / fps;
    await new Promise<void>((r) => {
      video.onseeked = () => r();
    });

    // Draw frame
    frameCtx.drawImage(video, 0, 0, w, h);
    const imageData = frameCtx.getImageData(0, 0, w, h);

    // Get JPEG for depth estimation
    const jpegBlob: Blob = await new Promise((r) =>
      frameCanvas.toBlob((b) => r(b!), "image/jpeg", 0.75)
    );
    const buffer = await jpegBlob.arrayBuffer();

    onProgress({ phase: "processing", current: i + 1, total: totalFrames });

    // Run depth estimation
    const depth = await estimate(buffer, `frame-${i}`, model);

    // Generate anaglyph
    const anaglyphData = generateAnaglyph(
      imageData,
      depth.data,
      depth.width,
      depth.height,
      intensity
    );

    // Store as JPEG blob to save memory
    frameCtx.putImageData(anaglyphData, 0, 0);
    const outBlob: Blob = await new Promise((r) =>
      frameCanvas.toBlob((b) => r(b!), "image/jpeg", 0.9)
    );
    processedBlobs.push(outBlob);
  }

  URL.revokeObjectURL(video.src);

  // ── Phase 2: Record into video ──
  onProgress({ phase: "recording", current: 0, total: totalFrames });

  const outCanvas = document.createElement("canvas");
  outCanvas.width = w;
  outCanvas.height = h;
  const outCtx = outCanvas.getContext("2d")!;

  const stream = outCanvas.captureStream(fps);
  const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
    ? "video/webm;codecs=vp9"
    : MediaRecorder.isTypeSupported("video/webm")
      ? "video/webm"
      : "video/mp4";

  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 5_000_000,
  });

  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };

  recorder.start();

  for (let i = 0; i < processedBlobs.length; i++) {
    if (abortSignal?.aborted) {
      recorder.stop();
      throw new Error("Aborted");
    }

    const bmp = await createImageBitmap(processedBlobs[i]);
    outCtx.drawImage(bmp, 0, 0);
    bmp.close();

    onProgress({ phase: "recording", current: i + 1, total: processedBlobs.length });

    // Wait for correct frame duration
    await new Promise((r) => setTimeout(r, 1000 / fps));
  }

  recorder.stop();
  await new Promise<void>((r) => {
    recorder.onstop = () => r();
  });

  return new Blob(chunks, { type: mimeType });
}
