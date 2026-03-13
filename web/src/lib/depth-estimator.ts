import { pipeline, type PipelineType } from "@xenova/transformers";

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
 * Estimate depth from an image URL or file path.
 * Returns a Float32Array of depth values + dimensions.
 */
export async function estimateDepth(
  imageUrl: string,
  model: string = "Xenova/depth-anything-base-hf"
): Promise<DepthResult> {
  await ensureModel(model);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw: any = await estimator(imageUrl);
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
