"use client";

import { useState, useRef, useCallback, useEffect, useMemo, lazy, Suspense, memo } from "react";

const DepthEditor = lazy(() => import("./DepthEditor"));
const CompareSlider = lazy(() => import("./CompareSlider"));
const OnboardingFlow = lazy(() => import("./OnboardingFlow"));

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

// ── Memoized thumbnail ──

interface JobThumbProps {
  job: Job;
  isSelected: boolean;
  isChecked: boolean;
  selectMode: boolean;
  onClick: () => void;
}

const JobThumbnail = memo(function JobThumbnail({ job, isSelected, isChecked, selectMode, onClick }: JobThumbProps) {
  const isVideo = job.mediaType === "video";
  const pct =
    isVideo && job.status === "processing" && job.frameCount && job.frameCount > 0
      ? Math.round((job.framesDone / job.frameCount) * 100)
      : null;

  return (
    <button
      onClick={onClick}
      className={`relative flex-shrink-0 w-20 h-20 lg:w-full lg:h-auto lg:aspect-square
                 rounded-lg overflow-hidden border-2 transition-all duration-150
                 ${isSelected && !selectMode ? "border-cyan-500 ring-1 ring-cyan-500/30" : isChecked ? "border-cyan-500 ring-1 ring-cyan-500/30" : "border-gray-700 hover:border-gray-500"}`}
    >
      {/* Thumbnail */}
      {job.anaglyphUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={job.anaglyphUrl} alt="" loading="lazy" width={80} height={80} className="w-full h-full object-cover" />
      ) : !isVideo && job.originalUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={job.originalUrl} alt="" loading="lazy" width={80} height={80} className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full bg-gray-800 flex items-center justify-center text-xl">
          {isVideo ? "\uD83C\uDFAC" : "\uD83D\uDCF7"}
        </div>
      )}

      {/* Top badges */}
      <div className="absolute top-0.5 left-0.5 flex gap-0.5">
        {isVideo && (
          <div className="bg-black/60 rounded px-1 py-0.5 text-[9px] text-white">VID</div>
        )}
        <div className="bg-black/60 rounded px-1 py-0.5 text-[9px] text-cyan-300">{job.intensity}</div>
      </div>

      {/* Progress overlay */}
      {pct !== null && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
          <span className="text-xs font-bold text-cyan-400 tabular-nums">{pct}%</span>
        </div>
      )}

      {/* Select checkbox */}
      {selectMode && (
        <div className="absolute top-0.5 right-0.5">
          <div className={`w-4 h-4 rounded border-2 flex items-center justify-center text-[10px] ${isChecked ? "bg-cyan-500 border-cyan-500 text-white" : "border-white/70 bg-black/40"}`}>
            {isChecked && "\u2713"}
          </div>
        </div>
      )}

      {/* Status badge */}
      <div className="absolute bottom-0.5 right-0.5">
        {job.status === "done" && !selectMode && <span className="block w-2.5 h-2.5 bg-green-500 rounded-full shadow" />}
        {job.status === "error" && <span className="block w-2.5 h-2.5 bg-red-500 rounded-full shadow" />}
        {job.status === "pending" && <span className="block w-2.5 h-2.5 bg-yellow-400 rounded-full animate-pulse shadow" />}
        {job.status === "processing" && pct === null && <span className="block w-2.5 h-2.5 bg-cyan-400 rounded-full animate-pulse shadow" />}
        {job.status === "cancelled" && <span className="block w-2.5 h-2.5 bg-gray-500 rounded-full shadow" />}
      </div>
    </button>
  );
});

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
  const [creditInfo, setCreditInfo] = useState<{ type: string; credits: number | null; used?: number; limit?: number | null; remaining?: number } | null>(null);
  const [couponCode, setCouponCode] = useState("");
  const [couponMsg, setCouponMsg] = useState("");
  const [couponError, setCouponError] = useState("");
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [videoFormats, setVideoFormats] = useState({ anaglyph: true, stereogram: true, sbs: true });
  const [pendingVideoFile, setPendingVideoFile] = useState<{ file: File; duration: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  // ── Polling ──
  const fetchAllJobs = useCallback(async () => {
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

  // Poll a single job by ID and merge into state
  const fetchSingleJob = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/jobs/${id}`);
      if (res.ok) {
        const job = await res.json();
        setJobs((prev) => prev.map((j) => (j.id === id ? job : j)));
      }
    } catch {
      /* ignore poll errors */
    }
  }, []);

  const fetchCredits = useCallback(async () => {
    try {
      const res = await fetch("/api/credits");
      if (res.ok) setCreditInfo(await res.json());
    } catch { /* ignore */ }
  }, []);

  // Check auth state on mount
  useEffect(() => {
    fetch("/api/auth")
      .then((r) => r.json())
      .then((d) => { if (d.user) setUser(d.user); })
      .catch(() => {});
    fetchCredits();
  }, [fetchCredits]);

  useEffect(() => {
    fetchAllJobs();
  }, [fetchAllJobs]);

  const hasActiveRef = useRef(false);
  const pollModeRef = useRef<string | null>(null);
  useEffect(() => {
    const hasActive = jobs.some(
      (j) => j.status === "pending" || j.status === "processing"
    );
    // Selective polling: if a single job is selected and active, poll just that job
    const selectedIsActive = selectedId && jobs.find(
      (j) => j.id === selectedId && (j.status === "pending" || j.status === "processing")
    );
    const pollMode = selectedIsActive ? selectedId : hasActive ? "all" : "idle";

    if (pollMode === pollModeRef.current && pollRef.current) return;
    pollModeRef.current = pollMode;
    hasActiveRef.current = hasActive;

    const interval = hasActive ? 3000 : 30000;
    const pollFn = selectedIsActive
      ? () => fetchSingleJob(selectedId!)
      : fetchAllJobs;

    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(pollFn, interval);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [jobs, selectedId, fetchAllJobs, fetchSingleJob]);

  // ── Upload ──
  const uploadFile = useCallback(async (file: File, formats?: string) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("intensity", intensity.toString());
    fd.append("colorMode", colorMode);
    fd.append("fillOcclusion", fillOcclusion.toString());
    if (formats) fd.append("formats", formats);

    const res = await fetch("/api/jobs", { method: "POST", body: fd });
    if (res.ok) {
      const job = await res.json();
      setJobs((prev) => [job, ...prev]);
      setSelectedId((prev) => prev ?? job.id);
      return true;
    } else if (res.status === 403) {
      const data = await res.json();
      setShowUpgrade(true);
      alert(data.error || "Usage limit reached");
      return false;
    }
    return true;
  }, [intensity, colorMode, fillOcclusion]);

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const fileArr = Array.from(files);

    // Check if any file is a video — show format picker before uploading
    const videoFile = fileArr.find(f => f.type.startsWith("video/"));
    if (videoFile) {
      // Get video duration client-side
      const url = URL.createObjectURL(videoFile);
      const video = document.createElement("video");
      video.preload = "metadata";
      video.src = url;
      video.onloadedmetadata = () => {
        const dur = Math.min(video.duration, 60);
        URL.revokeObjectURL(url);
        setPendingVideoFile({ file: videoFile, duration: dur });
      };
      video.onerror = () => {
        URL.revokeObjectURL(url);
        // Can't detect duration, just proceed with default
        setPendingVideoFile({ file: videoFile, duration: 60 });
      };
      // Upload non-video files immediately
      const imageFiles = fileArr.filter(f => !f.type.startsWith("video/"));
      if (imageFiles.length > 0) {
        setUploading(true);
        try {
          for (const f of imageFiles) {
            const ok = await uploadFile(f);
            if (!ok) break;
          }
        } finally {
          setUploading(false);
          fetchCredits();
        }
      }
      return;
    }

    // Images only — upload directly
    setUploading(true);
    try {
      for (const f of fileArr) {
        const ok = await uploadFile(f);
        if (!ok) break;
      }
    } catch (err) {
      console.error("Upload failed:", err);
    } finally {
      setUploading(false);
      fetchCredits();
    }
  }, [uploadFile, fetchCredits]);

  // Confirm video upload with selected formats
  const confirmVideoUpload = useCallback(async () => {
    if (!pendingVideoFile) return;
    const formats = Object.entries(videoFormats).filter(([, v]) => v).map(([k]) => k).join(",");
    if (!formats) { alert("Select at least one format"); return; }
    setUploading(true);
    setPendingVideoFile(null);
    try {
      await uploadFile(pendingVideoFile.file, formats);
    } catch (err) {
      console.error("Upload failed:", err);
    } finally {
      setUploading(false);
      fetchCredits();
    }
  }, [pendingVideoFile, videoFormats, uploadFile, fetchCredits]);

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

  // ── Google Sign-In ──
  const googleBtnRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showAuth || user) return;

    const clientId = process.env["NEXT_PUBLIC_GOOGLE_CLIENT_ID"];
    if (!clientId) return;

    // Load Google GSI script
    const existing = document.getElementById("google-gsi");
    if (!existing) {
      const script = document.createElement("script");
      script.id = "google-gsi";
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
      script.onload = initGoogle;
    } else {
      initGoogle();
    }

    function initGoogle() {
      if (!(window as unknown as Record<string, unknown>).google) return;
      const g = (window as unknown as { google: { accounts: { id: { initialize: (opts: Record<string, unknown>) => void; renderButton: (el: HTMLElement, opts: Record<string, unknown>) => void } } } }).google;
      g.accounts.id.initialize({
        client_id: clientId,
        callback: handleGoogleResponse,
      });
      if (googleBtnRef.current) {
        googleBtnRef.current.innerHTML = "";
        g.accounts.id.renderButton(googleBtnRef.current, {
          theme: "filled_black",
          size: "large",
          width: "100%",
          text: "signin_with",
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAuth, user]);

  async function handleGoogleResponse(response: { credential: string }) {
    setAuthLoading(true);
    setAuthError("");
    try {
      const res = await fetch("/api/auth/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential: response.credential }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAuthError(data.error || "Google sign-in failed");
        return;
      }
      setUser(data.user);
      setShowAuth(false);
      fetchAllJobs();
      fetchCredits();
    } catch {
      setAuthError("Network error");
    } finally {
      setAuthLoading(false);
    }
  }

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
      fetchAllJobs();
      fetchCredits();
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
    fetchAllJobs();
    fetchCredits();
  }

  async function handleRedeemCoupon() {
    setCouponMsg("");
    setCouponError("");
    try {
      const res = await fetch("/api/coupons/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: couponCode }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCouponError(data.error || "Failed");
        return;
      }
      setCouponMsg(data.message);
      setCouponCode("");
      fetchCredits();
    } catch {
      setCouponError("Network error");
    }
  }

  async function handleBuyCredits() {
    try {
      const res = await fetch("/api/checkout", { method: "POST" });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert(data.error || "Checkout failed");
      }
    } catch {
      alert("Checkout failed");
    }
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
          <div className="w-24">
            {jobs.length > 0 && (
              <button
                onClick={() => setShowOnboarding((v) => !v)}
                className="text-[11px] text-gray-500 hover:text-gray-300 transition-colors whitespace-nowrap"
              >
                How it works
              </button>
            )}
          </div>
          <div className="text-center">
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-400 bg-clip-text text-transparent">
              3D Image Generator
            </h1>
            <p className="text-gray-500 text-xs sm:text-sm mt-1.5">
              Upload photos or videos &rarr; AI depth estimation &rarr; 6 output formats
            </p>
          </div>
          <div className="w-auto min-w-[6rem] text-right">
            {user ? (
              <div className="flex items-center gap-2 text-xs justify-end flex-wrap">
                {creditInfo?.type === "user" && (
                  <span className="text-cyan-400 font-medium tabular-nums">
                    {creditInfo.credits} credits
                  </span>
                )}
                <span className="text-gray-500 hidden sm:inline">{user.email}</span>
                <button
                  onClick={handleLogout}
                  className="text-gray-500 hover:text-gray-300 transition-colors"
                >
                  Log out
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-xs justify-end">
                {creditInfo?.type === "anonymous" && (
                  <span className="text-gray-500 tabular-nums">
                    {creditInfo.remaining}/{creditInfo.limit} free
                  </span>
                )}
                <button
                  onClick={() => setShowAuth(!showAuth)}
                  className="text-gray-600 hover:text-gray-400 transition-colors"
                >
                  Log in
                </button>
              </div>
            )}
          </div>
        </div>
        {showAuth && !user && (
          <div className="max-w-xs mx-auto mt-3 bg-gray-900 border border-gray-700 rounded-xl p-4 space-y-3">
            {/* Google Sign-In */}
            <div ref={googleBtnRef} className="flex justify-center" />
            <div className="flex items-center gap-2 text-gray-600 text-[10px]">
              <div className="flex-1 border-t border-gray-700" />
              or
              <div className="flex-1 border-t border-gray-700" />
            </div>
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
        {/* Credits / Upgrade / Coupon panel */}
        {user && (showUpgrade || (creditInfo?.type === "user" && creditInfo.credits !== null && creditInfo.credits <= 5)) && (
          <div className="max-w-sm mx-auto mt-3 bg-gray-900 border border-gray-700 rounded-xl p-4 space-y-3">
            <p className="text-sm text-gray-300 text-center">
              {creditInfo?.credits === 0 ? "You're out of credits!" : `Only ${creditInfo?.credits} credits left!`}
            </p>
            <button
              onClick={handleBuyCredits}
              className="w-full py-2 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 rounded-lg text-sm font-medium transition-all"
            >
              Buy 100 Credits — $20
            </button>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Coupon code"
                value={couponCode}
                onChange={(e) => setCouponCode(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleRedeemCoupon()}
                className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 placeholder-gray-500"
              />
              <button
                onClick={handleRedeemCoupon}
                disabled={!couponCode.trim()}
                className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
              >
                Redeem
              </button>
            </div>
            {couponMsg && <p className="text-green-400 text-xs text-center">{couponMsg}</p>}
            {couponError && <p className="text-red-400 text-xs text-center">{couponError}</p>}
            <button
              onClick={() => setShowUpgrade(false)}
              className="w-full text-xs text-gray-600 hover:text-gray-400 transition-colors"
            >
              Dismiss
            </button>
          </div>
        )}
        {/* Anonymous upgrade prompt */}
        {!user && creditInfo?.type === "anonymous" && creditInfo.remaining === 0 && (
          <div className="max-w-sm mx-auto mt-3 bg-gray-900 border border-yellow-700/50 rounded-xl p-4 space-y-2 text-center">
            <p className="text-sm text-yellow-300">Free limit reached (20 images)</p>
            <p className="text-xs text-gray-400">Sign up for 50 free credits + ability to buy more</p>
            <button
              onClick={() => setShowAuth(true)}
              className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-sm font-medium transition-colors"
            >
              Create Free Account
            </button>
          </div>
        )}
      </header>

      {/* Controls — hidden during onboarding */}
      <div className={`flex flex-wrap items-center gap-x-4 gap-y-2 mb-6 sm:mb-8 bg-gray-900/60 backdrop-blur-sm rounded-2xl px-4 py-3 border border-gray-800/40 ${(jobs.length === 0 && !uploading) || showOnboarding ? "hidden" : ""}`}>
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

      {/* Onboarding flow — shown for first-time users or when manually triggered */}
      {((jobs.length === 0 && !uploading) || showOnboarding) && (
        <Suspense fallback={null}>
          <OnboardingFlow
            onGetStarted={() => { setShowOnboarding(false); fileInputRef.current?.click(); }}
            onClose={showOnboarding ? () => setShowOnboarding(false) : undefined}
          />
        </Suspense>
      )}

      {/* Video format picker modal */}
      {pendingVideoFile && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setPendingVideoFile(null)}>
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 max-w-md w-full space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-white">Video Processing Options</h3>
            <p className="text-sm text-gray-400">
              <span className="text-gray-200 font-medium">{pendingVideoFile.file.name}</span>
              {" "}&middot; {Math.round(pendingVideoFile.duration)}s at 15fps = {Math.ceil(pendingVideoFile.duration * 15)} frames
            </p>

            <div className="space-y-2">
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Output Formats</p>
              {([
                { key: "anaglyph", label: "Anaglyph 3D", desc: "Red/cyan glasses" },
                { key: "stereogram", label: "Magic Eye", desc: "Autostereogram" },
                { key: "sbs", label: "Side-by-Side", desc: "VR / cross-eye" },
              ] as const).map(({ key, label, desc }) => (
                <label key={key} className="flex items-center gap-3 p-3 rounded-lg bg-gray-800/50 border border-gray-700/50 cursor-pointer hover:border-gray-600 transition-colors">
                  <input
                    type="checkbox"
                    checked={videoFormats[key]}
                    onChange={(e) => setVideoFormats(prev => ({ ...prev, [key]: e.target.checked }))}
                    className="accent-cyan-500 rounded w-4 h-4"
                  />
                  <div>
                    <span className="text-sm text-gray-200">{label}</span>
                    <span className="text-xs text-gray-500 ml-2">{desc}</span>
                  </div>
                </label>
              ))}
            </div>

            {/* Time estimate */}
            {(() => {
              const frames = Math.ceil(pendingVideoFile.duration * 15);
              const formatCount = Object.values(videoFormats).filter(Boolean).length;
              if (formatCount === 0) return null;
              // ~25s base (depth) + ~5s per format per frame
              const secPerFrame = 25 + formatCount * 5;
              const totalSec = frames * secPerFrame;
              const hours = Math.floor(totalSec / 3600);
              const mins = Math.floor((totalSec % 3600) / 60);
              const timeStr = hours > 0 ? `~${hours}h ${mins}m` : `~${mins}m`;
              return (
                <div className="bg-gray-800 rounded-lg p-3 text-sm">
                  <div className="flex justify-between text-gray-300">
                    <span>Estimated time</span>
                    <span className="text-cyan-400 font-medium">{timeStr}</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    {frames} frames &times; {formatCount} format{formatCount > 1 ? "s" : ""} &middot; Processing happens on our server
                  </p>
                </div>
              );
            })()}

            <div className="flex gap-3">
              <button
                onClick={() => setPendingVideoFile(null)}
                className="flex-1 py-2.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm text-gray-300 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmVideoUpload}
                disabled={!Object.values(videoFormats).some(Boolean)}
                className="flex-1 py-2.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 rounded-lg text-sm font-medium text-white transition-colors"
              >
                Start Processing
              </button>
            </div>
          </div>
        </div>
      )}

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
                   ${jobs.length === 0 ? "p-4 border-gray-600" : "p-4 border-gray-700"}`}
      >
        {uploading ? (
          <div className="flex items-center justify-center gap-3">
            <div className="w-5 h-5 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-cyan-400">Uploading...</p>
          </div>
        ) : jobs.length === 0 ? (
          <p className="text-sm text-gray-400 hover:text-gray-300 transition-colors">
            {isDragging ? "Drop to convert" : "Or drop files here"}
          </p>
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
                    <option value="all-3d">All 3D Formats</option>
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
            {jobs.map((job) => (
              <JobThumbnail
                key={job.id}
                job={job}
                isSelected={selectedId === job.id}
                isChecked={selectedIds.has(job.id)}
                selectMode={selectMode}
                onClick={() => { if (selectMode) { toggleSelect(job.id); } else { setSelectedId(job.id); } }}
              />
            ))}
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
                        onClick={() => handleReprocess(selected.id, {})}
                        className="px-3 py-1.5 bg-cyan-700 hover:bg-cyan-600 rounded-lg text-xs font-medium transition-colors"
                      >
                        Rerun
                      </button>
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
                        onSave={() => { setEditingDepth(false); fetchAllJobs(); }}
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
                                        onClick={async (e) => {
                                          e.stopPropagation();
                                          setDownloading(true);
                                          try {
                                            const res = await fetch("/api/jobs/download", {
                                              method: "POST",
                                              headers: { "Content-Type": "application/json" },
                                              body: JSON.stringify({ ids: [selected.id], style: "all-3d" }),
                                            });
                                            if (!res.ok) return;
                                            const blob = await res.blob();
                                            const a = document.createElement("a");
                                            a.href = URL.createObjectURL(blob);
                                            a.download = `all-3d-${baseName}.zip`;
                                            a.click();
                                            URL.revokeObjectURL(a.href);
                                          } finally { setDownloading(false); }
                                        }}
                                        disabled={downloading}
                                        className="px-3 py-1.5 bg-purple-600/80 backdrop-blur-sm hover:bg-purple-500/80 active:scale-95 rounded-lg text-xs font-medium transition-all disabled:opacity-50"
                                      >
                                        {downloading ? "..." : "All 3D"}
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
                        {(() => {
                          const vidTabs = [
                            { id: "anaglyph", url: selected.videoUrl },
                            { id: "stereogram", url: selected.stereogramUrl },
                            { id: "sbs", url: selected.sbsUrl },
                          ];
                          const currentVid = vidTabs.find(t => t.id === activeTab) || vidTabs[0];
                          const currentUrl = currentVid?.url;
                          const baseName = selected.fileName.replace(/\.[^.]+$/, "");
                          return currentUrl ? (
                            <>
                              <button
                                onClick={() => handleDownload(currentUrl, `${activeTab === "anaglyph" ? "3d" : activeTab}-${baseName}.mp4`)}
                                className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-xs font-medium transition-colors"
                              >
                                Download
                              </button>
                              <button
                                onClick={async () => {
                                  setDownloading(true);
                                  try {
                                    const res = await fetch("/api/jobs/download", {
                                      method: "POST",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({ ids: [selected.id], style: "all-3d" }),
                                    });
                                    if (!res.ok) return;
                                    const blob = await res.blob();
                                    const a = document.createElement("a");
                                    a.href = URL.createObjectURL(blob);
                                    a.download = `all-3d-${baseName}.zip`;
                                    a.click();
                                    URL.revokeObjectURL(a.href);
                                  } finally { setDownloading(false); }
                                }}
                                disabled={downloading}
                                className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
                              >
                                {downloading ? "Zipping..." : "All 3D"}
                              </button>
                            </>
                          ) : null;
                        })()}
                        <button
                          onClick={() => handleDelete(selected.id)}
                          className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-xs font-medium transition-colors"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                    {/* Video format tabs */}
                    <div className="flex gap-1 mb-1">
                      {[
                        { id: "anaglyph", label: "3D", labelFull: "Anaglyph 3D", url: selected.videoUrl },
                        { id: "stereogram", label: "Eye", labelFull: "Magic Eye", url: selected.stereogramUrl },
                        { id: "sbs", label: "SBS", labelFull: "Side-by-Side", url: selected.sbsUrl },
                      ].map(tab => (
                        <button
                          key={tab.id}
                          onClick={() => setActiveTab(tab.id)}
                          className={`px-2.5 sm:px-3 py-1.5 rounded-lg text-[11px] sm:text-xs font-medium whitespace-nowrap transition-all
                            ${activeTab === tab.id
                              ? "bg-cyan-600 text-white shadow-lg shadow-cyan-500/20"
                              : tab.url
                                ? "bg-gray-800/80 text-gray-400 hover:text-gray-200 hover:bg-gray-700 active:scale-95"
                                : "bg-gray-800/30 text-gray-600 cursor-not-allowed"}`}
                          disabled={!tab.url}
                          title={tab.labelFull}
                        >
                          <span className="sm:hidden">{tab.label}</span>
                          <span className="hidden sm:inline">{tab.labelFull}</span>
                        </button>
                      ))}
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
                  {(() => {
                    const vidTabs = [
                      { id: "anaglyph", url: selected.videoUrl },
                      { id: "stereogram", url: selected.stereogramUrl },
                      { id: "sbs", url: selected.sbsUrl },
                    ];
                    const currentVid = vidTabs.find(t => t.id === activeTab) || vidTabs[0];
                    return currentVid?.url ? (
                      <video
                        key={`${selected.id}-${activeTab}`}
                        src={currentVid.url}
                        controls
                        loop
                        className="max-w-2xl mx-auto rounded-lg border border-gray-800"
                      />
                    ) : null;
                  })()}
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
                <div className="flex justify-center gap-2">
                  <button
                    onClick={() => handleReprocess(selected.id, {})}
                    className="px-4 py-1.5 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-xs font-medium transition-colors"
                  >
                    Reprocess
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
