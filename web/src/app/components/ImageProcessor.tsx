"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { generateAnaglyph } from "@/lib/anaglyph";

interface DepthResult {
  depthData: number[];
  depthWidth: number;
  depthHeight: number;
}

interface ImageJob {
  clientId: string;
  serverId?: string;
  file: File;
  stage: "queued" | "uploading" | "depth" | "done" | "error";
  progress: string;
  originalDataUrl?: string;
  depthDataUrl?: string;
  anaglyphDataUrl?: string;
  depthResult?: DepthResult;
  originalImageData?: ImageData;
  intensity: number;
  width: number;
  height: number;
  error?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cachedEstimator: any = null;

function renderDepthMap(dr: DepthResult): string {
  const canvas = document.createElement("canvas");
  canvas.width = dr.depthWidth;
  canvas.height = dr.depthHeight;
  const ctx = canvas.getContext("2d")!;
  const imgData = ctx.createImageData(dr.depthWidth, dr.depthHeight);

  let minD = Infinity,
    maxD = -Infinity;
  for (const d of dr.depthData) {
    if (d < minD) minD = d;
    if (d > maxD) maxD = d;
  }
  const rangeD = maxD - minD || 1;

  for (let i = 0; i < dr.depthData.length; i++) {
    const v = Math.round(((dr.depthData[i] - minD) / rangeD) * 255);
    imgData.data[i * 4] = v;
    imgData.data[i * 4 + 1] = v;
    imgData.data[i * 4 + 2] = v;
    imgData.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas.toDataURL("image/png");
}

function renderAnaglyph(
  originalImageData: ImageData,
  dr: DepthResult,
  intensity: number
): string {
  const result = generateAnaglyph(
    originalImageData,
    new Float32Array(dr.depthData),
    dr.depthWidth,
    dr.depthHeight,
    intensity
  );
  const canvas = document.createElement("canvas");
  canvas.width = originalImageData.width;
  canvas.height = originalImageData.height;
  const ctx = canvas.getContext("2d")!;
  ctx.putImageData(result, 0, 0);
  return canvas.toDataURL("image/png");
}

async function saveResults(
  serverId: string,
  anaglyphDataUrl: string,
  depthDataUrl: string,
  intensity: number
) {
  const formData = new FormData();

  // Convert data URLs to blobs
  const anaRes = await fetch(anaglyphDataUrl);
  const anaBlob = await anaRes.blob();
  const depthRes = await fetch(depthDataUrl);
  const depthBlob = await depthRes.blob();

  formData.append("anaglyph", anaBlob, "anaglyph.png");
  formData.append("depthMap", depthBlob, "depth.png");
  formData.append("intensity", intensity.toString());

  await fetch(`/api/images/${serverId}/save-results`, {
    method: "POST",
    body: formData,
  });
}

export default function ImageProcessor() {
  const [jobs, setJobs] = useState<ImageJob[]>([]);
  const [globalIntensity, setGlobalIntensity] = useState(10);
  const [selectedJob, setSelectedJob] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const processingRef = useRef(false);

  const updateJob = useCallback(
    (clientId: string, updates: Partial<ImageJob>) => {
      setJobs((prev) =>
        prev.map((j) => (j.clientId === clientId ? { ...j, ...updates } : j))
      );
    },
    []
  );

  const processQueue = useCallback(async () => {
    if (processingRef.current) return;
    processingRef.current = true;

    // Process jobs one at a time
    while (true) {
      // Find next queued job from current state
      let nextJob: ImageJob | undefined;
      await new Promise<void>((resolve) => {
        setJobs((prev) => {
          nextJob = prev.find((j) => j.stage === "queued");
          return prev;
        });
        // Small delay to let state settle
        setTimeout(resolve, 50);
      });

      if (!nextJob) break;
      const job = nextJob;

      try {
        // Step 1: Load image to canvas
        updateJob(job.clientId, {
          stage: "uploading",
          progress: "Loading image...",
        });

        const url = URL.createObjectURL(job.file);
        const img = new Image();
        img.src = url;
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
        });

        const maxDim = 1024;
        let w = img.width;
        let h = img.height;
        if (w > maxDim || h > maxDim) {
          const scale = maxDim / Math.max(w, h);
          w = Math.round(w * scale);
          h = Math.round(h * scale);
        }

        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, 0, 0, w, h);
        const originalImageData = ctx.getImageData(0, 0, w, h);
        const originalDataUrl = canvas.toDataURL("image/jpeg", 0.9);
        URL.revokeObjectURL(url);

        updateJob(job.clientId, {
          originalDataUrl,
          originalImageData,
          width: w,
          height: h,
          progress: "Uploading to server...",
        });

        // Step 2: Upload to server
        let serverId: string | undefined;
        try {
          const formData = new FormData();
          formData.append("file", job.file);
          formData.append("width", w.toString());
          formData.append("height", h.toString());
          const res = await fetch("/api/images", {
            method: "POST",
            body: formData,
          });
          if (res.ok) {
            const data = await res.json();
            serverId = data.id;
            updateJob(job.clientId, { serverId });
          }
        } catch {
          // Non-critical
        }

        // Step 3: Run depth estimation
        updateJob(job.clientId, {
          stage: "depth",
          progress: cachedEstimator
            ? "Running depth estimation..."
            : "Loading AI depth model (~25MB first time)...",
        });

        if (!cachedEstimator) {
          const { pipeline, env } = await import("@xenova/transformers");
          env.allowLocalModels = false;
          cachedEstimator = await pipeline(
            "depth-estimation",
            "Xenova/depth-anything-small-hf"
          );
        }

        updateJob(job.clientId, { progress: "Running depth estimation..." });

        const rawResult = await cachedEstimator(originalDataUrl);
        const result = Array.isArray(rawResult) ? rawResult[0] : rawResult;

        const depthTensor = result.predicted_depth;
        const depthData = Array.from(
          depthTensor.data as Float32Array
        ) as number[];
        const depthWidth = depthTensor.dims[1] as number;
        const depthHeight = depthTensor.dims[0] as number;

        const dr: DepthResult = { depthData, depthWidth, depthHeight };
        const depthDataUrl = renderDepthMap(dr);
        const anaglyphDataUrl = renderAnaglyph(
          originalImageData,
          dr,
          job.intensity
        );

        updateJob(job.clientId, {
          stage: "done",
          progress: "",
          depthResult: dr,
          depthDataUrl,
          anaglyphDataUrl,
        });

        // Step 4: Auto-save results
        if (serverId) {
          try {
            await saveResults(
              serverId,
              anaglyphDataUrl,
              depthDataUrl,
              job.intensity
            );
          } catch {
            // Non-critical
          }
        }
      } catch (err) {
        console.error("Processing failed:", err);
        updateJob(job.clientId, {
          stage: "error",
          error: err instanceof Error ? err.message : "Unknown error",
          progress: "",
        });
      }
    }

    processingRef.current = false;
  }, [updateJob]);

  // Trigger queue processing when new jobs are added
  useEffect(() => {
    const hasQueued = jobs.some((j) => j.stage === "queued");
    if (hasQueued && !processingRef.current) {
      processQueue();
    }
  }, [jobs, processQueue]);

  const handleFiles = (files: FileList | File[]) => {
    const newJobs: ImageJob[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;
      newJobs.push({
        clientId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        stage: "queued",
        progress: "Waiting...",
        intensity: globalIntensity,
        width: 0,
        height: 0,
      });
    }
    if (newJobs.length === 0) return;

    setJobs((prev) => [...prev, ...newJobs]);
    if (!selectedJob) setSelectedJob(newJobs[0].clientId);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    handleFiles(e.dataTransfer.files);
  };

  const handleIntensityChange = (clientId: string, newIntensity: number) => {
    setJobs((prev) =>
      prev.map((j) => {
        if (j.clientId !== clientId || !j.depthResult || !j.originalImageData)
          return j;
        const anaglyphDataUrl = renderAnaglyph(
          j.originalImageData,
          j.depthResult,
          newIntensity
        );
        return { ...j, intensity: newIntensity, anaglyphDataUrl };
      })
    );
  };

  const handleDownload = (job: ImageJob) => {
    if (!job.anaglyphDataUrl) return;
    const link = document.createElement("a");
    link.download = `3d-${job.file.name.replace(/\.[^.]+$/, "")}.png`;
    link.href = job.anaglyphDataUrl;
    link.click();
  };

  const handleDownloadAll = () => {
    const doneJobs = jobs.filter((j) => j.stage === "done");
    for (const job of doneJobs) {
      handleDownload(job);
    }
  };

  const removeJob = (clientId: string) => {
    setJobs((prev) => prev.filter((j) => j.clientId !== clientId));
    if (selectedJob === clientId) {
      setSelectedJob(
        jobs.find((j) => j.clientId !== clientId)?.clientId || null
      );
    }
  };

  const active = jobs.find((j) => j.clientId === selectedJob) || null;
  const doneCount = jobs.filter((j) => j.stage === "done").length;
  const processingJob = jobs.find(
    (j) => j.stage === "uploading" || j.stage === "depth"
  );
  const queuedCount = jobs.filter((j) => j.stage === "queued").length;

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-8">
      <header className="text-center mb-8">
        <h1 className="text-4xl font-bold mb-2">3D Image Generator</h1>
        <p className="text-gray-400">
          Upload photos &rarr; AI estimates depth &rarr; anaglyph 3D images
        </p>
        <p className="text-sm text-gray-500 mt-1">
          Wear red/cyan 3D glasses to see the effect! Results auto-save online.
        </p>
      </header>

      {/* Upload Area - always visible */}
      <div
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl text-center cursor-pointer
                   hover:border-cyan-500 hover:bg-gray-900/50 transition-all mb-6
                   ${jobs.length === 0 ? "p-16 border-gray-600" : "p-6 border-gray-700"}`}
      >
        {jobs.length === 0 ? (
          <>
            <div className="text-6xl mb-4">📸</div>
            <p className="text-xl text-gray-300 mb-2">
              Drop images here or click to upload
            </p>
            <p className="text-sm text-gray-500">
              Upload multiple photos at once — JPG, PNG, WebP
            </p>
          </>
        ) : (
          <p className="text-gray-400">
            + Drop more images or click to add
          </p>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {/* Processing Status */}
      {(processingJob || queuedCount > 0) && (
        <div className="flex items-center gap-3 mb-6 bg-gray-900 rounded-lg p-4">
          <div className="w-5 h-5 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-gray-300">
            {processingJob?.progress || "Processing..."}
          </span>
          {queuedCount > 0 && (
            <span className="text-gray-500 ml-auto">
              {queuedCount} in queue
            </span>
          )}
        </div>
      )}

      {/* Results */}
      {jobs.length > 0 && (
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Thumbnail sidebar */}
          <div className="lg:w-48 flex lg:flex-col gap-2 overflow-x-auto lg:overflow-y-auto lg:max-h-[80vh]">
            {jobs.map((job) => (
              <button
                key={job.clientId}
                onClick={() => setSelectedJob(job.clientId)}
                className={`relative flex-shrink-0 w-20 h-20 lg:w-full lg:h-auto lg:aspect-square
                           rounded-lg overflow-hidden border-2 transition-all
                           ${selectedJob === job.clientId ? "border-cyan-500" : "border-gray-700 hover:border-gray-500"}`}
              >
                {job.originalDataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={job.originalDataUrl}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-gray-800 flex items-center justify-center">
                    <div className="w-4 h-4 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
                  </div>
                )}
                {/* Status badge */}
                <div className="absolute bottom-1 right-1">
                  {job.stage === "done" && (
                    <span className="w-3 h-3 block bg-green-500 rounded-full" />
                  )}
                  {job.stage === "error" && (
                    <span className="w-3 h-3 block bg-red-500 rounded-full" />
                  )}
                  {(job.stage === "uploading" ||
                    job.stage === "depth" ||
                    job.stage === "queued") && (
                    <span className="w-3 h-3 block bg-yellow-500 rounded-full animate-pulse" />
                  )}
                </div>
              </button>
            ))}
          </div>

          {/* Main viewer */}
          <div className="flex-1 min-w-0">
            {active && active.stage === "done" && (
              <div className="space-y-4">
                {/* Controls */}
                <div className="flex flex-wrap items-center justify-between gap-4 bg-gray-900 rounded-xl p-4">
                  <div className="flex items-center gap-4 flex-1 min-w-[200px]">
                    <label className="text-sm text-gray-400 whitespace-nowrap">
                      3D Intensity
                    </label>
                    <input
                      type="range"
                      min="1"
                      max="40"
                      value={active.intensity}
                      onChange={(e) =>
                        handleIntensityChange(
                          active.clientId,
                          parseInt(e.target.value)
                        )
                      }
                      className="flex-1 accent-cyan-500"
                    />
                    <span className="text-sm text-cyan-400 w-8">
                      {active.intensity}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleDownload(active)}
                      className="px-3 py-2 bg-cyan-600 hover:bg-cyan-700 rounded-lg text-sm font-medium transition"
                    >
                      Download
                    </button>
                    {doneCount > 1 && (
                      <button
                        onClick={handleDownloadAll}
                        className="px-3 py-2 bg-cyan-800 hover:bg-cyan-700 rounded-lg text-sm font-medium transition"
                      >
                        Download All ({doneCount})
                      </button>
                    )}
                    <button
                      onClick={() => removeJob(active.clientId)}
                      className="px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm font-medium transition"
                    >
                      Remove
                    </button>
                  </div>
                </div>

                {/* Image Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <h3 className="text-sm font-medium text-gray-400 mb-2">
                      Original
                    </h3>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={active.originalDataUrl}
                      alt="Original"
                      className="w-full rounded-lg border border-gray-800"
                    />
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-gray-400 mb-2">
                      Depth Map
                    </h3>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={active.depthDataUrl}
                      alt="Depth Map"
                      className="w-full rounded-lg border border-gray-800"
                    />
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-gray-400 mb-2">
                      Anaglyph 3D
                    </h3>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={active.anaglyphDataUrl}
                      alt="Anaglyph 3D"
                      className="w-full rounded-lg border border-gray-800"
                    />
                  </div>
                </div>

                {active.serverId && (
                  <p className="text-xs text-green-600 text-center">
                    Saved online automatically
                  </p>
                )}
              </div>
            )}

            {active && active.stage === "error" && (
              <div className="bg-red-900/30 border border-red-800 rounded-xl p-8 text-center">
                <p className="text-red-400 mb-2">Processing failed</p>
                <p className="text-sm text-red-500">{active.error}</p>
                <button
                  onClick={() => removeJob(active.clientId)}
                  className="mt-4 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm transition"
                >
                  Remove
                </button>
              </div>
            )}

            {active &&
              (active.stage === "queued" ||
                active.stage === "uploading" ||
                active.stage === "depth") && (
                <div className="text-center py-16">
                  <div className="inline-block w-12 h-12 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mb-4" />
                  <p className="text-lg text-gray-300">{active.progress}</p>
                  {active.originalDataUrl && (
                    <div className="mt-6 max-w-sm mx-auto">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={active.originalDataUrl}
                        alt=""
                        className="w-full rounded-lg border border-gray-800 opacity-50"
                      />
                    </div>
                  )}
                </div>
              )}

            {!active && jobs.length > 0 && (
              <div className="text-center py-16 text-gray-500">
                Select an image from the sidebar
              </div>
            )}
          </div>
        </div>
      )}

      {/* Global intensity for new uploads */}
      {jobs.length > 0 && (
        <div className="mt-6 flex items-center gap-3 text-sm text-gray-500">
          <span>Default intensity for new uploads:</span>
          <input
            type="range"
            min="1"
            max="40"
            value={globalIntensity}
            onChange={(e) => setGlobalIntensity(parseInt(e.target.value))}
            className="w-32 accent-gray-500"
          />
          <span>{globalIntensity}</span>
        </div>
      )}
    </div>
  );
}
