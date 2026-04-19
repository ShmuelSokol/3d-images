# Depth model

**`onnx-community/depth-anything-v2-large`** via `@huggingface/transformers` v3 + `onnxruntime-node`.

## Why V2 Large and not V3

Tried V3 on 2026-04-19. It failed.

- `onnx-community/depth-anything-v3-large` exists on HuggingFace but is **missing `preprocessor_config.json`** — the transformers.js pipeline won't load it.
- We supplied the config manually (local dir + DPTImageProcessor, 504px). Download worked, model loaded.
- But inference failed: `Invalid rank for input: pixel_values. Got: 4. Expected: 5.`
- V3 is a **multi-view** model (`[batch, views, channels, h, w]`) for reconstructing geometry from multiple camera angles. It's not a drop-in monocular replacement for V2.
- `TillBeemelmanns/Depth-Anything-V3-ONNX` has a metric-only variant — also doesn't fit the monocular pipeline.

**Conclusion:** V2 Large is still the best available monocular depth model for the transformers.js `depth-estimation` pipeline. Stick with it until HF publishes a monocular-compatible V3 export.

## Variants in use

| Model | Where | Purpose |
|---|---|---|
| `onnx-community/depth-anything-v2-large` | `worker.js` (HD), `depth-estimator.ts`, demo/temporal scripts | Production |
| `onnx-community/depth-anything-v2-small` | `worker.js` (fast mode) | Not currently exercised |
| `Xenova/depth-anything-base-hf` | `public/depth-worker.js` | Browser-side preview (V1 Base) |

## Model caching

- `TRANSFORMERS_CACHE=/app/.cache` + `HF_HOME=/app/.cache` set in Dockerfile
- On Railway, `/app/.cache` is the writable dir — `chown nextjs:nodejs` in Dockerfile
- First request after a deploy downloads the model (~1.3 GB) — slow. Subsequent requests reuse cache until a rebuild.
- `env.cacheDir` must match. Set at module load in `depth-estimator.ts`.

## Depth estimation at a glance

```ts
const img = new RawImage(pixels, width, height, 3);
const result = await estimator(img);
const depth = result.predicted_depth.data;  // Float32Array
```

The `RawImage` path bypasses data-URL conversion, which is flaky in Node/Docker.

## Limitations (worth knowing)

- Works best on natural photos with clear foreground/background separation
- Flat/graphic/synthetic designs (logos, line art) produce binary-looking depth maps → bad stereograms
- Indoor scenes with many objects → crisp depth edges
- Sky/uniform backgrounds → no gradient, flat result (fine for anaglyph, boring for Magic Eye)
- **No metric depth** — values are relative, normalized per image
