"use client";

import { useState, useRef, useCallback, useEffect, useMemo, lazy, Suspense } from "react";

const DepthEditor = lazy(() => import("./DepthEditor"));
const CompareSlider = lazy(() => import("./CompareSlider"));

// ── Types ──

interface Job {
  id: string;
  originalUrl: string;
  depthMapUrl: string | null;
  distanceMapUrl: string | null;
  anaglyphUrl: string | null;
  stereogramUrl: string | null;
  sbsUrl: string | null;
  videoUrl: string | null;
  fileName: string;
  width: number;
  height: number;
  intensity: number;
  colorMode: string;
  fillOcclusion: boolean;
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const [intensity, setIntensity] = useState(10);
  const [colorMode, setColorMode] = useState("dubois");
  const [fillOcclusion, setFillOcclusion] = useState(true);
  const [user, setUser] = useState<{ id: string; email: string } | null>(null);
  const [showAuth, setShowAuth] = useState(false);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [editingDepth, setEditingDepth] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [adjustIntensity, setAdjustIntensity] = useState<number | null>(null);
  const [adjustColorMode, setAdjustColorMode] = useState<string | null>(null);
  const [adjustFillOcclusion, setAdjustFillOcclusion] = useState<boolean | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadStyle, setDownloadStyle] = useState<string>("anaglyph");
  const [activeTab, setActiveTab] = useState<string>("anaglyph");
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [compareMode, setCompareMode] = useState(false);
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

  // Check auth state on mount
  useEffect(() => {
    fetch("/api/auth")
      .then((r) => r.json())
      .then((d) => { if (d.user) setUser(d.user); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  const hasActiveRef = useRef(false);
  useEffect(() => {
    // Only reset interval when active/idle state actually changes
    const hasActive = jobs.some(
      (j) => j.status === "pending" || j.status === "processing"
    );
    if (hasActive === hasActiveRef.current && pollRef.current) return;
    hasActiveRef.current = hasActive;
    const interval = hasActive ? 3000 : 30000;

    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(fetchJobs, interval);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [jobs, fetchJobs]);

  // ── Upload ──
  const handleFiles = useCallback(async (files: FileList | File[]) => {
    setUploading(true);
    try {
      for (const f of Array.from(files)) {
        const fd = new FormData();
        fd.append("file", f);
        fd.append("intensity", intensity.toString());
        fd.append("colorMode", colorMode);
        fd.append("fillOcclusion", fillOcclusion.toString());

        const res = await fetch("/api/jobs", { method: "POST", body: fd });
        if (res.ok) {
          const job = await res.json();
          setJobs((prev) => [job, ...prev]);
          setSelectedId((prev) => prev ?? job.id);
        }
      }
    } catch (err) {
      console.error("Upload failed:", err);
    } finally {
      setUploading(false);
    }
  }, [intensity, colorMode, fillOcclusion]);

  const handleDelete = useCallback((id: string) => {
    setJobs((prev) => prev.filter((j) => j.id !== id));
    setSelectedId((prev) => prev === id ? null : prev);
    fetch(`/api/jobs/${id}`, { method: "DELETE" }).catch(() => {});
  }, []);

  // ── Cancel ──
  const handleCancel = useCallback(async (id: string) => {
    try {
      await fetch(`/api/jobs/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
      setJobs((prev) =>
        prev.map((j) => (j.id === id ? { ...j, status: "cancelled" } : j))
      );
    } catch {
      /* ignore */
    }
  }, []);

  // ── Auth ──
  async function handleAuth(action: "login" | "register") {
    setAuthLoading(true);
    setAuthError("");
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, email: authEmail, password: authPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAuthError(data.error || "Failed");
        return;
      }
      setUser(data.user);
      setShowAuth(false);
      setAuthEmail("");
      setAuthPassword("");
      fetchJobs(); // Refresh to show user's jobs
    } catch {
      setAuthError("Network error");
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleLogout() {
    await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "logout" }),
    });
    setUser(null);
    fetchJobs(); // Refresh to show session jobs only
  }

  // ── Multi-select ──
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleDownloadSelected = useCallback(async () => {
    const ids = Array.from(selectedIds).filter((id) => {
      const j = jobs.find((job) => job.id === id);
      return j && j.status === "done" && (j.anaglyphUrl || j.videoUrl);
    });
    if (ids.length === 0) return;

    setDownloading(true);
    try {
      const res = await fetch("/api/jobs/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, style: downloadStyle }),
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename="(.+?)"/);
      const filename = match ? match[1] : ids.length === 1 ? "3d-image.png" : "3d-images.zip";
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = filename;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);
      }, 1000);
      setSelectedIds(new Set());
      setSelectMode(false);
    } catch { /* ignore */ }
    finally { setDownloading(false); }
  }, [selectedIds, jobs, downloadStyle]);

  // ── Download (cross-origin safe) ──
  const handleDownload = useCallback(async (url: string, filename: string) => {
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
      window.open(url, "_blank");
    }
  }, []);

  // ── Save to Photos (Web Share API) ──
  const handleSaveToPhotos = useCallback(async (url: string, fileName: string) => {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const ext = fileName.match(/\.([^.]+)$/)?.[1] || "png";
      const file = new File([blob], fileName, { type: blob.type || `image/${ext}` });
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file] });
      } else {
        // Fallback: regular download
        handleDownload(url, fileName);
      }
    } catch {
      // User cancelled share or not supported — fallback
      handleDownload(url, fileName);
    }
  }, [handleDownload]);

  // ── Retry ──
  const handleRetry = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/jobs/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retry" }),
      });
      if (res.ok) {
        const job = await res.json();
        setJobs((prev) => prev.map((j) => (j.id === id ? job : j)));
      }
    } catch { /* ignore */ }
  }, []);

  // ── Reprocess with new settings ──
  const handleReprocess = useCallback(async (id: string, settings: { intensity?: number; colorMode?: string; fillOcclusion?: boolean }) => {
    try {
      const res = await fetch(`/api/jobs/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reprocess", ...settings }),
      });
      if (res.ok) {
        const job = await res.json();
        setJobs((prev) => prev.map((j) => (j.id === id ? job : j)));
        setAdjustIntensity(null);
      }
    } catch { /* ignore */ }
  }, []);

  // ── Rotate ──
  const handleRotate = useCallback(async (id: string, angle: number) => {
    try {
      const res = await fetch(`/api/jobs/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "rotate", angle }),
      });
      if (res.ok) {
        const newJob = await res.json();
        setJobs((prev) => [newJob, ...prev]);
        setSelectedId(newJob.id);
      }
    } catch {
      /* ignore */
    }
  }, []);

  // Reset adjusters when switching images
  useEffect(() => { setAdjustIntensity(null); setAdjustColorMode(null); setAdjustFillOcclusion(null); setEditingDepth(false); setActiveTab("anaglyph"); setCompareMode(false); }, [selectedId]);

  // Keyboard shortcuts
  useEffect(() => {
    const tabIds = ["anaglyph", "original", "depth", "colormap", "stereogram", "sbs"];
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === "Escape") { setLightboxUrl(null); return; }
      // Arrow keys to navigate images
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const doneJobs = jobs.filter(j => j.status === "done");
        if (doneJobs.length === 0) return;
        const idx = doneJobs.findIndex(j => j.id === selectedId);
        const next = e.key === "ArrowRight"
          ? (idx + 1) % doneJobs.length
          : (idx - 1 + doneJobs.length) % doneJobs.length;
        setSelectedId(doneJobs[next].id);
        return;
      }
      // Number keys for tabs
      const num = parseInt(e.key);
      if (num >= 1 && num <= 6) {
        setActiveTab(tabIds[num - 1]);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [jobs, selectedId]);

  // ── Derived (memoized) ──
  const selected = useMemo(() => jobs.find((j) => j.id === selectedId) ?? null, [jobs, selectedId]);
  const activeCount = useMemo(() => jobs.filter(
    (j) => j.status === "pending" || j.status === "processing"
  ).length, [jobs]);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10">
      {/* Header */}
      <header className="mb-8 sm:mb-10">
        <div className="flex items-center justify-between mb-3">
          <div className="w-24" />
          <div className="text-center">
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-400 bg-clip-text text-transparent">
              3D Image Generator
            </h1>
            <p className="text-gray-500 text-xs sm:text-sm mt-1.5">
              Upload photos or videos &rarr; AI depth estimation &rarr; 6 output formats
            </p>
          </div>
          <div className="w-24 text-right">
            {user ? (
              <div className="flex items-center gap-2 text-xs justify-end">
                <span className="text-gray-500 hidden sm:inline">{user.email}</span>
                <button
                  onClick={handleLogout}
                  className="text-gray-500 hover:text-gray-300 transition-colors"
                >
                  Log out
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowAuth(!showAuth)}
                className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
              >
                Log in
              </button>
            )}
          </div>
        </div>
        {showAuth && !user && (
          <div className="max-w-xs mx-auto mt-3 bg-gray-900 border border-gray-700 rounded-xl p-4 space-y-3">
            <input
              type="email"
              placeholder="Email"
              value={authEmail}
              onChange={(e) => setAuthEmail(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500"
            />
            <input
              type="password"
              placeholder="Password"
              value={authPassword}
              onChange={(e) => setAuthPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAuth("login")}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500"
            />
            {authError && <p className="text-red-400 text-xs">{authError}</p>}
            <div className="flex gap-2">
              <button
                onClick={() => handleAuth("login")}
                disabled={authLoading}
                className="flex-1 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
              >
                Log in
              </button>
              <button
                onClick={() => handleAuth("register")}
                disabled={authLoading}
                className="flex-1 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
              >
                Register
              </button>
            </div>
          </div>
        )}
      </header>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-6 sm:mb-8 bg-gray-900/60 backdrop-blur-sm rounded-2xl px-4 py-3 border border-gray-800/40">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-medium text-gray-400">Intensity</span>
          <input
            type="range"
            min="1"
            max="40"
            value={intensity}
            onChange={(e) => setIntensity(parseInt(e.target.value))}
            className="w-20 sm:w-28 accent-cyan-500 h-1.5"
          />
          <span className="text-cyan-400 tabular-nums w-5 text-right font-mono text-xs">
            {intensity}
          </span>
        </div>

        <div className="hidden sm:block w-px h-5 bg-gray-700/50" />

        <div className="flex items-center gap-2 text-xs">
          <span className="font-medium text-gray-400">Color</span>
          <select
            value={colorMode}
            onChange={(e) => setColorMode(e.target.value)}
            className="bg-gray-800 border border-gray-700/50 rounded-lg px-2 py-1 text-xs text-gray-300 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/30 focus:outline-none transition-all"
          >
            <option value="dubois">Dubois</option>
            <option value="classic">Classic</option>
          </select>
        </div>

        <label className="flex items-center gap-1.5 text-xs cursor-pointer group">
          <input
            type="checkbox"
            checked={fillOcclusion}
            onChange={(e) => setFillOcclusion(e.target.checked)}
            className="accent-cyan-500 rounded"
          />
          <span className="text-gray-400 group-hover:text-gray-300 transition-colors">Fill gaps</span>
        </label>

        <div className="flex-1 min-w-0" />

        {activeCount > 0 && (
          <div className="flex items-center gap-2 bg-cyan-500/10 rounded-full px-3 py-1">
            <div className="w-2.5 h-2.5 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-[11px] text-cyan-400 font-medium whitespace-nowrap">
              {activeCount} processing
            </span>
          </div>
        )}
      </div>

      {/* Upload */}
      <div
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          handleFiles(e.dataTransfer.files);
        }}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl text-center cursor-pointer select-none
                   transition-all duration-200 mb-5
                   ${isDragging
                     ? "border-cyan-400 bg-cyan-500/10 scale-[1.01] shadow-lg shadow-cyan-500/10"
                     : "hover:border-cyan-500 hover:bg-gray-900/50"}
                   ${jobs.length === 0 ? "p-10 sm:p-16 border-gray-600" : "p-4 border-gray-700"}`}
      >
        {uploading ? (
          <div className="flex items-center justify-center gap-3">
            <div className="w-5 h-5 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-cyan-400">Uploading...</p>
          </div>
        ) : jobs.length === 0 ? (
          <>
            <div className="text-5xl mb-4 opacity-90">{isDragging ? "+" : "📸"}</div>
            <p className="text-lg font-medium text-gray-200 mb-1">
              {isDragging ? "Drop to convert" : "Drop images or videos here"}
            </p>
            <p className="text-sm text-gray-500">
              JPG, PNG, WebP, MP4, WebM, MOV &mdash; multiple files at once
            </p>
            <p className="text-xs text-gray-600 mt-3">
              AI depth estimation &rarr; 6 output formats &mdash; processing continues even if you close this page
            </p>
          </>
        ) : (
          <p className="text-sm text-gray-400 hover:text-gray-300 transition-colors">+ Add more files</p>
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
        <div className="flex flex-col lg:flex-row gap-4 lg:gap-6">
          {/* Sidebar */}
          <div className="lg:w-44 flex-shrink-0">
            {/* Select mode toggle + download button */}
            <div className="flex items-center gap-2 mb-2">
              <button
                onClick={() => { setSelectMode(!selectMode); if (selectMode) setSelectedIds(new Set()); }}
                className={`text-[10px] px-2 py-1 rounded transition-colors ${selectMode ? "bg-cyan-600 text-white" : "bg-gray-800 text-gray-400 hover:text-gray-300"}`}
              >
                {selectMode ? "Cancel" : "Select"}
              </button>
              {selectMode && selectedIds.size > 0 && (
                <>
                  <select
                    value={downloadStyle}
                    onChange={(e) => setDownloadStyle(e.target.value)}
                    className="text-[10px] px-1 py-1 bg-gray-800 border border-gray-700 rounded text-gray-300"
                  >
                    <option value="anaglyph">Anaglyph</option>
                    <option value="stereogram">Magic Eye</option>
                    <option value="sbs">Side-by-Side</option>
                    <option value="depth">Depth</option>
                    <option value="colormap">Color Map</option>
                  </select>
                  <button
                    onClick={handleDownloadSelected}
                    disabled={downloading}
                    className="text-[10px] px-2 py-1 bg-cyan-600 hover:bg-cyan-500 rounded text-white transition-colors disabled:opacity-50"
                  >
                    {downloading ? "Zipping..." : `Download ${selectedIds.size}`}
                  </button>
                </>
              )}
            </div>
            <div className="flex lg:flex-col gap-2 overflow-x-auto lg:overflow-y-auto lg:max-h-[75vh] pb-2 lg:pb-0">
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
                  onClick={() => { if (selectMode) { toggleSelect(job.id); } else { setSelectedId(job.id); } }}
                  className={`relative flex-shrink-0 w-20 h-20 lg:w-full lg:h-auto lg:aspect-square
                             rounded-lg overflow-hidden border-2 transition-all duration-150
                             ${selectedId === job.id && !selectMode ? "border-cyan-500 ring-1 ring-cyan-500/30" : selectedIds.has(job.id) ? "border-cyan-500 ring-1 ring-cyan-500/30" : "border-gray-700 hover:border-gray-500"}`}
                >
                  {/* Thumbnail */}
                  {job.anaglyphUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={job.anaglyphUrl}
                      alt=""
                      loading="lazy"
                      width={80}
                      height={80}
                      className="w-full h-full object-cover"
                    />
                  ) : !isVideo && job.originalUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={job.originalUrl}
                      alt=""
                      loading="lazy"
                      width={80}
                      height={80}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full bg-gray-800 flex items-center justify-center text-xl">
                      {isVideo ? "🎬" : "📷"}
                    </div>
                  )}

                  {/* Top badges */}
                  <div className="absolute top-0.5 left-0.5 flex gap-0.5">
                    {isVideo && (
                      <div className="bg-black/60 rounded px-1 py-0.5 text-[9px] text-white">
                        VID
                      </div>
                    )}
                    <div className="bg-black/60 rounded px-1 py-0.5 text-[9px] text-cyan-300">
                      {job.intensity}
                    </div>
                  </div>

                  {/* Progress overlay */}
                  {pct !== null && (
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                      <span className="text-xs font-bold text-cyan-400 tabular-nums">
                        {pct}%
                      </span>
                    </div>
                  )}

                  {/* Select checkbox */}
                  {selectMode && (
                    <div className="absolute top-0.5 right-0.5">
                      <div className={`w-4 h-4 rounded border-2 flex items-center justify-center text-[10px] ${selectedIds.has(job.id) ? "bg-cyan-500 border-cyan-500 text-white" : "border-white/70 bg-black/40"}`}>
                        {selectedIds.has(job.id) && "✓"}
                      </div>
                    </div>
                  )}

                  {/* Status badge */}
                  <div className="absolute bottom-0.5 right-0.5">
                    {job.status === "done" && !selectMode && (
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
                    {job.status === "cancelled" && (
                      <span className="block w-2.5 h-2.5 bg-gray-500 rounded-full shadow" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>
          </div>

          {/* Viewer */}
          <div className="flex-1 min-w-0">
            {/* IMAGE: done */}
            {selected &&
              selected.mediaType === "image" &&
              selected.status === "done" && (
                <div className="space-y-4 animate-slide-up">
                  <div className="bg-gray-900/80 backdrop-blur-sm rounded-xl p-4 space-y-3 border border-gray-800/50">
                    <div className="flex flex-wrap items-center gap-3">
                    <h2 className="text-sm font-semibold truncate flex-1 text-gray-100">
                      {selected.fileName}
                    </h2>
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => handleRotate(selected.id, -90)}
                        className="w-8 h-8 bg-gray-800 hover:bg-gray-700 rounded-lg text-xs flex items-center justify-center transition-colors"
                        title="Rotate left 90°"
                      >
                        ↺
                      </button>
                      <button
                        onClick={() => handleRotate(selected.id, 90)}
                        className="w-8 h-8 bg-gray-800 hover:bg-gray-700 rounded-lg text-xs flex items-center justify-center transition-colors"
                        title="Rotate right 90°"
                      >
                        ↻
                      </button>
                      <button
                        onClick={() => handleRotate(selected.id, 180)}
                        className="w-8 h-8 bg-gray-800 hover:bg-gray-700 rounded-lg text-xs flex items-center justify-center transition-colors"
                        title="Rotate 180°"
                      >
                        180
                      </button>
                      {selected.depthMapUrl && (
                        <button
                          onClick={() => setEditingDepth(!editingDepth)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${editingDepth ? "bg-purple-600 hover:bg-purple-500" : "bg-gray-700 hover:bg-gray-600"}`}
                        >
                          {editingDepth ? "Close Editor" : "Edit Depth"}
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
                    {/* Settings row */}
                    <div className="flex flex-wrap items-center gap-3 text-xs">
                      <div className="flex items-center gap-1.5 text-gray-400">
                        <span>Intensity:</span>
                        <input type="range" min="1" max="40"
                          value={adjustIntensity ?? selected.intensity}
                          onChange={(e) => setAdjustIntensity(parseInt(e.target.value))}
                          className="w-24 accent-cyan-500 h-1.5" />
                        <span className="text-cyan-400 tabular-nums w-5 text-right">{adjustIntensity ?? selected.intensity}</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-gray-400">
                        <span>Color:</span>
                        <select
                          value={adjustColorMode ?? selected.colorMode}
                          onChange={(e) => setAdjustColorMode(e.target.value)}
                          className="bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 text-xs text-gray-300"
                        >
                          <option value="dubois">Dubois</option>
                          <option value="classic">Classic</option>
                        </select>
                      </div>
                      <label className="flex items-center gap-1 text-gray-400 cursor-pointer">
                        <input type="checkbox"
                          checked={adjustFillOcclusion ?? selected.fillOcclusion}
                          onChange={(e) => setAdjustFillOcclusion(e.target.checked)}
                          className="accent-cyan-500" />
                        Fill gaps
                      </label>
                      {((adjustIntensity !== null && adjustIntensity !== selected.intensity) ||
                        (adjustColorMode !== null && adjustColorMode !== selected.colorMode) ||
                        (adjustFillOcclusion !== null && adjustFillOcclusion !== selected.fillOcclusion)) && (
                        <button
                          onClick={() => handleReprocess(selected.id, {
                            ...(adjustIntensity !== null && adjustIntensity !== selected.intensity ? { intensity: adjustIntensity } : {}),
                            ...(adjustColorMode !== null && adjustColorMode !== selected.colorMode ? { colorMode: adjustColorMode } : {}),
                            ...(adjustFillOcclusion !== null && adjustFillOcclusion !== selected.fillOcclusion ? { fillOcclusion: adjustFillOcclusion } : {}),
                          })}
                          className="px-3 py-1 bg-cyan-600 hover:bg-cyan-500 rounded text-xs font-medium transition-colors"
                        >
                          Apply Changes
                        </button>
                      )}
                    </div>
                  </div>
                  {/* Depth Editor */}
                  {editingDepth && selected.depthMapUrl && (
                    <Suspense fallback={<div className="text-center py-8 text-gray-500 text-sm">Loading editor...</div>}>
                      <DepthEditor
                        jobId={selected.id}
                        depthMapUrl={selected.depthMapUrl}
                        originalUrl={selected.originalUrl}
                        onSave={() => { setEditingDepth(false); fetchJobs(); }}
                        onClose={() => setEditingDepth(false)}
                      />
                    </Suspense>
                  )}

                  {/* Output tabs */}
                  {(() => {
                    const tabs = [
                      { id: "anaglyph", label: "3D", labelFull: "Anaglyph 3D", url: selected.anaglyphUrl },
                      { id: "original", label: "Orig", labelFull: "Original", url: selected.originalUrl },
                      { id: "depth", label: "Depth", labelFull: "Depth Map", url: selected.depthMapUrl },
                      { id: "colormap", label: "Color", labelFull: "Color Map", url: selected.distanceMapUrl },
                      { id: "stereogram", label: "Eye", labelFull: "Magic Eye", url: selected.stereogramUrl },
                      { id: "sbs", label: "SBS", labelFull: "Side-by-Side", url: selected.sbsUrl },
                    ];
                    const current = tabs.find(t => t.id === activeTab) || tabs[0];
                    const baseName = selected.fileName.replace(/\.[^.]+$/, "");
                    const canCompare = compareMode && current.id !== "original" && current.url && selected.originalUrl;
                    return (
                      <div>
                        {/* Tab bar + compare toggle */}
                        <div className="flex items-center gap-2 mb-3">
                          <div className="flex gap-1 overflow-x-auto scrollbar-hide flex-1">
                            {tabs.map(tab => (
                              <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`px-2.5 sm:px-3 py-1.5 rounded-lg text-[11px] sm:text-xs font-medium whitespace-nowrap transition-all
                                  ${activeTab === tab.id
                                    ? "bg-cyan-600 text-white shadow-lg shadow-cyan-500/20"
                                    : tab.url
                                      ? "bg-gray-800/80 text-gray-400 hover:text-gray-200 hover:bg-gray-700 active:scale-95"
                                      : "bg-gray-800/30 text-gray-600 cursor-not-allowed"}`}
                                disabled={!tab.url && tab.id !== "original"}
                                title={tab.labelFull}
                              >
                                <span className="sm:hidden">{tab.label}</span>
                                <span className="hidden sm:inline">{tab.labelFull}</span>
                              </button>
                            ))}
                          </div>
                          {/* Compare toggle */}
                          {activeTab !== "original" && current.url && (
                            <button
                              onClick={() => setCompareMode(!compareMode)}
                              className={`px-2.5 py-1.5 rounded-lg text-[11px] sm:text-xs font-medium whitespace-nowrap transition-all flex-shrink-0
                                ${compareMode
                                  ? "bg-purple-600 text-white shadow-lg shadow-purple-500/20"
                                  : "bg-gray-800/80 text-gray-400 hover:text-gray-200 hover:bg-gray-700 active:scale-95"}`}
                            >
                              Compare
                            </button>
                          )}
                        </div>
                        {/* Active image or compare slider */}
                        <div className="relative group">
                          {canCompare ? (
                            <Suspense fallback={<div className="w-full aspect-video bg-gray-800/50 rounded-xl animate-pulse" />}>
                              <CompareSlider
                                beforeUrl={selected.originalUrl}
                                afterUrl={current.url!}
                                beforeLabel="Original"
                                afterLabel={current.labelFull}
                              />
                            </Suspense>
                          ) : current.url ? (
                            <>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={current.url}
                                alt={current.labelFull}
                                loading="lazy"
                                decoding="async"
                                className="w-full rounded-xl border border-gray-800/50 cursor-zoom-in transition-all hover:border-gray-700"
                                onClick={() => setLightboxUrl(current.url)}
                              />
                              {/* Overlay actions */}
                              <div className="absolute bottom-3 left-3 right-3 flex justify-between items-end opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                                <span className="text-[10px] text-white/60 bg-black/40 backdrop-blur-sm rounded px-2 py-0.5 pointer-events-none">
                                  Click to expand
                                </span>
                                <div className="flex gap-1.5 pointer-events-auto">
                                  {current.id !== "original" && (
                                    <>
                                      <button
                                        onClick={(e) => { e.stopPropagation(); handleDownload(current.url!, `${current.id}-${baseName}.png`); }}
                                        className="px-3 py-1.5 bg-black/60 backdrop-blur-sm hover:bg-black/80 active:scale-95 rounded-lg text-xs font-medium transition-all"
                                      >
                                        Download
                                      </button>
                                      <button
                                        onClick={(e) => { e.stopPropagation(); handleSaveToPhotos(current.url!, `${current.id}-${baseName}.png`); }}
                                        className="px-3 py-1.5 bg-black/60 backdrop-blur-sm hover:bg-black/80 active:scale-95 rounded-lg text-xs font-medium transition-all"
                                      >
                                        Share
                                      </button>
                                    </>
                                  )}
                                </div>
                              </div>
                            </>
                          ) : (
                            <div className="w-full aspect-video bg-gray-800/30 rounded-xl border border-dashed border-gray-700 flex items-center justify-center text-gray-500 text-sm">
                              Reprocess to generate
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

            {/* VIDEO: done */}
            {selected &&
              selected.mediaType === "video" &&
              selected.status === "done" && (
                <div className="space-y-4">
                  <div className="bg-gray-900 rounded-xl p-3 space-y-2">
                    <div className="flex flex-wrap items-center gap-3">
                      <h2 className="text-sm font-medium truncate flex-1">{selected.fileName}</h2>
                      <div className="flex gap-2">
                        {selected.videoUrl && (
                          <>
                            <button
                              onClick={() => handleDownload(selected.videoUrl!, `3d-${selected.fileName.replace(/\.[^.]+$/, "")}.mp4`)}
                              className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-xs font-medium transition-colors"
                            >
                              Download
                            </button>
                            <button
                              onClick={() => handleSaveToPhotos(selected.videoUrl!, `3d-${selected.fileName.replace(/\.[^.]+$/, "")}.mp4`)}
                              className="px-3 py-1.5 bg-green-600 hover:bg-green-500 rounded-lg text-xs font-medium transition-colors"
                            >
                              Save to Photos
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => handleDelete(selected.id)}
                          className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-xs font-medium transition-colors"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                    {/* Settings row */}
                    <div className="flex flex-wrap items-center gap-3 text-xs">
                      <div className="flex items-center gap-1.5 text-gray-400">
                        <span>Intensity:</span>
                        <input type="range" min="1" max="40"
                          value={adjustIntensity ?? selected.intensity}
                          onChange={(e) => setAdjustIntensity(parseInt(e.target.value))}
                          className="w-24 accent-cyan-500 h-1.5" />
                        <span className="text-cyan-400 tabular-nums w-5 text-right">{adjustIntensity ?? selected.intensity}</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-gray-400">
                        <span>Color:</span>
                        <select
                          value={adjustColorMode ?? selected.colorMode}
                          onChange={(e) => setAdjustColorMode(e.target.value)}
                          className="bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 text-xs text-gray-300"
                        >
                          <option value="dubois">Dubois</option>
                          <option value="classic">Classic</option>
                        </select>
                      </div>
                      <label className="flex items-center gap-1 text-gray-400 cursor-pointer">
                        <input type="checkbox"
                          checked={adjustFillOcclusion ?? selected.fillOcclusion}
                          onChange={(e) => setAdjustFillOcclusion(e.target.checked)}
                          className="accent-cyan-500" />
                        Fill gaps
                      </label>
                      {((adjustIntensity !== null && adjustIntensity !== selected.intensity) ||
                        (adjustColorMode !== null && adjustColorMode !== selected.colorMode) ||
                        (adjustFillOcclusion !== null && adjustFillOcclusion !== selected.fillOcclusion)) && (
                        <button
                          onClick={() => handleReprocess(selected.id, {
                            ...(adjustIntensity !== null && adjustIntensity !== selected.intensity ? { intensity: adjustIntensity } : {}),
                            ...(adjustColorMode !== null && adjustColorMode !== selected.colorMode ? { colorMode: adjustColorMode } : {}),
                            ...(adjustFillOcclusion !== null && adjustFillOcclusion !== selected.fillOcclusion ? { fillOcclusion: adjustFillOcclusion } : {}),
                          })}
                          className="px-3 py-1 bg-cyan-600 hover:bg-cyan-500 rounded text-xs font-medium transition-colors"
                        >
                          Apply Changes
                        </button>
                      )}
                    </div>
                  </div>
                  {selected.videoUrl && (
                    <video
                      src={selected.videoUrl}
                      controls
                      autoPlay
                      loop
                      className="max-w-2xl mx-auto rounded-lg border border-gray-800"
                    />
                  )}
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
                  <button
                    onClick={() => handleCancel(selected.id)}
                    className="px-4 py-2 bg-red-700 hover:bg-red-600 rounded-lg text-sm font-medium transition-colors"
                  >
                    Cancel
                  </button>
                  <p className="text-xs text-gray-600">
                    You can close this page &mdash; processing continues on the
                    server
                  </p>
                </div>
              )}

            {/* Cancelled */}
            {selected && selected.status === "cancelled" && (
              <div className="bg-gray-900 border border-gray-700 rounded-xl p-8 text-center">
                <h2 className="text-sm font-medium mb-2">
                  {selected.fileName}
                </h2>
                <p className="text-gray-400 text-sm mb-3">Cancelled</p>
                <button
                  onClick={() => handleDelete(selected.id)}
                  className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-xs transition-colors"
                >
                  Remove
                </button>
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
                <div className="mt-3 flex justify-center gap-2">
                  <button
                    onClick={() => handleRetry(selected.id)}
                    className="px-4 py-1.5 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-xs font-medium transition-colors"
                  >
                    Retry
                  </button>
                  <button
                    onClick={() => handleDelete(selected.id)}
                    className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-xs transition-colors"
                  >
                    Remove
                  </button>
                </div>
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

      {/* Lightbox */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 cursor-zoom-out animate-fade-in"
          onClick={() => setLightboxUrl(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightboxUrl}
            alt="Full size"
            className="max-w-full max-h-full object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            onClick={() => setLightboxUrl(null)}
            className="absolute top-4 right-4 w-10 h-10 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center text-white text-xl transition-colors"
          >
            &times;
          </button>
        </div>
      )}
    </div>
  );
}
