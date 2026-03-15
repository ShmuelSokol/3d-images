"use client";

import { useState, useRef, useEffect, useCallback } from "react";

interface DepthEditorProps {
  depthMapUrl: string;
  originalUrl: string;
  jobId: string;
  onSave: () => void;
  onClose: () => void;
}

export default function DepthEditor({
  depthMapUrl,
  originalUrl,
  jobId,
  onSave,
  onClose,
}: DepthEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tolerance, setTolerance] = useState(25);
  const [depthShift, setDepthShift] = useState(0);
  const [hasSelection, setHasSelection] = useState(false);

  // Depth data (working copy, modified by user)
  const depthDataRef = useRef<Uint8ClampedArray | null>(null);
  // Original depth data (for reset)
  const originalDepthRef = useRef<Uint8ClampedArray | null>(null);
  // Selection mask: true = selected pixel
  const selectionRef = useRef<Uint8Array | null>(null);
  // Depth values of selected pixels before adjustment (snapshot at selection time)
  const selectionBaseRef = useRef<Uint8ClampedArray | null>(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  const bgImageRef = useRef<HTMLImageElement | null>(null);

  // Load images
  const loadImages = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const depthImg = new Image();
    depthImg.crossOrigin = "anonymous";
    const bgImg = new Image();
    bgImg.crossOrigin = "anonymous";

    let dLoaded = false, bLoaded = false;

    function tryDraw() {
      if (!dLoaded || !bLoaded) return;
      const w = depthImg.naturalWidth;
      const h = depthImg.naturalHeight;
      sizeRef.current = { w, h };
      canvas.width = w;
      canvas.height = h;

      // Also size the overlay canvas
      const overlay = overlayCanvasRef.current;
      if (overlay) { overlay.width = w; overlay.height = h; }

      bgImageRef.current = bgImg;
      ctx.drawImage(depthImg, 0, 0);
      const imgData = ctx.getImageData(0, 0, w, h);
      depthDataRef.current = new Uint8ClampedArray(imgData.data);
      originalDepthRef.current = new Uint8ClampedArray(imgData.data);
      selectionRef.current = new Uint8Array(w * h);
      setLoaded(true);
    }

    depthImg.onload = () => { dLoaded = true; tryDraw(); };
    bgImg.onload = () => { bLoaded = true; tryDraw(); };
    depthImg.src = depthMapUrl;
    bgImg.src = originalUrl;
  }, [depthMapUrl, originalUrl]);

  useEffect(() => { loadImages(); }, [loadImages]);

  // Get canvas coords from mouse event
  function getCanvasPos(e: React.MouseEvent<HTMLCanvasElement>): { x: number; y: number } | null {
    const canvas = overlayCanvasRef.current || canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    return {
      x: Math.floor((e.clientX - rect.left) * sx),
      y: Math.floor((e.clientY - rect.top) * sy),
    };
  }

  // Flood-fill selection: find all connected pixels with similar depth
  function floodSelect(startX: number, startY: number) {
    const { w, h } = sizeRef.current;
    const depth = depthDataRef.current;
    if (!depth || !selectionRef.current) return;

    const mask = selectionRef.current;
    mask.fill(0); // clear previous selection

    const seedIdx = (startY * w + startX) * 4;
    const seedVal = depth[seedIdx]; // grayscale R channel
    const tol = tolerance;

    // BFS flood fill
    const visited = new Uint8Array(w * h);
    const queue: number[] = [startX, startY];
    visited[startY * w + startX] = 1;

    while (queue.length > 0) {
      const cy = queue.pop()!;
      const cx = queue.pop()!;
      const pixVal = depth[(cy * w + cx) * 4];

      if (Math.abs(pixVal - seedVal) > tol) continue;

      mask[cy * w + cx] = 1;

      // 4-connected neighbors
      const neighbors = [
        [cx - 1, cy], [cx + 1, cy],
        [cx, cy - 1], [cx, cy + 1],
      ];
      for (const [nx, ny] of neighbors) {
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        if (visited[ny * w + nx]) continue;
        visited[ny * w + nx] = 1;
        queue.push(nx, ny);
      }
    }

    // Snapshot the current depth values of selected pixels
    const base = new Uint8ClampedArray(depth.length);
    base.set(depth);
    selectionBaseRef.current = base;

    setDepthShift(0);
    setHasSelection(true);
    drawOverlay();
  }

  // Draw selection highlight on overlay canvas
  const drawOverlay = useCallback(() => {
    const overlay = overlayCanvasRef.current;
    const mask = selectionRef.current;
    if (!overlay || !mask) return;
    const ctx = overlay.getContext("2d");
    if (!ctx) return;
    const { w, h } = sizeRef.current;

    ctx.clearRect(0, 0, w, h);
    const imgData = ctx.createImageData(w, h);
    const data = imgData.data;

    for (let i = 0; i < w * h; i++) {
      if (mask[i]) {
        data[i * 4] = 0;       // R
        data[i * 4 + 1] = 200; // G
        data[i * 4 + 2] = 255; // B
        data[i * 4 + 3] = 80;  // A — translucent cyan highlight
      }
    }
    ctx.putImageData(imgData, 0, 0);

    // Draw a border around the selection for clarity
    ctx.globalCompositeOperation = "source-over";
    // Edge detection: highlight border pixels
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!mask[y * w + x]) continue;
        const isEdge =
          (x === 0 || !mask[y * w + (x - 1)]) ||
          (x === w - 1 || !mask[y * w + (x + 1)]) ||
          (y === 0 || !mask[(y - 1) * w + x]) ||
          (y === h - 1 || !mask[(y + 1) * w + x]);
        if (isEdge) {
          ctx.fillStyle = "rgba(0, 220, 255, 0.8)";
          ctx.fillRect(x, y, 1, 1);
        }
      }
    }
  }, []);

  // Apply depth shift to selected pixels and redraw depth canvas
  const applyShift = useCallback((shift: number) => {
    const canvas = canvasRef.current;
    const depth = depthDataRef.current;
    const base = selectionBaseRef.current;
    const mask = selectionRef.current;
    if (!canvas || !depth || !base || !mask) return;

    const { w, h } = sizeRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Apply shift: positive = brighter = closer/pop out, negative = darker = farther
    for (let i = 0; i < w * h; i++) {
      if (mask[i]) {
        const baseVal = base[i * 4];
        const newVal = Math.max(0, Math.min(255, baseVal + shift));
        depth[i * 4] = newVal;
        depth[i * 4 + 1] = newVal;
        depth[i * 4 + 2] = newVal;
        depth[i * 4 + 3] = 255;
      }
    }

    const imgData = new ImageData(new Uint8ClampedArray(depth), w, h);
    ctx.putImageData(imgData, 0, 0);
  }, []);

  function handleCanvasClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const pos = getCanvasPos(e);
    if (!pos) return;
    floodSelect(pos.x, pos.y);
  }

  function handleDepthShiftChange(val: number) {
    setDepthShift(val);
    applyShift(val);
  }

  function handleClearSelection() {
    if (selectionRef.current) selectionRef.current.fill(0);
    const overlay = overlayCanvasRef.current;
    if (overlay) {
      const ctx = overlay.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, overlay.width, overlay.height);
    }
    setHasSelection(false);
    setDepthShift(0);
  }

  function handleReset() {
    const canvas = canvasRef.current;
    if (!canvas || !originalDepthRef.current) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { w, h } = sizeRef.current;
    depthDataRef.current = new Uint8ClampedArray(originalDepthRef.current);
    const imgData = new ImageData(new Uint8ClampedArray(originalDepthRef.current), w, h);
    ctx.putImageData(imgData, 0, 0);
    handleClearSelection();
  }

  async function handleSave() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setSaving(true);
    try {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png")
      );
      if (!blob) throw new Error("Failed to export canvas");
      const res = await fetch(`/api/jobs/${jobId}/depth`, {
        method: "PUT",
        headers: { "Content-Type": "image/png" },
        body: blob,
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Save failed");
      }
      onSave();
    } catch (err) {
      console.error("Depth save error:", err);
      alert("Failed to save: " + (err instanceof Error ? err.message : "Unknown error"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-300">Depth Editor</h3>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-lg leading-none">&times;</button>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-4 text-xs">
        <div className="flex items-center gap-1.5 text-gray-400">
          <span>Tolerance:</span>
          <input
            type="range" min="5" max="80" value={tolerance}
            onChange={(e) => setTolerance(parseInt(e.target.value))}
            className="w-20 accent-cyan-500 h-1.5"
          />
          <span className="text-cyan-400 tabular-nums w-5 text-right">{tolerance}</span>
        </div>

        {hasSelection && (
          <div className="flex items-center gap-1.5 text-gray-400">
            <span className="text-blue-400">Back</span>
            <input
              type="range" min="-128" max="128" value={depthShift}
              onChange={(e) => handleDepthShiftChange(parseInt(e.target.value))}
              className="w-32 accent-cyan-500 h-1.5"
            />
            <span className="text-orange-400">Forward</span>
            <span className="text-cyan-400 tabular-nums w-8 text-right">
              {depthShift > 0 ? "+" : ""}{depthShift}
            </span>
          </div>
        )}

        <div className="flex-1" />

        {hasSelection && (
          <button onClick={handleClearSelection}
            className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs transition-colors">
            Clear Selection
          </button>
        )}
        <button onClick={handleReset}
          className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs transition-colors">
          Reset
        </button>
        <button onClick={handleSave} disabled={saving}
          className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-xs font-medium transition-colors disabled:opacity-50">
          {saving ? "Reprocessing..." : "Save & Reprocess"}
        </button>
      </div>

      {/* Canvas area */}
      <div className="relative rounded-lg border border-gray-800 overflow-hidden" style={{ lineHeight: 0 }}>
        {/* Original image as background reference */}
        {loaded && bgImageRef.current && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={originalUrl} alt="" className="w-full pointer-events-none select-none" style={{ opacity: 0.5 }} draggable={false} />
        )}

        {/* Depth map canvas */}
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full pointer-events-none"
          style={{ opacity: loaded ? 0.55 : 1 }}
        />

        {/* Overlay canvas for selection highlight — receives click events */}
        <canvas
          ref={overlayCanvasRef}
          onClick={handleCanvasClick}
          className="absolute inset-0 w-full h-full"
          style={{ cursor: "crosshair" }}
        />

        {!loaded && (
          <div className="flex items-center justify-center h-48 text-gray-600 text-sm">
            Loading depth map...
          </div>
        )}
      </div>

      <p className="text-[10px] text-gray-600">
        Click on an object to select it (auto-detects similar depth). Use the slider to push it forward or back. Adjust tolerance to select more or less area.
      </p>
    </div>
  );
}
