import { pipeline, RawImage, type PipelineType } from "@xenova/transformers";
import sharp from "sharp";

export interface DepthResult {
  data: Float32Array;
  width: number;
  height: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let estimator: any = null;
let currentModel: string | null = null;
let loading: Promise<void> | null = null;

async function ensureModel(model: string) {
  if (estimator && currentModel === model) return;

  if (currentModel !== model) {
    estimator = null;
    loading = null;
  }

  if (loading) {
    await loading;
    return;
  }

  currentModel = model;
  loading = (async () => {
    console.log(`[depth] Loading model: ${model}`);
    estimator = await pipeline(
      "depth-estimation" as PipelineType,
      model
    );
    console.log(`[depth] Model ready: ${model}`);
  })();
  await loading;
}

/**
 * Estimate depth from a JPEG/PNG buffer.
 * Decodes to raw RGB pixels via sharp, then constructs a RawImage directly
 * to avoid data URL issues in Node.js/Docker environments.
 */
export async function estimateDepth(
  imageBuffer: Buffer,
  model: string = "Xenova/depth-anything-large-hf"
): Promise<DepthResult> {
  await ensureModel(model);

  // Decode image to raw RGB pixels using sharp
  const { data: pixels, info } = await sharp(imageBuffer)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const img = new RawImage(new Uint8ClampedArray(pixels), info.width, info.height, 3);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw: any = await estimator(img);
  const r = Array.isArray(raw) ? raw[0] : raw;

  const src = r.predicted_depth.data;
  const out = new Float32Array(src.length);
  out.set(src);

  return {
    data: out,
    width: r.predicted_depth.dims[1],
    height: r.predicted_depth.dims[0],
  };
}
