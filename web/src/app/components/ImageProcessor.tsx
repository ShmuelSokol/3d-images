"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { generateAnaglyph } from "@/lib/anaglyph";

type Stage = "upload" | "loading-model" | "estimating" | "done";

interface DepthResult {
  depthData: number[];
  depthWidth: number;
  depthHeight: number;
}

export default function ImageProcessor() {
  const [stage, setStage] = useState<Stage>("upload");
  const [progress, setProgress] = useState("");
  const [intensity, setIntensity] = useState(10);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [depthResult, setDepthResult] = useState<DepthResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [imageId, setImageId] = useState<string | null>(null);

  const originalCanvasRef = useRef<HTMLCanvasElement>(null);
  const depthCanvasRef = useRef<HTMLCanvasElement>(null);
  const anaglyphCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const drawAnaglyph = useCallback(
    (result: DepthResult, currentIntensity: number) => {
      const canvas = originalCanvasRef.current;
      const anaCanvas = anaglyphCanvasRef.current;
      if (!canvas || !anaCanvas) return;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const anaglyphData = generateAnaglyph(
        imageData,
        new Float32Array(result.depthData),
        result.depthWidth,
        result.depthHeight,
        currentIntensity
      );

      anaCanvas.width = canvas.width;
      anaCanvas.height = canvas.height;
      const anaCtx = anaCanvas.getContext("2d");
      if (anaCtx) anaCtx.putImageData(anaglyphData, 0, 0);
    },
    []
  );

  // Redraw anaglyph when intensity changes
  useEffect(() => {
    if (depthResult && stage === "done") {
      drawAnaglyph(depthResult, intensity);
    }
  }, [intensity, depthResult, stage, drawAnaglyph]);

  const processImage = async (file: File) => {
    // Load image onto canvas
    const url = URL.createObjectURL(file);
    setImageUrl(url);

    const img = new Image();
    img.src = url;
    await new Promise((resolve) => (img.onload = resolve));
    imgRef.current = img;

    // Scale down large images for performance
    const maxDim = 1024;
    let w = img.width;
    let h = img.height;
    if (w > maxDim || h > maxDim) {
      const scale = maxDim / Math.max(w, h);
      w = Math.round(w * scale);
      h = Math.round(h * scale);
    }

    const canvas = originalCanvasRef.current!;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0, w, h);

    // Upload to server
    const formData = new FormData();
    formData.append("file", file);
    formData.append("width", w.toString());
    formData.append("height", h.toString());

    try {
      const res = await fetch("/api/images", {
        method: "POST",
        body: formData,
      });
      if (res.ok) {
        const data = await res.json();
        setImageId(data.id);
      }
    } catch {
      // Non-critical — continue processing locally
    }

    // Run depth estimation
    setStage("loading-model");
    setProgress("Loading AI depth model (~25MB first time)...");

    try {
      const { pipeline, env } = await import("@xenova/transformers");
      // Use WASM backend for browser
      env.allowLocalModels = false;

      setProgress("Model loaded. Running depth estimation...");
      setStage("estimating");

      // Create a data URL for the scaled image
      const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
      const estimator = await pipeline(
        "depth-estimation",
        "Xenova/depth-anything-small-hf"
      );
      const rawResult = await estimator(dataUrl);
      const result = Array.isArray(rawResult) ? rawResult[0] : rawResult;

      // Extract depth data
      const depthTensor = result.predicted_depth;
      const depthData = Array.from(depthTensor.data as Float32Array);
      const depthWidth = depthTensor.dims[1];
      const depthHeight = depthTensor.dims[0];

      const dr: DepthResult = { depthData, depthWidth, depthHeight };
      setDepthResult(dr);

      // Draw depth map visualization
      const depthCanvas = depthCanvasRef.current!;
      depthCanvas.width = depthWidth;
      depthCanvas.height = depthHeight;
      const depthCtx = depthCanvas.getContext("2d")!;
      const depthImgData = depthCtx.createImageData(depthWidth, depthHeight);

      let minD = Infinity,
        maxD = -Infinity;
      for (const d of depthData) {
        if (d < minD) minD = d;
        if (d > maxD) maxD = d;
      }
      const rangeD = maxD - minD || 1;

      for (let i = 0; i < depthData.length; i++) {
        const v = Math.round(((depthData[i] - minD) / rangeD) * 255);
        depthImgData.data[i * 4] = v;
        depthImgData.data[i * 4 + 1] = v;
        depthImgData.data[i * 4 + 2] = v;
        depthImgData.data[i * 4 + 3] = 255;
      }
      depthCtx.putImageData(depthImgData, 0, 0);

      // Generate anaglyph
      drawAnaglyph(dr, intensity);

      setStage("done");
      setProgress("");
    } catch (err) {
      console.error("Depth estimation failed:", err);
      setProgress(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
      setStage("upload");
    }
  };

  const handleFile = (file: File) => {
    if (!file.type.startsWith("image/")) return;
    processImage(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleDownload = () => {
    const canvas = anaglyphCanvasRef.current;
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = "anaglyph-3d.png";
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  const handleSave = async () => {
    if (!imageId || !anaglyphCanvasRef.current || !depthCanvasRef.current)
      return;
    setSaving(true);

    try {
      const formData = new FormData();

      // Convert canvases to blobs
      const anaBlob = await new Promise<Blob>((resolve) =>
        anaglyphCanvasRef.current!.toBlob((b) => resolve(b!), "image/png")
      );
      const depthBlob = await new Promise<Blob>((resolve) =>
        depthCanvasRef.current!.toBlob((b) => resolve(b!), "image/png")
      );

      formData.append("anaglyph", anaBlob, "anaglyph.png");
      formData.append("depthMap", depthBlob, "depth.png");
      formData.append("intensity", intensity.toString());

      await fetch(`/api/images/${imageId}/save-results`, {
        method: "POST",
        body: formData,
      });
    } catch (err) {
      console.error("Save failed:", err);
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setStage("upload");
    setImageUrl(null);
    setDepthResult(null);
    setImageId(null);
    setProgress("");
    setIntensity(10);
    if (imageUrl) URL.revokeObjectURL(imageUrl);
  };

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-8">
      <header className="text-center mb-8">
        <h1 className="text-4xl font-bold mb-2">3D Image Generator</h1>
        <p className="text-gray-400">
          Upload a photo &rarr; AI estimates depth &rarr; get an anaglyph 3D
          image
        </p>
        <p className="text-sm text-gray-500 mt-1">
          Wear red/cyan 3D glasses to see the effect!
        </p>
      </header>

      {stage === "upload" && (
        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed border-gray-600 rounded-xl p-16 text-center
                     cursor-pointer hover:border-cyan-500 hover:bg-gray-900/50 transition-all"
        >
          <div className="text-6xl mb-4">📸</div>
          <p className="text-xl text-gray-300 mb-2">
            Drop an image here or click to upload
          </p>
          <p className="text-sm text-gray-500">
            Supports JPG, PNG, WebP
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
          />
        </div>
      )}

      {(stage === "loading-model" || stage === "estimating") && (
        <div className="text-center py-16">
          <div className="inline-block w-12 h-12 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mb-4" />
          <p className="text-lg text-gray-300">{progress}</p>
        </div>
      )}

      {stage === "done" && (
        <div className="space-y-8">
          {/* Controls */}
          <div className="flex flex-wrap items-center justify-between gap-4 bg-gray-900 rounded-xl p-4">
            <div className="flex items-center gap-4 flex-1 min-w-[250px]">
              <label className="text-sm text-gray-400 whitespace-nowrap">
                3D Intensity
              </label>
              <input
                type="range"
                min="1"
                max="40"
                value={intensity}
                onChange={(e) => setIntensity(parseInt(e.target.value))}
                className="flex-1 accent-cyan-500"
              />
              <span className="text-sm text-cyan-400 w-8">{intensity}</span>
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleDownload}
                className="px-4 py-2 bg-cyan-600 hover:bg-cyan-700 rounded-lg text-sm font-medium transition"
              >
                Download 3D Image
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !imageId}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-700
                           disabled:text-gray-500 rounded-lg text-sm font-medium transition"
              >
                {saving ? "Saving..." : "Save to Gallery"}
              </button>
              <button
                onClick={reset}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm font-medium transition"
              >
                New Image
              </button>
            </div>
          </div>

          {/* Image Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div>
              <h3 className="text-sm font-medium text-gray-400 mb-2">
                Original
              </h3>
              <canvas
                ref={originalCanvasRef}
                className="w-full rounded-lg border border-gray-800"
              />
            </div>
            <div>
              <h3 className="text-sm font-medium text-gray-400 mb-2">
                Depth Map
              </h3>
              <canvas
                ref={depthCanvasRef}
                className="w-full rounded-lg border border-gray-800"
              />
            </div>
            <div>
              <h3 className="text-sm font-medium text-gray-400 mb-2">
                Anaglyph 3D 🔴🔵
              </h3>
              <canvas
                ref={anaglyphCanvasRef}
                className="w-full rounded-lg border border-gray-800"
              />
            </div>
          </div>
        </div>
      )}

      {/* Hidden canvases for processing when not in "done" stage */}
      {stage !== "done" && (
        <div className="hidden">
          <canvas ref={originalCanvasRef} />
          <canvas ref={depthCanvasRef} />
          <canvas ref={anaglyphCanvasRef} />
        </div>
      )}
    </div>
  );
}
