import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';

env.allowLocalModels = false;
env.useBrowserCache = true;

let estimator = null;
let currentModel = null;
let loading = null;

async function ensureModel(model) {
  if (estimator && currentModel === model) return;

  // Different model requested — reset
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
    self.postMessage({ type: 'model-progress', status: 'initiate', model });
    estimator = await pipeline('depth-estimation', model, {
      progress_callback: (p) => self.postMessage({ type: 'model-progress', ...p }),
    });
    self.postMessage({ type: 'model-ready', model });
  })();
  await loading;
}

// Preload default model immediately
ensureModel('Xenova/depth-anything-base-hf');

self.onmessage = async (e) => {
  const { type } = e.data;

  if (type === 'set-model') {
    await ensureModel(e.data.model);
    return;
  }

  if (type === 'estimate') {
    const { id, imageBuffer, model } = e.data;
    try {
      await ensureModel(model || 'Xenova/depth-anything-base-hf');

      const blob = new Blob([imageBuffer], { type: 'image/jpeg' });
      const url = URL.createObjectURL(blob);
      const raw = await estimator(url);
      URL.revokeObjectURL(url);

      const r = Array.isArray(raw) ? raw[0] : raw;
      const src = r.predicted_depth.data;
      const out = new Float32Array(src.length);
      out.set(src);

      self.postMessage(
        {
          type: 'depth-result',
          id,
          depthData: out.buffer,
          depthWidth: r.predicted_depth.dims[1],
          depthHeight: r.predicted_depth.dims[0],
        },
        [out.buffer]
      );
    } catch (err) {
      self.postMessage({
        type: 'error',
        id,
        error: err.message || 'Depth estimation failed',
      });
    }
  }
};
