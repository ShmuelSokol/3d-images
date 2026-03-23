import { pipeline as hfPipeline, RawImage, env } from "@huggingface/transformers";
import sharp from "sharp";
import https from "https";
import fs from "fs";
import path from "path";

// Force cache to writable dir (not node_modules)
env.cacheDir = process.env["TRANSFORMERS_CACHE"] || process.env["HF_HOME"] || "/tmp/.cache";

const V3_MODEL_ID = "onnx-community/depth-anything-v3-large";
const V3_HF_BASE = "https://huggingface.co/onnx-community/depth-anything-v3-large/resolve/main";

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        fs.unlinkSync(dest);
        return downloadFile(res.headers.location!, dest).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlinkSync(dest);
        return reject(new Error(`Download failed: ${res.statusCode} for ${url}`));
      }
      const total = parseInt(res.headers["content-length"] || "0", 10);
      let downloaded = 0;
      res.on("data", (chunk: Buffer) => {
        downloaded += chunk.length;
        if (total > 0) {
          const pct = ((downloaded / total) * 100).toFixed(1);
          process.stdout.write(`\r[depth] Downloading... ${pct}% (${(downloaded / 1e6).toFixed(0)}/${(total / 1e6).toFixed(0)} MB)`);
        }
      });
      res.pipe(file);
      file.on("finish", () => { file.close(); console.log(""); resolve(); });
      file.on("error", (err) => { fs.unlinkSync(dest); reject(err); });
    }).on("error", (err) => { fs.unlinkSync(dest); reject(err); });
  });
}

// V3 ONNX repo is missing preprocessor_config.json, so we download the model
// manually and supply the config ourselves (same DPT preprocessing as V2, 504px input).
async function ensureV3Downloaded(): Promise<string> {
  const localDir = path.join(env.cacheDir!, "depth-anything-v3-large-local");
  const onnxDir = path.join(localDir, "onnx");
  const modelFile = path.join(onnxDir, "model.onnx");
  const dataFile = path.join(onnxDir, "model.onnx_data");
  const configFile = path.join(localDir, "config.json");
  const preprocFile = path.join(localDir, "preprocessor_config.json");

  if (fs.existsSync(modelFile) && fs.existsSync(dataFile) && fs.existsSync(preprocFile)) {
    return localDir;
  }

  fs.mkdirSync(onnxDir, { recursive: true });

  fs.writeFileSync(configFile, JSON.stringify({
    model_type: "depth_anything",
    "transformers.js_config": { dtype: "fp32", use_external_data_format: true },
  }));
  fs.writeFileSync(preprocFile, JSON.stringify({
    do_normalize: true, do_pad: false, do_rescale: true, do_resize: true,
    ensure_multiple_of: 14,
    image_mean: [0.485, 0.456, 0.406],
    image_processor_type: "DPTImageProcessor",
    image_std: [0.229, 0.224, 0.225],
    keep_aspect_ratio: true, resample: 3,
    rescale_factor: 0.00392156862745098,
    size: { height: 504, width: 504 },
    size_divisor: null,
  }));

  if (!fs.existsSync(modelFile)) {
    console.log("[depth] Downloading Depth Anything V3 Large — model.onnx ...");
    await downloadFile(`${V3_HF_BASE}/onnx/model.onnx`, modelFile);
  }
  if (!fs.existsSync(dataFile)) {
    console.log("[depth] Downloading Depth Anything V3 Large — model.onnx_data (1.38 GB) ...");
    await downloadFile(`${V3_HF_BASE}/onnx/model.onnx_data`, dataFile);
  }

  console.log("[depth] V3 model files ready");
  return localDir;
}

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
    // V3 needs manual download + local preprocessor_config.json
    const resolvedPath = model === V3_MODEL_ID ? await ensureV3Downloaded() : model;
    console.log(`[depth] Loading model: ${model}`);
    estimator = await hfPipeline(
      "depth-estimation",
      resolvedPath,
      { device: "cpu", local_files_only: model === V3_MODEL_ID }
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
  model: string = V3_MODEL_ID
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
