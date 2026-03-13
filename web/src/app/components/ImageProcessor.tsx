"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { generateAnaglyph } from "@/lib/anaglyph";

interface DepthData {
  data: Float32Array;
  width: number;
  height: number;
}

interface ImageJob {
  clientId: string;
  serverId?: string;
  fileName: string;
  stage: "queued" | "processing" | "done" | "error";
  originalUrl: string; // blob URL — instant, no encoding
  depthUrl?: string; // blob URL of depth map
  depthData?: DepthData;
  originalImageData?: ImageData;
  intensity: number;
  width: number;
  height: number;
  error?: string;
}

// ── Depth map → blob URL (offscreen canvas → blob → URL) ──
function renderDepthBlob(d: DepthData): Promise<string> {
  const c = document.createElement("canvas");
  c.width = d.width;
  c.height = d.height;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(d.width, d.height);

  let lo = Infinity,
    hi = -Infinity;
  for (let i = 0; i < d.data.length; i++) {
    if (d.data[i] < lo) lo = d.data[i];
    if (d.data[i] > hi) hi = d.data[i];
  }
  const range = hi - lo || 1;
  for (let i = 0; i < d.data.length; i++) {
    const v = ((d.data[i] - lo) / range) * 255;
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return new Promise((r) => c.toBlob((b) => r(URL.createObjectURL(b!)), "image/png"));
}

export default function ImageProcessor() {
  const [jobs, setJobs] = useState<ImageJob[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [globalIntensity, setGlobalIntensity] = useState(10);
  const [modelStatus, setModelStatus] = useState<
    "idle" | "loading" | "ready"
  >("idle");
  const [modelProgress, setModelProgress] = useState(0);

  const workerRef = useRef<Worker | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const processingRef = useRef(false);
  const rafRef = useRef(0);

  // Pending depth requests: id → { imageData, jpegBlob }
  const pendingRef = useRef<
    Map<string, { imageData: ImageData; w: number; h: number; jpegBlob: Blob }>
  >(new Map());

  // Stable ref so worker callback can read latest jobs
  const jobsRef = useRef(jobs);
  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);

  // ── Worker init + model preload ──
  useEffect(() => {
    const w = new Worker("/depth-worker.js", { type: "module" });
    workerRef.current = w;
    setModelStatus("loading");

    w.onmessage = (e) => {
      const m = e.data;
      if (m.type === "model-progress" && m.status === "progress") {
        setModelProgress(Math.round(m.progress ?? 0));
      } else if (m.type === "model-ready") {
        setModelStatus("ready");
      } else if (m.type === "depth-result") {
        onDepthResult(m.id, m.depthData, m.depthWidth, m.depthHeight);
      } else if (m.type === "error") {
        setJobs((p) =>
          p.map((j) =>
            j.clientId === m.id
              ? { ...j, stage: "error", error: m.error }
              : j
          )
        );
        processingRef.current = false;
      }
    };

    return () => w.terminate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Queue: pick next queued job whenever state changes ──
  useEffect(() => {
    if (processingRef.current) return;
    const next = jobs.find((j) => j.stage === "queued");
    if (next) runJob(next.clientId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs]);

  // ── Draw anaglyph on canvas when selection / job state changes ──
  const drawAnaglyph = useCallback(
    (job: ImageJob, forceIntensity?: number) => {
      const cv = canvasRef.current;
      if (!cv || !job.originalImageData || !job.depthData) return;
      cv.width = job.width;
      cv.height = job.height;
      const out = generateAnaglyph(
        job.originalImageData,
        job.depthData.data,
        job.depthData.width,
        job.depthData.height,
        forceIntensity ?? job.intensity
      );
      cv.getContext("2d")!.putImageData(out, 0, 0);
    },
    []
  );

  useEffect(() => {
    if (!selectedId) return;
    const j = jobs.find((x) => x.clientId === selectedId);
    if (j?.stage === "done") drawAnaglyph(j);
  }, [selectedId, jobs, drawAnaglyph]);

  // ── Process a single job ──
  async function runJob(clientId: string) {
    processingRef.current = true;
    setJobs((p) =>
      p.map((j) =>
        j.clientId === clientId ? { ...j, stage: "processing" } : j
      )
    );

    try {
      const job = jobsRef.current.find((j) => j.clientId === clientId)!;

      // Fast image load via createImageBitmap
      const fileBlob = await fetch(job.originalUrl).then((r) => r.blob());
      const bmp = await createImageBitmap(fileBlob);

      const maxDim = 1024;
      let w = bmp.width,
        h = bmp.height;
      if (w > maxDim || h > maxDim) {
        const s = maxDim / Math.max(w, h);
        w = Math.round(w * s);
        h = Math.round(h * s);
      }

      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(bmp, 0, 0, w, h);
      bmp.close();
      const imageData = ctx.getImageData(0, 0, w, h);

      // JPEG blob for worker (fast — no data URL base64)
      const jpegBlob: Blob = await new Promise((r) =>
        c.toBlob((b) => r(b!), "image/jpeg", 0.85)
      );
      const buffer = await jpegBlob.arrayBuffer();

      // Stash processing data for finishJob
      pendingRef.current.set(clientId, { imageData, w, h, jpegBlob });

      setJobs((p) =>
        p.map((j) =>
          j.clientId === clientId
            ? { ...j, originalImageData: imageData, width: w, height: h }
            : j
        )
      );

      // Upload original to server (fire & forget)
      uploadOriginal(clientId, job.fileName, w, h, jpegBlob);

      // Send to depth worker (transferring buffer — zero copy)
      workerRef.current!.postMessage(
        { type: "estimate", id: clientId, imageBuffer: buffer },
        [buffer]
      );
    } catch (err) {
      setJobs((p) =>
        p.map((j) =>
          j.clientId === clientId
            ? { ...j, stage: "error", error: (err as Error).message }
            : j
        )
      );
      processingRef.current = false;
    }
  }

  // ── Worker returned depth data ──
  async function onDepthResult(
    id: string,
    depthBuf: ArrayBuffer,
    dw: number,
    dh: number
  ) {
    const dd: DepthData = { data: new Float32Array(depthBuf), width: dw, height: dh };
    const depthUrl = await renderDepthBlob(dd);

    setJobs((p) =>
      p.map((j) =>
        j.clientId === id
          ? { ...j, stage: "done", depthData: dd, depthUrl }
          : j
      )
    );
    processingRef.current = false;

    // Auto-save (background)
    const pending = pendingRef.current.get(id);
    const job = jobsRef.current.find((j) => j.clientId === id);
    if (job?.serverId && pending) {
      autoSave(job.serverId, pending.imageData, dd, job.intensity, depthUrl);
    }
    pendingRef.current.delete(id);
  }

  // ── Server upload (non-blocking) ──
  async function uploadOriginal(
    clientId: string,
    fileName: string,
    w: number,
    h: number,
    blob: Blob
  ) {
    try {
      const fd = new FormData();
      fd.append("file", blob, fileName);
      fd.append("width", w.toString());
      fd.append("height", h.toString());
      const res = await fetch("/api/images", { method: "POST", body: fd });
      if (res.ok) {
        const data = await res.json();
        setJobs((p) =>
          p.map((j) =>
            j.clientId === clientId ? { ...j, serverId: data.id } : j
          )
        );
      }
    } catch {
      /* non-critical */
    }
  }

  async function autoSave(
    serverId: string,
    imageData: ImageData,
    depth: DepthData,
    intensity: number,
    depthUrl: string
  ) {
    try {
      // Generate anaglyph blob
      const anaResult = generateAnaglyph(
        imageData,
        depth.data,
        depth.width,
        depth.height,
        intensity
      );
      const c = document.createElement("canvas");
      c.width = imageData.width;
      c.height = imageData.height;
      c.getContext("2d")!.putImageData(anaResult, 0, 0);
      const anaBlob: Blob = await new Promise((r) =>
        c.toBlob((b) => r(b!), "image/png")
      );

      const depthBlob = await fetch(depthUrl).then((r) => r.blob());

      const fd = new FormData();
      fd.append("anaglyph", anaBlob, "anaglyph.png");
      fd.append("depthMap", depthBlob, "depth.png");
      fd.append("intensity", intensity.toString());
      await fetch(`/api/images/${serverId}/save-results`, {
        method: "POST",
        body: fd,
      });
    } catch {
      /* non-critical */
    }
  }

  // ── Handlers ──
  function handleFiles(files: FileList | File[]) {
    const newJobs: ImageJob[] = [];
    for (const f of Array.from(files)) {
      if (!f.type.startsWith("image/")) continue;
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      newJobs.push({
        clientId: id,
        fileName: f.name,
        stage: "queued",
        originalUrl: URL.createObjectURL(f), // instant — no encoding
        intensity: globalIntensity,
        width: 0,
        height: 0,
      });
    }
    if (!newJobs.length) return;
    setJobs((p) => [...p, ...newJobs]);
    if (!selectedId) setSelectedId(newJobs[0].clientId);
  }

  function handleIntensityChange(clientId: string, val: number) {
    setJobs((p) =>
      p.map((j) => (j.clientId === clientId ? { ...j, intensity: val } : j))
    );
    // Debounce canvas redraw to next frame
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const j = jobsRef.current.find((x) => x.clientId === clientId);
      if (j?.stage === "done") drawAnaglyph(j, val);
    });
  }

  function handleDownload(job: ImageJob) {
    const cv = canvasRef.current;
    if (!cv || !job.originalImageData || !job.depthData) return;
    // Make sure canvas has this job's anaglyph
    drawAnaglyph(job);
    cv.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement("a");
      a.download = `3d-${job.fileName.replace(/\.[^.]+$/, "")}.png`;
      a.href = URL.createObjectURL(blob);
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }, "image/png");
  }

  function handleDownloadAll() {
    jobs
      .filter((j) => j.stage === "done")
      .forEach((j, i) => setTimeout(() => handleDownload(j), i * 200));
  }

  function removeJob(id: string) {
    const job = jobs.find((j) => j.clientId === id);
    if (job) URL.revokeObjectURL(job.originalUrl);
    if (job?.depthUrl) URL.revokeObjectURL(job.depthUrl);
    setJobs((p) => p.filter((j) => j.clientId !== id));
    if (selectedId === id) {
      const remaining = jobs.filter((j) => j.clientId !== id);
      setSelectedId(remaining[0]?.clientId ?? null);
    }
  }

  // ── Derived state ──
  const active = jobs.find((j) => j.clientId === selectedId);
  const doneCount = jobs.filter((j) => j.stage === "done").length;
  const processing = jobs.find(
    (j) => j.stage === "processing" || j.stage === "queued"
  );
  const queuedCount = jobs.filter((j) => j.stage === "queued").length;

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-8">
      {/* Header */}
      <header className="text-center mb-6">
        <h1 className="text-4xl font-bold mb-1">3D Image Generator</h1>
        <p className="text-gray-400 text-sm">
          Upload photos &rarr; AI depth estimation &rarr; anaglyph 3D
          &nbsp;|&nbsp; Wear red/cyan glasses!
        </p>
      </header>

      {/* Model loading bar */}
      {modelStatus === "loading" && (
        <div className="mb-4 bg-gray-900 rounded-lg p-3">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-4 h-4 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-gray-300">
              Loading AI model... {modelProgress}%
            </span>
          </div>
          <div className="h-1 bg-gray-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-cyan-500 rounded-full transition-all duration-300"
              style={{ width: `${modelProgress}%` }}
            />
          </div>
        </div>
      )}
      {modelStatus === "ready" && jobs.length === 0 && (
        <div className="mb-4 text-center text-sm text-green-500">
          AI model loaded &mdash; ready to process
        </div>
      )}

      {/* Upload area */}
      <div
        onDrop={(e) => {
          e.preventDefault();
          handleFiles(e.dataTransfer.files);
        }}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl text-center cursor-pointer select-none
                   hover:border-cyan-500 hover:bg-gray-900/50 transition-all mb-5
                   ${jobs.length === 0 ? "p-14 border-gray-600" : "p-4 border-gray-700"}`}
      >
        {jobs.length === 0 ? (
          <>
            <div className="text-5xl mb-3 opacity-80">📸</div>
            <p className="text-lg text-gray-300 mb-1">
              Drop images here or click to upload
            </p>
            <p className="text-xs text-gray-500">
              Multiple images at once &mdash; JPG, PNG, WebP
            </p>
          </>
        ) : (
          <p className="text-sm text-gray-400">
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

      {/* Processing banner */}
      {processing && (
        <div className="flex items-center gap-3 mb-5 bg-gray-900/80 rounded-lg px-4 py-3">
          <div className="w-4 h-4 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
          <span className="text-sm text-gray-300 truncate">
            Processing {processing.fileName}...
          </span>
          {queuedCount > 0 && (
            <span className="ml-auto text-xs text-gray-500 flex-shrink-0">
              +{queuedCount} queued
            </span>
          )}
        </div>
      )}

      {/* Main content */}
      {jobs.length > 0 && (
        <div className="flex flex-col lg:flex-row gap-5">
          {/* Thumbnails */}
          <div className="lg:w-44 flex lg:flex-col gap-2 overflow-x-auto lg:overflow-y-auto lg:max-h-[80vh] pb-2 lg:pb-0">
            {jobs.map((job) => (
              <button
                key={job.clientId}
                onClick={() => setSelectedId(job.clientId)}
                className={`relative flex-shrink-0 w-16 h-16 lg:w-full lg:h-auto lg:aspect-square
                           rounded-lg overflow-hidden border-2 transition-all duration-150
                           ${
                             selectedId === job.clientId
                               ? "border-cyan-500 ring-1 ring-cyan-500/30"
                               : "border-gray-700 hover:border-gray-500"
                           }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={job.originalUrl}
                  alt=""
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
                <div className="absolute bottom-0.5 right-0.5">
                  {job.stage === "done" && (
                    <span className="block w-2.5 h-2.5 bg-green-500 rounded-full shadow" />
                  )}
                  {job.stage === "error" && (
                    <span className="block w-2.5 h-2.5 bg-red-500 rounded-full shadow" />
                  )}
                  {(job.stage === "processing" || job.stage === "queued") && (
                    <span className="block w-2.5 h-2.5 bg-yellow-400 rounded-full animate-pulse shadow" />
                  )}
                </div>
              </button>
            ))}
          </div>

          {/* Viewer */}
          <div className="flex-1 min-w-0">
            {active?.stage === "done" && (
              <div className="space-y-4">
                {/* Controls */}
                <div className="flex flex-wrap items-center gap-4 bg-gray-900 rounded-xl p-3">
                  <div className="flex items-center gap-3 flex-1 min-w-[180px]">
                    <label className="text-xs text-gray-400 whitespace-nowrap">
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
                      className="flex-1 accent-cyan-500 h-1.5"
                    />
                    <span className="text-xs text-cyan-400 w-6 text-right tabular-nums">
                      {active.intensity}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleDownload(active)}
                      className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-xs font-medium transition-colors"
                    >
                      Download
                    </button>
                    {doneCount > 1 && (
                      <button
                        onClick={handleDownloadAll}
                        className="px-3 py-1.5 bg-cyan-800 hover:bg-cyan-700 rounded-lg text-xs font-medium transition-colors"
                      >
                        All ({doneCount})
                      </button>
                    )}
                    <button
                      onClick={() => removeJob(active.clientId)}
                      className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-xs font-medium transition-colors"
                    >
                      Remove
                    </button>
                  </div>
                </div>

                {/* Images */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <h3 className="text-xs font-medium text-gray-500 mb-1">
                      Original
                    </h3>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={active.originalUrl}
                      alt="Original"
                      className="w-full rounded-lg border border-gray-800"
                    />
                  </div>
                  <div>
                    <h3 className="text-xs font-medium text-gray-500 mb-1">
                      Depth Map
                    </h3>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={active.depthUrl}
                      alt="Depth"
                      className="w-full rounded-lg border border-gray-800"
                    />
                  </div>
                  <div>
                    <h3 className="text-xs font-medium text-gray-500 mb-1">
                      Anaglyph 3D
                    </h3>
                    <canvas
                      ref={canvasRef}
                      className="w-full rounded-lg border border-gray-800"
                      style={{ imageRendering: "auto" }}
                    />
                  </div>
                </div>

                {active.serverId && (
                  <p className="text-[10px] text-green-600/70 text-center">
                    Saved online
                  </p>
                )}
              </div>
            )}

            {active?.stage === "error" && (
              <div className="bg-red-950/40 border border-red-900 rounded-xl p-8 text-center">
                <p className="text-red-400 text-sm mb-1">Processing failed</p>
                <p className="text-xs text-red-500/70">{active.error}</p>
                <button
                  onClick={() => removeJob(active.clientId)}
                  className="mt-3 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-xs transition-colors"
                >
                  Remove
                </button>
              </div>
            )}

            {active &&
              (active.stage === "queued" || active.stage === "processing") && (
                <div className="text-center py-12">
                  <div className="inline-block w-10 h-10 border-3 border-cyan-500 border-t-transparent rounded-full animate-spin mb-3" />
                  <p className="text-sm text-gray-400">
                    {active.stage === "queued"
                      ? "Waiting in queue..."
                      : "Estimating depth..."}
                  </p>
                  {active.originalUrl && (
                    <div className="mt-4 max-w-xs mx-auto opacity-40">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={active.originalUrl}
                        alt=""
                        className="w-full rounded-lg"
                      />
                    </div>
                  )}
                </div>
              )}

            {!active && (
              <div className="text-center py-12 text-gray-600 text-sm">
                Select an image
              </div>
            )}
          </div>
        </div>
      )}

      {/* Default intensity for new uploads */}
      {jobs.length > 0 && (
        <div className="mt-4 flex items-center gap-2 text-xs text-gray-600">
          <span>Default intensity:</span>
          <input
            type="range"
            min="1"
            max="40"
            value={globalIntensity}
            onChange={(e) => setGlobalIntensity(parseInt(e.target.value))}
            className="w-24 accent-gray-600 h-1"
          />
          <span className="tabular-nums">{globalIntensity}</span>
        </div>
      )}
    </div>
  );
}
