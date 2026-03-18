"use client";

import { useState, useRef, useCallback, useEffect } from "react";

// ── Types ──

interface CompareSliderProps {
  beforeUrl: string;
  afterUrl: string;
  beforeLabel?: string;
  afterLabel?: string;
}

// ── Component ──

export default function CompareSlider({
  beforeUrl,
  afterUrl,
  beforeLabel = "Before",
  afterLabel = "After",
}: CompareSliderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(50);
  const [isDragging, setIsDragging] = useState(false);

  const getPositionFromEvent = useCallback(
    (clientX: number): number => {
      const container = containerRef.current;
      if (!container) return 50;
      const rect = container.getBoundingClientRect();
      const x = clientX - rect.left;
      const pct = (x / rect.width) * 100;
      return Math.min(100, Math.max(0, pct));
    },
    []
  );

  // ── Mouse handlers ──

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging) return;
      setPosition(getPositionFromEvent(e.clientX));
    },
    [isDragging, getPositionFromEvent]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // ── Touch handlers ──

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    setIsDragging(true);
  }, []);

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (!isDragging) return;
      const touch = e.touches[0];
      if (touch) {
        setPosition(getPositionFromEvent(touch.clientX));
      }
    },
    [isDragging, getPositionFromEvent]
  );

  const handleTouchEnd = useCallback(() => {
    setIsDragging(false);
  }, []);

  // ── Global listeners for drag outside container ──

  useEffect(() => {
    if (isDragging) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      window.addEventListener("touchmove", handleTouchMove);
      window.addEventListener("touchend", handleTouchEnd);
    }
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
    };
  }, [isDragging, handleMouseMove, handleMouseUp, handleTouchMove, handleTouchEnd]);

  // ── Click anywhere on the container to jump ──

  const handleContainerClick = useCallback(
    (e: React.MouseEvent) => {
      setPosition(getPositionFromEvent(e.clientX));
    },
    [getPositionFromEvent]
  );

  return (
    <div
      ref={containerRef}
      className="relative w-full overflow-hidden rounded-xl border border-gray-800 select-none"
      style={{ cursor: isDragging ? "ew-resize" : "default" }}
      onClick={handleContainerClick}
    >
      {/* After image (full, sits behind) */}
      <img
        src={afterUrl}
        alt={afterLabel}
        draggable={false}
        className="block w-full h-auto object-cover"
      />

      {/* Before image (clipped from the left) */}
      <div
        className="absolute inset-0"
        style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
      >
        <img
          src={beforeUrl}
          alt={beforeLabel}
          draggable={false}
          className="block w-full h-full object-cover"
        />
      </div>

      {/* Divider line */}
      <div
        className="absolute top-0 bottom-0 w-0.5 bg-white/80 pointer-events-none"
        style={{ left: `${position}%`, transform: "translateX(-50%)" }}
      />

      {/* Drag handle */}
      <div
        className="absolute top-1/2 z-10 flex items-center justify-center w-10 h-10 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-gray-900/70 backdrop-blur-sm shadow-lg cursor-ew-resize"
        style={{ left: `${position}%` }}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
      >
        {/* Arrow icons */}
        <svg
          width="20"
          height="20"
          viewBox="0 0 20 20"
          fill="none"
          className="text-white"
        >
          <path
            d="M6 10L3 7M3 7L6 4M3 7H9M14 10L17 7M17 7L14 4M17 7H11"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            transform="translate(0,3)"
          />
        </svg>
      </div>

      {/* Before label */}
      <span className="absolute bottom-3 left-3 px-2 py-1 text-xs font-medium text-white bg-black/60 backdrop-blur-sm rounded">
        {beforeLabel}
      </span>

      {/* After label */}
      <span className="absolute bottom-3 right-3 px-2 py-1 text-xs font-medium text-white bg-black/60 backdrop-blur-sm rounded">
        {afterLabel}
      </span>
    </div>
  );
}
