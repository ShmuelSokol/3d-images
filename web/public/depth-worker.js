import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';

env.allowLocalModels = false;
env.useBrowserCache = true;

let estimator = null;
let loading = null;

async function ensureModel() {
  if (estimator) return;
  if (loading) { await loading; return; }
  loading = (async () => {
    estimator = await pipeline('depth-estimation', 'Xenova/depth-anything-small-hf', {
      progress_callback: (p) => self.postMessage({ type: 'model-progress', ...p }),
    });
    self.postMessage({ type: 'model-ready' });
  })();
  await loading;
}

// Start preloading immediately when worker is created
ensureModel();

self.onmessage = async (e) => {
  if (e.data.type === 'estimate') {
    const { id, imageBuffer } = e.data;
    try {
      await ensureModel();

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
      self.postMessage({ type: 'error', id, error: err.message || 'Depth estimation failed' });
    }
  }
};
