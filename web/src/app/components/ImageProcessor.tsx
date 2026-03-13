"use client";

import { useState, useRef, useCallback, useEffect } from "react";

// ── Types ──

interface Job {
  id: string;
  originalUrl: string;
  depthMapUrl: string | null;
  anaglyphUrl: string | null;
  videoUrl: string | null;
  fileName: string;
  width: number;
  height: number;
  intensity: number;
  status: string;
  error: string | null;
  mediaType: string;
  duration: number | null;
  frameCount: number | null;
  framesDone: number;
  createdAt: string;
}

// ── Component ──

export default function ImageProcessor() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [intensity, setIntensity] = useState(10);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  // ── Polling ──
  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/jobs");
      if (res.ok) {
        const data = await res.json();
        setJobs(data);
      }
    } catch {
      /* ignore poll errors */
    }
  }, []);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  useEffect(() => {
    // Poll every 3s if there are active jobs, otherwise every 30s
    const hasActive = jobs.some(
      (j) => j.status === "pending" || j.status === "processing"
    );
    const interval = hasActive ? 3000 : 30000;

    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(fetchJobs, interval);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [jobs, fetchJobs]);

  // ── Upload ──
  async function handleFiles(files: FileList | File[]) {
    setUploading(true);
    try {
      for (const f of Array.from(files)) {
        const fd = new FormData();
        fd.append("file", f);
        fd.append("intensity", intensity.toString());

        const res = await fetch("/api/jobs", { method: "POST", body: fd });
        if (res.ok) {
          const job = await res.json();
          setJobs((prev) => [job, ...prev]);
          if (!selectedId) setSelectedId(job.id);
        }
      }
    } catch (err) {
      console.error("Upload failed:", err);
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(id: string) {
    setJobs((prev) => prev.filter((j) => j.id !== id));
    if (selectedId === id) {
      setSelectedId(null);
    }
    try {
      await fetch(`/api/jobs/${id}`, { method: "DELETE" });
    } catch {
      /* ignore */
    }
  }

  // ── Download (cross-origin safe) ──
  async function handleDownload(url: string, filename: string) {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch {
      // Fallback: open in new tab
      window.open(url, "_blank");
    }
  }

  // ── Derived ──
  const selected = jobs.find((j) => j.id === selectedId) ?? null;
  const activeCount = jobs.filter(
    (j) => j.status === "pending" || j.status === "processing"
  ).length;

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-8">
      {/* Header */}
      <header className="text-center mb-5">
        <h1 className="text-4xl font-bold mb-1">3D Image Generator</h1>
        <p className="text-gray-400 text-sm">
          Upload photos or videos &rarr; server-side AI depth &rarr; anaglyph
          3D
        </p>
      </header>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <span>3D Intensity:</span>
          <input
            type="range"
            min="1"
            max="40"
            value={intensity}
            onChange={(e) => setIntensity(parseInt(e.target.value))}
            className="w-24 accent-cyan-500 h-1.5"
          />
          <span className="text-cyan-400 tabular-nums w-5 text-right">
            {intensity}
          </span>
        </div>

        <div className="flex-1" />

        {activeCount > 0 && (
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-gray-400">
              {activeCount} job{activeCount > 1 ? "s" : ""} processing...
            </span>
          </div>
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
                   ${jobs.length === 0 ? "p-14 border-gray-600" : "p-4 border-gray-700"}`}
      >
        {uploading ? (
          <p className="text-sm text-cyan-400">Uploading...</p>
        ) : jobs.length === 0 ? (
          <>
            <div className="text-5xl mb-3 opacity-80">📸</div>
            <p className="text-lg text-gray-300 mb-1">
              Drop images or videos here
            </p>
            <p className="text-xs text-gray-500">
              Multiple files &mdash; JPG, PNG, WebP, MP4, WebM, MOV
            </p>
            <p className="text-xs text-gray-600 mt-2">
              Processing happens on the server &mdash; you can close this page
              and come back later
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

      {/* Main */}
      {jobs.length > 0 && (
        <div className="flex flex-col lg:flex-row gap-5">
          {/* Sidebar */}
          <div className="lg:w-48 flex lg:flex-col gap-2 overflow-x-auto lg:overflow-y-auto lg:max-h-[80vh] pb-2 lg:pb-0">
            {jobs.map((job) => {
              const isVideo = job.mediaType === "video";
              const pct =
                isVideo &&
                job.status === "processing" &&
                job.frameCount &&
                job.frameCount > 0
                  ? Math.round((job.framesDone / job.frameCount) * 100)
                  : null;

              return (
                <button
                  key={job.id}
                  onClick={() => setSelectedId(job.id)}
                  className={`relative flex-shrink-0 w-20 h-20 lg:w-full lg:h-auto lg:aspect-square
                             rounded-lg overflow-hidden border-2 transition-all duration-150
                             ${selectedId === job.id ? "border-cyan-500 ring-1 ring-cyan-500/30" : "border-gray-700 hover:border-gray-500"}`}
                >
                  {/* Thumbnail */}
                  {job.anaglyphUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={job.anaglyphUrl}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  ) : !isVideo && job.originalUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={job.originalUrl}
                      alt=""
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-full h-full bg-gray-800 flex items-center justify-center text-xl">
                      {isVideo ? "🎬" : "📷"}
                    </div>
                  )}

                  {/* Video badge */}
                  {isVideo && (
                    <div className="absolute top-0.5 left-0.5 bg-black/60 rounded px-1 py-0.5 text-[9px] text-white">
                      VID
                    </div>
                  )}

                  {/* Progress overlay */}
                  {pct !== null && (
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                      <span className="text-xs font-bold text-cyan-400 tabular-nums">
                        {pct}%
                      </span>
                    </div>
                  )}

                  {/* Status badge */}
                  <div className="absolute bottom-0.5 right-0.5">
                    {job.status === "done" && (
                      <span className="block w-2.5 h-2.5 bg-green-500 rounded-full shadow" />
                    )}
                    {job.status === "error" && (
                      <span className="block w-2.5 h-2.5 bg-red-500 rounded-full shadow" />
                    )}
                    {job.status === "pending" && (
                      <span className="block w-2.5 h-2.5 bg-yellow-400 rounded-full animate-pulse shadow" />
                    )}
                    {job.status === "processing" && pct === null && (
                      <span className="block w-2.5 h-2.5 bg-cyan-400 rounded-full animate-pulse shadow" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Viewer */}
          <div className="flex-1 min-w-0">
            {/* IMAGE: done */}
            {selected &&
              selected.mediaType === "image" &&
              selected.status === "done" && (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-3 bg-gray-900 rounded-xl p-3">
                    <h2 className="text-sm font-medium truncate flex-1">
                      {selected.fileName}
                    </h2>
                    <div className="flex gap-2">
                      {selected.anaglyphUrl && (
                        <button
                          onClick={() => handleDownload(selected.anaglyphUrl!, `3d-${selected.fileName.replace(/\.[^.]+$/, "")}.png`)}
                          className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-xs font-medium transition-colors"
                        >
                          Download 3D
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(selected.id)}
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
                        src={selected.originalUrl}
                        alt="Original"
                        className="w-full rounded-lg border border-gray-800"
                      />
                    </div>
                    <div>
                      <h3 className="text-xs font-medium text-gray-500 mb-1">
                        Depth Map
                      </h3>
                      {selected.depthMapUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={selected.depthMapUrl}
                          alt="Depth"
                          className="w-full rounded-lg border border-gray-800"
                        />
                      ) : (
                        <div className="w-full aspect-square bg-gray-800 rounded-lg border border-gray-800 flex items-center justify-center text-gray-600 text-xs">
                          Processing...
                        </div>
                      )}
                    </div>
                    <div>
                      <h3 className="text-xs font-medium text-gray-500 mb-1">
                        Anaglyph 3D
                      </h3>
                      {selected.anaglyphUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={selected.anaglyphUrl}
                          alt="Anaglyph"
                          className="w-full rounded-lg border border-gray-800"
                        />
                      ) : (
                        <div className="w-full aspect-square bg-gray-800 rounded-lg border border-gray-800 flex items-center justify-center text-gray-600 text-xs">
                          Processing...
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

            {/* VIDEO: done */}
            {selected &&
              selected.mediaType === "video" &&
              selected.status === "done" && (
                <div className="text-center py-8 space-y-4">
                  <h2 className="text-sm font-medium">{selected.fileName}</h2>
                  {selected.videoUrl && (
                    <video
                      src={selected.videoUrl}
                      controls
                      autoPlay
                      loop
                      className="max-w-2xl mx-auto rounded-lg border border-gray-800"
                    />
                  )}
                  <div className="flex justify-center gap-3">
                    {selected.videoUrl && (
                      <button
                        onClick={() => handleDownload(selected.videoUrl!, `3d-${selected.fileName.replace(/\.[^.]+$/, "")}.mp4`)}
                        className="px-5 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-sm font-medium transition-colors"
                      >
                        Download 3D Video
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(selected.id)}
                      className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm font-medium transition-colors"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              )}

            {/* Pending / Processing */}
            {selected &&
              (selected.status === "pending" ||
                selected.status === "processing") && (
                <div className="text-center py-12 space-y-4">
                  <div className="inline-block w-10 h-10 border-[3px] border-cyan-500 border-t-transparent rounded-full animate-spin mb-3" />
                  <h2 className="text-sm font-medium">{selected.fileName}</h2>
                  <p className="text-sm text-gray-400">
                    {selected.status === "pending"
                      ? "Waiting in queue..."
                      : selected.mediaType === "video" &&
                          selected.frameCount &&
                          selected.frameCount > 0
                        ? `Processing frame ${selected.framesDone} / ${selected.frameCount}`
                        : "Processing..."}
                  </p>
                  {selected.mediaType === "video" &&
                    selected.frameCount &&
                    selected.frameCount > 0 && (
                      <div className="max-w-sm mx-auto">
                        <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-cyan-500 rounded-full transition-all duration-200"
                            style={{
                              width: `${Math.round((selected.framesDone / selected.frameCount) * 100)}%`,
                            }}
                          />
                        </div>
                        <p className="text-xs text-gray-500 mt-1 tabular-nums">
                          {Math.round(
                            (selected.framesDone / selected.frameCount) * 100
                          )}
                          %
                        </p>
                      </div>
                    )}
                  <p className="text-xs text-gray-600">
                    You can close this page &mdash; processing continues on the
                    server
                  </p>
                </div>
              )}

            {/* Error */}
            {selected && selected.status === "error" && (
              <div className="bg-red-950/40 border border-red-900 rounded-xl p-8 text-center">
                <h2 className="text-sm font-medium mb-2">
                  {selected.fileName}
                </h2>
                <p className="text-red-400 text-sm mb-1">Processing failed</p>
                <p className="text-xs text-red-500/70">{selected.error}</p>
                <button
                  onClick={() => handleDelete(selected.id)}
                  className="mt-3 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-xs transition-colors"
                >
                  Remove
                </button>
              </div>
            )}

            {!selected && jobs.length > 0 && (
              <div className="text-center py-12 text-gray-600 text-sm">
                Select an item to view
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
