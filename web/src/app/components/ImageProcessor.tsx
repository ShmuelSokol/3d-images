"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { generateAnaglyph } from "@/lib/anaglyph";
import {
  processVideo,
  type DepthData,
  type VideoProgress,
} from "@/lib/video-processor";

// ── Types ──

interface ImageJob {
  clientId: string;
  serverId?: string;
  fileName: string;
  kind: "image";
  stage: "queued" | "processing" | "done" | "error";
  originalUrl: string;
  depthUrl?: string;
  depthData?: DepthData;
  originalImageData?: ImageData;
  intensity: number;
  width: number;
  height: number;
  error?: string;
}

interface VideoJob {
  clientId: string;
  serverId?: string;
  fileName: string;
  kind: "video";
  stage: "queued" | "processing" | "done" | "error";
  file: File;
  thumbnailUrl?: string;
  originalUrl: string;
  resultUrl?: string;
  progress?: VideoProgress;
  error?: string;
}

type Job = ImageJob | VideoJob;
type Quality = "fast" | "hd";

const MODELS: Record<Quality, string> = {
  fast: "Xenova/depth-anything-small-hf",
  hd: "Xenova/depth-anything-base-hf",
};

// ── Helpers ──

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
  const r = hi - lo || 1;
  for (let i = 0; i < d.data.length; i++) {
    const v = ((d.data[i] - lo) / r) * 255;
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return new Promise((res) =>
    c.toBlob((b) => res(URL.createObjectURL(b!)), "image/png")
  );
}

async function captureVideoThumbnail(url: string): Promise<string> {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.src = url;
  await new Promise<void>((r, rej) => {
    video.onloadeddata = () => r();
    video.onerror = () => rej(new Error("video load failed"));
  });
  video.currentTime = 0.5;
  await new Promise<void>((r) => {
    video.onseeked = () => r();
  });
  const c = document.createElement("canvas");
  const scale = 200 / Math.max(video.videoWidth, video.videoHeight);
  c.width = Math.round(video.videoWidth * scale);
  c.height = Math.round(video.videoHeight * scale);
  c.getContext("2d")!.drawImage(video, 0, 0, c.width, c.height);
  return new Promise((r) =>
    c.toBlob((b) => r(URL.createObjectURL(b!)), "image/jpeg", 0.7)
  );
}

// ── Component ──

export default function ImageProcessor() {
  const [imageJobs, setImageJobs] = useState<ImageJob[]>([]);
  const [videoJobs, setVideoJobs] = useState<VideoJob[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [quality, setQuality] = useState<Quality>("hd");
  const [globalIntensity, setGlobalIntensity] = useState(10);
  const [modelStatus, setModelStatus] = useState<
    "idle" | "loading" | "ready"
  >("idle");
  const [modelProgress, setModelProgress] = useState(0);
  const [zipping, setZipping] = useState(false);

  const workerRef = useRef<Worker | null>(null);
  const callbacksRef = useRef<
    Map<
      string,
      { resolve: (d: DepthData) => void; reject: (e: Error) => void }
    >
  >(new Map());
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const processingRef = useRef(false);
  const rafRef = useRef(0);
  const pendingRef = useRef<Map<string, ImageData>>(new Map());
  const imageJobsRef = useRef(imageJobs);
  const videoJobsRef = useRef(videoJobs);
  const qualityRef = useRef(quality);
  const videoAbortRef = useRef<Map<string, AbortController>>(new Map());

  useEffect(() => {
    imageJobsRef.current = imageJobs;
  }, [imageJobs]);
  useEffect(() => {
    videoJobsRef.current = videoJobs;
  }, [videoJobs]);
  useEffect(() => {
    qualityRef.current = quality;
  }, [quality]);

  // ── Promise-based worker API ──
  const estimate = useCallback(
    (buffer: ArrayBuffer, id: string, model: string): Promise<DepthData> => {
      return new Promise((resolve, reject) => {
        callbacksRef.current.set(id, { resolve, reject });
        workerRef.current!.postMessage(
          { type: "estimate", id, imageBuffer: buffer, model },
          [buffer]
        );
      });
    },
    []
  );

  // ── Worker init ──
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
        const cb = callbacksRef.current.get(m.id);
        if (cb) {
          callbacksRef.current.delete(m.id);
          cb.resolve({
            data: new Float32Array(m.depthData),
            width: m.depthWidth,
            height: m.depthHeight,
          });
        }
      } else if (m.type === "error") {
        const cb = callbacksRef.current.get(m.id);
        if (cb) {
          callbacksRef.current.delete(m.id);
          cb.reject(new Error(m.error));
        }
        setImageJobs((p) =>
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

  useEffect(() => {
    workerRef.current?.postMessage({
      type: "set-model",
      model: MODELS[quality],
    });
  }, [quality]);

  // ── Unified queue: images first, then videos ──
  useEffect(() => {
    if (processingRef.current) return;

    const nextImg = imageJobs.find((j) => j.stage === "queued");
    if (nextImg) {
      runImageJob(nextImg.clientId);
      return;
    }

    const nextVid = videoJobs.find((v) => v.stage === "queued");
    if (nextVid) {
      runVideoJob(nextVid.clientId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageJobs, videoJobs]);

  // ── Draw anaglyph on canvas ──
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

  const selected = selectedId
    ? (imageJobs.find((j) => j.clientId === selectedId) as Job | undefined) ??
      videoJobs.find((v) => v.clientId === selectedId)
    : null;

  useEffect(() => {
    if (selected?.kind === "image" && selected.stage === "done") {
      drawAnaglyph(selected);
    }
  }, [selectedId, selected, drawAnaglyph]);

  // ── Process image ──
  async function runImageJob(clientId: string) {
    processingRef.current = true;
    setImageJobs((p) =>
      p.map((j) =>
        j.clientId === clientId ? { ...j, stage: "processing" } : j
      )
    );

    try {
      const job = imageJobsRef.current.find((j) => j.clientId === clientId)!;
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
      c.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
      bmp.close();
      const imageData = c.getContext("2d")!.getImageData(0, 0, w, h);
      pendingRef.current.set(clientId, imageData);

      const jpegBlob: Blob = await new Promise((r) =>
        c.toBlob((b) => r(b!), "image/jpeg", 0.85)
      );
      const buffer = await jpegBlob.arrayBuffer();

      setImageJobs((p) =>
        p.map((j) =>
          j.clientId === clientId
            ? { ...j, originalImageData: imageData, width: w, height: h }
            : j
        )
      );

      uploadOriginal(clientId, job.fileName, w, h, jpegBlob);

      const depth = await estimate(buffer, clientId, MODELS[qualityRef.current]);
      const depthUrl = await renderDepthBlob(depth);

      setImageJobs((p) =>
        p.map((j) =>
          j.clientId === clientId
            ? { ...j, stage: "done", depthData: depth, depthUrl }
            : j
        )
      );
      processingRef.current = false;

      const serverId = imageJobsRef.current.find(
        (j) => j.clientId === clientId
      )?.serverId;
      if (serverId)
        autoSaveImage(serverId, imageData, depth, job.intensity, depthUrl);
      pendingRef.current.delete(clientId);
    } catch (err) {
      setImageJobs((p) =>
        p.map((j) =>
          j.clientId === clientId
            ? { ...j, stage: "error", error: (err as Error).message }
            : j
        )
      );
      processingRef.current = false;
    }
  }

  // ── Process video ──
  async function runVideoJob(clientId: string) {
    processingRef.current = true;
    const abort = new AbortController();
    videoAbortRef.current.set(clientId, abort);

    setVideoJobs((p) =>
      p.map((v) =>
        v.clientId === clientId ? { ...v, stage: "processing" } : v
      )
    );

    try {
      const vj = videoJobsRef.current.find((v) => v.clientId === clientId)!;

      const resultBlob = await processVideo(
        vj.file,
        estimate,
        globalIntensity,
        MODELS[qualityRef.current],
        (progress) => {
          setVideoJobs((p) =>
            p.map((v) =>
              v.clientId === clientId ? { ...v, progress } : v
            )
          );
        },
        abort.signal
      );

      const resultUrl = URL.createObjectURL(resultBlob);

      setVideoJobs((p) =>
        p.map((v) =>
          v.clientId === clientId
            ? { ...v, stage: "done", resultUrl, progress: undefined }
            : v
        )
      );

      // Auto-save video result to server
      autoSaveVideo(clientId, vj.fileName, resultBlob);
    } catch (err) {
      if ((err as Error).message !== "Aborted") {
        setVideoJobs((p) =>
          p.map((v) =>
            v.clientId === clientId
              ? { ...v, stage: "error", error: (err as Error).message }
              : v
          )
        );
      }
    }

    videoAbortRef.current.delete(clientId);
    processingRef.current = false;
  }

  // ── Server helpers ──
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
        setImageJobs((p) =>
          p.map((j) =>
            j.clientId === clientId ? { ...j, serverId: data.id } : j
          )
        );
      }
    } catch {
      /* non-critical */
    }
  }

  async function autoSaveImage(
    serverId: string,
    imageData: ImageData,
    depth: DepthData,
    intensity: number,
    depthUrl: string
  ) {
    try {
      const ana = generateAnaglyph(
        imageData,
        depth.data,
        depth.width,
        depth.height,
        intensity
      );
      const c = document.createElement("canvas");
      c.width = imageData.width;
      c.height = imageData.height;
      c.getContext("2d")!.putImageData(ana, 0, 0);
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

  async function autoSaveVideo(
    clientId: string,
    fileName: string,
    resultBlob: Blob
  ) {
    try {
      // Upload original + result as a single form submission
      const fd = new FormData();
      fd.append("file", resultBlob, `3d-${fileName.replace(/\.[^.]+$/, "")}.webm`);
      fd.append("width", "720");
      fd.append("height", "480");
      const res = await fetch("/api/images", { method: "POST", body: fd });
      if (res.ok) {
        const data = await res.json();
        setVideoJobs((p) =>
          p.map((v) =>
            v.clientId === clientId ? { ...v, serverId: data.id } : v
          )
        );
      }
    } catch {
      /* non-critical */
    }
  }

  // ── Handlers ──
  async function handleFiles(files: FileList | File[]) {
    for (const f of Array.from(files)) {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const url = URL.createObjectURL(f);

      if (f.type.startsWith("video/")) {
        // Capture thumbnail from first frame
        let thumbnailUrl: string | undefined;
        try {
          thumbnailUrl = await captureVideoThumbnail(url);
        } catch {
          /* use fallback */
        }

        setVideoJobs((p) => [
          ...p,
          {
            clientId: id,
            fileName: f.name,
            kind: "video",
            stage: "queued",
            file: f,
            originalUrl: url,
            thumbnailUrl,
          },
        ]);
        setSelectedId(id);
      } else if (f.type.startsWith("image/")) {
        setImageJobs((p) => [
          ...p,
          {
            clientId: id,
            fileName: f.name,
            kind: "image",
            stage: "queued",
            originalUrl: url,
            intensity: globalIntensity,
            width: 0,
            height: 0,
          },
        ]);
        if (!selectedId) setSelectedId(id);
      }
    }
  }

  function handleIntensityChange(clientId: string, val: number) {
    setImageJobs((p) =>
      p.map((j) => (j.clientId === clientId ? { ...j, intensity: val } : j))
    );
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const j = imageJobsRef.current.find((x) => x.clientId === clientId);
      if (j?.stage === "done") drawAnaglyph(j, val);
    });
  }

  function handleDownloadImage(job: ImageJob) {
    const cv = canvasRef.current;
    if (!cv || !job.originalImageData || !job.depthData) return;
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

  async function handleDownloadAll() {
    const doneJobs = imageJobs.filter((j) => j.stage === "done");
    if (doneJobs.length === 0) return;
    setZipping(true);
    try {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      for (const job of doneJobs) {
        if (!job.originalImageData || !job.depthData) continue;
        const ana = generateAnaglyph(
          job.originalImageData,
          job.depthData.data,
          job.depthData.width,
          job.depthData.height,
          job.intensity
        );
        const c = document.createElement("canvas");
        c.width = job.width;
        c.height = job.height;
        c.getContext("2d")!.putImageData(ana, 0, 0);
        const anaBlob: Blob = await new Promise((r) =>
          c.toBlob((b) => r(b!), "image/png")
        );
        zip.file(
          `${job.fileName.replace(/\.[^.]+$/, "")}-3d.png`,
          anaBlob
        );
        if (job.depthUrl) {
          const depthBlob = await fetch(job.depthUrl).then((r) => r.blob());
          zip.file(
            `${job.fileName.replace(/\.[^.]+$/, "")}-depth.png`,
            depthBlob
          );
        }
      }
      // Also include done videos
      for (const vj of videoJobs.filter((v) => v.stage === "done" && v.resultUrl)) {
        const videoBlob = await fetch(vj.resultUrl!).then((r) => r.blob());
        zip.file(
          `${vj.fileName.replace(/\.[^.]+$/, "")}-3d.webm`,
          videoBlob
        );
      }
      const blob = await zip.generateAsync({ type: "blob" });
      const a = document.createElement("a");
      a.download = "3d-results.zip";
      a.href = URL.createObjectURL(blob);
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (err) {
      console.error("ZIP failed:", err);
    } finally {
      setZipping(false);
    }
  }

  function removeJob(id: string) {
    const imgJob = imageJobs.find((j) => j.clientId === id);
    const vidJob = videoJobs.find((v) => v.clientId === id);

    if (imgJob) {
      URL.revokeObjectURL(imgJob.originalUrl);
      if (imgJob.depthUrl) URL.revokeObjectURL(imgJob.depthUrl);
      setImageJobs((p) => p.filter((j) => j.clientId !== id));
    }
    if (vidJob) {
      URL.revokeObjectURL(vidJob.originalUrl);
      if (vidJob.resultUrl) URL.revokeObjectURL(vidJob.resultUrl);
      if (vidJob.thumbnailUrl) URL.revokeObjectURL(vidJob.thumbnailUrl);
      const abort = videoAbortRef.current.get(id);
      if (abort) abort.abort();
      setVideoJobs((p) => p.filter((v) => v.clientId !== id));
    }

    if (selectedId === id) {
      const all = [...imageJobs, ...videoJobs].filter(
        (j) => j.clientId !== id
      );
      setSelectedId(all[0]?.clientId ?? null);
    }
  }

  // ── Derived ──
  const allJobs: Job[] = [
    ...imageJobs.map((j) => ({ ...j, kind: "image" as const })),
    ...videoJobs.map((v) => ({ ...v, kind: "video" as const })),
  ];
  const doneCount =
    imageJobs.filter((j) => j.stage === "done").length +
    videoJobs.filter((v) => v.stage === "done").length;
  const currentlyProcessing =
    imageJobs.find((j) => j.stage === "processing") ??
    videoJobs.find((v) => v.stage === "processing");
  const queuedCount =
    imageJobs.filter((j) => j.stage === "queued").length +
    videoJobs.filter((v) => v.stage === "queued").length;

  const activeImg =
    selected?.kind === "image" ? (selected as ImageJob) : null;
  const activeVid =
    selected?.kind === "video" ? (selected as VideoJob) : null;

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-8">
      {/* Header */}
      <header className="text-center mb-5">
        <h1 className="text-4xl font-bold mb-1">3D Image Generator</h1>
        <p className="text-gray-400 text-sm">
          Upload photos or videos &rarr; AI depth &rarr; anaglyph 3D
        </p>
      </header>

      {/* Model loading */}
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

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center bg-gray-900 rounded-lg p-0.5 text-xs">
          <button
            onClick={() => setQuality("fast")}
            className={`px-3 py-1.5 rounded-md transition-colors ${quality === "fast" ? "bg-gray-700 text-white" : "text-gray-400 hover:text-gray-300"}`}
          >
            Fast
          </button>
          <button
            onClick={() => setQuality("hd")}
            className={`px-3 py-1.5 rounded-md transition-colors ${quality === "hd" ? "bg-cyan-700 text-white" : "text-gray-400 hover:text-gray-300"}`}
          >
            HD
          </button>
        </div>

        {modelStatus === "ready" && allJobs.length === 0 && (
          <span className="text-xs text-green-600">Model ready</span>
        )}

        <div className="flex-1" />

        {doneCount > 1 && (
          <button
            onClick={handleDownloadAll}
            disabled={zipping}
            className="px-3 py-1.5 bg-cyan-700 hover:bg-cyan-600 disabled:bg-gray-700 rounded-lg text-xs font-medium transition-colors"
          >
            {zipping ? "Zipping..." : `Download All ZIP (${doneCount})`}
          </button>
        )}
      </div>

      {/* Upload */}
      <div
        onDrop={(e) => {
          e.preventDefault();
          handleFiles(e.dataTransfer.files);
        }}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl text-center cursor-pointer select-none
                   hover:border-cyan-500 hover:bg-gray-900/50 transition-all mb-5
                   ${allJobs.length === 0 ? "p-14 border-gray-600" : "p-4 border-gray-700"}`}
      >
        {allJobs.length === 0 ? (
          <>
            <div className="text-5xl mb-3 opacity-80">📸</div>
            <p className="text-lg text-gray-300 mb-1">
              Drop images or videos here
            </p>
            <p className="text-xs text-gray-500">
              Multiple files &mdash; JPG, PNG, WebP, MP4, WebM, MOV
            </p>
          </>
        ) : (
          <p className="text-sm text-gray-400">+ Add more files</p>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {/* Processing banner */}
      {(currentlyProcessing || queuedCount > 0) && (
        <div className="flex items-center gap-3 mb-4 bg-gray-900/80 rounded-lg px-4 py-2.5">
          <div className="w-4 h-4 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
          <span className="text-sm text-gray-300 truncate">
            {currentlyProcessing
              ? `Processing ${currentlyProcessing.fileName}...`
              : "Starting next job..."}
          </span>
          {queuedCount > 0 && (
            <span className="ml-auto text-xs text-gray-500 flex-shrink-0">
              +{queuedCount} queued
            </span>
          )}
        </div>
      )}

      {/* Main */}
      {allJobs.length > 0 && (
        <div className="flex flex-col lg:flex-row gap-5">
          {/* Sidebar thumbnails */}
          <div className="lg:w-44 flex lg:flex-col gap-2 overflow-x-auto lg:overflow-y-auto lg:max-h-[80vh] pb-2 lg:pb-0">
            {allJobs.map((job) => {
              const isVideo = job.kind === "video";
              const vj = isVideo ? (job as VideoJob) : null;
              const pct =
                vj?.progress && vj.stage === "processing"
                  ? Math.round(
                      (vj.progress.current / vj.progress.total) * 100
                    )
                  : null;

              return (
                <button
                  key={job.clientId}
                  onClick={() => setSelectedId(job.clientId)}
                  className={`relative flex-shrink-0 w-16 h-16 lg:w-full lg:h-auto lg:aspect-square
                             rounded-lg overflow-hidden border-2 transition-all duration-150
                             ${selectedId === job.clientId ? "border-cyan-500 ring-1 ring-cyan-500/30" : "border-gray-700 hover:border-gray-500"}`}
                >
                  {/* Thumbnail */}
                  {isVideo && vj?.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={vj.thumbnailUrl}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  ) : isVideo ? (
                    <div className="w-full h-full bg-gray-800 flex items-center justify-center text-xl">
                      🎬
                    </div>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={job.originalUrl}
                      alt=""
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  )}

                  {/* Video badge */}
                  {isVideo && (
                    <div className="absolute top-0.5 left-0.5 bg-black/60 rounded px-1 py-0.5 text-[9px] text-white">
                      VID
                    </div>
                  )}

                  {/* Progress overlay for videos */}
                  {pct !== null && (
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                      <span className="text-xs font-bold text-cyan-400 tabular-nums">
                        {pct}%
                      </span>
                    </div>
                  )}

                  {/* Status dot */}
                  <div className="absolute bottom-0.5 right-0.5">
                    {job.stage === "done" && (
                      <span className="block w-2.5 h-2.5 bg-green-500 rounded-full shadow" />
                    )}
                    {job.stage === "error" && (
                      <span className="block w-2.5 h-2.5 bg-red-500 rounded-full shadow" />
                    )}
                    {(job.stage === "processing" || job.stage === "queued") &&
                      pct === null && (
                        <span className="block w-2.5 h-2.5 bg-yellow-400 rounded-full animate-pulse shadow" />
                      )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Viewer */}
          <div className="flex-1 min-w-0">
            {/* IMAGE: done */}
            {activeImg?.stage === "done" && (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-4 bg-gray-900 rounded-xl p-3">
                  <div className="flex items-center gap-3 flex-1 min-w-[180px]">
                    <label className="text-xs text-gray-400 whitespace-nowrap">
                      Intensity
                    </label>
                    <input
                      type="range"
                      min="1"
                      max="40"
                      value={activeImg.intensity}
                      onChange={(e) =>
                        handleIntensityChange(
                          activeImg.clientId,
                          parseInt(e.target.value)
                        )
                      }
                      className="flex-1 accent-cyan-500 h-1.5"
                    />
                    <span className="text-xs text-cyan-400 w-6 text-right tabular-nums">
                      {activeImg.intensity}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleDownloadImage(activeImg)}
                      className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-xs font-medium transition-colors"
                    >
                      Download
                    </button>
                    <button
                      onClick={() => removeJob(activeImg.clientId)}
                      className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-xs font-medium transition-colors"
                    >
                      Remove
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <h3 className="text-xs font-medium text-gray-500 mb-1">
                      Original
                    </h3>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={activeImg.originalUrl}
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
                      src={activeImg.depthUrl}
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
                    />
                  </div>
                </div>
                {activeImg.serverId && (
                  <p className="text-[10px] text-green-600/70 text-center">
                    Saved online
                  </p>
                )}
              </div>
            )}

            {/* IMAGE: processing/queued */}
            {activeImg &&
              (activeImg.stage === "queued" ||
                activeImg.stage === "processing") && (
                <div className="text-center py-12">
                  <div className="inline-block w-10 h-10 border-[3px] border-cyan-500 border-t-transparent rounded-full animate-spin mb-3" />
                  <p className="text-sm text-gray-400">
                    {activeImg.stage === "queued"
                      ? "Waiting in queue..."
                      : "Estimating depth..."}
                  </p>
                  <div className="mt-4 max-w-xs mx-auto opacity-40">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={activeImg.originalUrl}
                      alt=""
                      className="w-full rounded-lg"
                    />
                  </div>
                </div>
              )}

            {/* VIDEO: queued */}
            {activeVid?.stage === "queued" && (
              <div className="text-center py-12 space-y-4">
                <video
                  src={activeVid.originalUrl}
                  controls
                  className="max-w-lg mx-auto rounded-lg border border-gray-800"
                />
                <div className="flex items-center justify-center gap-2">
                  <div className="w-3 h-3 bg-yellow-400 rounded-full animate-pulse" />
                  <span className="text-sm text-gray-400">
                    Queued &mdash; will start when current job finishes
                  </span>
                </div>
                <button
                  onClick={() => removeJob(activeVid.clientId)}
                  className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-xs font-medium transition-colors"
                >
                  Remove
                </button>
              </div>
            )}

            {/* VIDEO: processing */}
            {activeVid?.stage === "processing" && activeVid.progress && (
              <div className="text-center py-12 space-y-4">
                <div className="inline-block w-10 h-10 border-[3px] border-cyan-500 border-t-transparent rounded-full animate-spin mb-2" />
                <p className="text-sm text-gray-300">
                  {activeVid.progress.phase === "processing"
                    ? `Processing frame ${activeVid.progress.current} / ${activeVid.progress.total}`
                    : `Recording frame ${activeVid.progress.current} / ${activeVid.progress.total}`}
                </p>
                <div className="max-w-sm mx-auto">
                  <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-cyan-500 rounded-full transition-all duration-200"
                      style={{
                        width: `${Math.round((activeVid.progress.current / activeVid.progress.total) * 100)}%`,
                      }}
                    />
                  </div>
                  <p className="text-xs text-gray-500 mt-1 tabular-nums">
                    {Math.round(
                      (activeVid.progress.current /
                        activeVid.progress.total) *
                        100
                    )}
                    %
                  </p>
                </div>
                <button
                  onClick={() => {
                    const abort = videoAbortRef.current.get(
                      activeVid.clientId
                    );
                    if (abort) abort.abort();
                    setVideoJobs((p) =>
                      p.map((v) =>
                        v.clientId === activeVid.clientId
                          ? { ...v, stage: "error", error: "Cancelled", progress: undefined }
                          : v
                      )
                    );
                    processingRef.current = false;
                  }}
                  className="px-4 py-1.5 bg-red-900/50 hover:bg-red-900 border border-red-800 rounded-lg text-xs transition-colors"
                >
                  Cancel
                </button>
              </div>
            )}

            {/* VIDEO: done */}
            {activeVid?.stage === "done" && (
              <div className="text-center py-8 space-y-4">
                <video
                  src={activeVid.resultUrl}
                  controls
                  autoPlay
                  loop
                  className="max-w-2xl mx-auto rounded-lg border border-gray-800"
                />
                <div className="flex justify-center gap-3">
                  <a
                    href={activeVid.resultUrl}
                    download={`3d-${activeVid.fileName.replace(/\.[^.]+$/, "")}.webm`}
                    className="px-5 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-sm font-medium transition-colors inline-block"
                  >
                    Download 3D Video
                  </a>
                  <button
                    onClick={() => removeJob(activeVid.clientId)}
                    className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm font-medium transition-colors"
                  >
                    Remove
                  </button>
                </div>
                {activeVid.serverId && (
                  <p className="text-[10px] text-green-600/70">Saved online</p>
                )}
              </div>
            )}

            {/* ERROR (both types) */}
            {(activeImg?.stage === "error" || activeVid?.stage === "error") && (
              <div className="bg-red-950/40 border border-red-900 rounded-xl p-8 text-center">
                <p className="text-red-400 text-sm mb-1">
                  {activeVid?.error === "Cancelled" ? "Cancelled" : "Processing failed"}
                </p>
                <p className="text-xs text-red-500/70">
                  {(activeImg ?? activeVid)?.error}
                </p>
                <button
                  onClick={() =>
                    removeJob((activeImg ?? activeVid)!.clientId)
                  }
                  className="mt-3 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-xs transition-colors"
                >
                  Remove
                </button>
              </div>
            )}

            {!selected && allJobs.length > 0 && (
              <div className="text-center py-12 text-gray-600 text-sm">
                Select an item
              </div>
            )}
          </div>
        </div>
      )}

      {/* Default intensity */}
      {allJobs.length > 0 && (
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
