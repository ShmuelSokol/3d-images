"use client";

import { useState, useCallback, useEffect, useRef } from "react";

const BASE = "https://ushngszdltlctmqlwgot.supabase.co/storage/v1/object/public/3d-images";
const MAIN_ID = "cmmukn84k0001100wlhq1jqy7";
const VIDEO_ID = "cmmwe0ous0000qazwsthfi6mt";

const DEMO = {
  original: `${BASE}/originals/1773749482004-6vqotz14l2.jpeg`,
  anaglyph: `${BASE}/anaglyph/${MAIN_ID}-anaglyph.png`,
  depth: `${BASE}/depth/${MAIN_ID}-depth.png`,
  colormap: `${BASE}/distance/${MAIN_ID}-distance.png`,
  stereogram: `${BASE}/stereogram/${MAIN_ID}-stereogram.png`,
  sbs: `${BASE}/sbs/${MAIN_ID}-sbs.png`,
};

const OUTPUTS = [
  { key: "anaglyph", label: "Anaglyph 3D", desc: "Red/cyan glasses", color: "from-red-500 to-cyan-500", wide: false },
  { key: "depth", label: "Depth Map", desc: "AI depth per pixel", color: "from-gray-400 to-white", wide: false },
  { key: "colormap", label: "Color Map", desc: "Depth visualization", color: "from-blue-500 to-red-500", wide: false },
  { key: "stereogram", label: "Magic Eye", desc: "Autostereogram", color: "from-green-500 to-purple-500", wide: false },
  { key: "sbs", label: "Side-by-Side", desc: "Cross-eye 3D", color: "from-cyan-500 to-blue-500", wide: true },
];

const VIDEO_DEMO: Record<string, string | null> = {
  original: `${BASE}/originals/1773859284614-demo-video.mp4`,
  anaglyph: `${BASE}/videos/${VIDEO_ID}-anaglyph.mp4`,
  stereogram: null, // Too large for Supabase free tier (65MB); will work once compression fix deploys
  sbs: `${BASE}/videos/${VIDEO_ID}-sbs.mp4`,
};

// Build a flat gallery of all demo images for lightbox navigation
const MAIN_GALLERY = [
  { url: DEMO.original, label: "Original Photo" },
  ...OUTPUTS.map((o) => ({ url: DEMO[o.key as keyof typeof DEMO], label: o.label })),
];

// Additional examples with all output types
const EX_IDS = [
  { id: "cmmugaa000015hw68b9jx7jrq", label: "Vernal Fall & Rainbow", orig: "1773742159582-4itnjyhj0w6.jpeg" },
  { id: "cmmugacm7001bhw68xb6mkz34", label: "Yosemite Valley Sunset", orig: "1773742163001-yjr1ihnh3g.jpeg" },
  { id: "cmmuga4w7000thw68kq8rvuy3", label: "Merced River", orig: "1773742152987-ok99or8nboi.jpeg" },
];

const MORE_EXAMPLES = EX_IDS.map((ex) => ({
  label: ex.label,
  original: `${BASE}/originals/${ex.orig}`,
  outputs: [
    { url: `${BASE}/anaglyph/${ex.id}-anaglyph.png`, label: "Anaglyph 3D", desc: "Red/cyan glasses", color: "from-red-500 to-cyan-500", wide: false },
    { url: `${BASE}/depth/${ex.id}-depth.png`, label: "Depth Map", desc: "AI depth per pixel", color: "from-gray-400 to-white", wide: false },
    { url: `${BASE}/distance/${ex.id}-distance.png`, label: "Color Map", desc: "Depth visualization", color: "from-blue-500 to-red-500", wide: false },
    { url: `${BASE}/stereogram/${ex.id}-stereogram.png`, label: "Magic Eye", desc: "Autostereogram", color: "from-green-500 to-purple-500", wide: false },
    { url: `${BASE}/sbs/${ex.id}-sbs.png`, label: "Side-by-Side", desc: "Cross-eye 3D", color: "from-cyan-500 to-blue-500", wide: true },
  ],
}));

// Build galleries for each "more example"
const MORE_GALLERIES = MORE_EXAMPLES.map((ex) => [
  { url: ex.original, label: `${ex.label} — Original` },
  ...ex.outputs.map((o) => ({ url: o.url, label: `${ex.label} — ${o.label}` })),
]);

const VIDEO_FORMATS = [
  { key: "anaglyph" as const, label: "Anaglyph 3D", desc: "Red/cyan glasses", color: "from-red-500 to-cyan-500" },
  { key: "stereogram" as const, label: "Magic Eye", desc: "Autostereogram", color: "from-green-500 to-purple-500" },
  { key: "sbs" as const, label: "Side-by-Side", desc: "Cross-eye 3D", color: "from-cyan-500 to-blue-500" },
].filter((f) => VIDEO_DEMO[f.key]); // Only show formats that have a video URL

function VideoDemo() {
  const [activeFormat, setActiveFormat] = useState(0);
  const originalRef = useRef<HTMLVideoElement>(null);
  const outputRef = useRef<HTMLVideoElement>(null);

  // Sync output video time with original when switching tabs
  useEffect(() => {
    if (originalRef.current && outputRef.current) {
      outputRef.current.currentTime = originalRef.current.currentTime;
    }
  }, [activeFormat]);

  const fmt = VIDEO_FORMATS[activeFormat];

  return (
    <div className="bg-gray-900/40 backdrop-blur-sm border border-gray-800/30 rounded-2xl p-4 sm:p-6 mb-8">
      <p className="text-xs text-gray-500 text-center mb-4 tracking-wide uppercase font-medium">Video Demo</p>

      {/* Format tabs */}
      <div className="flex justify-center gap-2 mb-4">
        {VIDEO_FORMATS.map((f, i) => (
          <button
            key={f.key}
            onClick={() => setActiveFormat(i)}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
              i === activeFormat
                ? "bg-white/10 text-white border border-white/20"
                : "text-gray-500 hover:text-gray-300 border border-transparent"
            }`}
          >
            <span className={i === activeFormat ? `bg-gradient-to-r ${f.color} bg-clip-text text-transparent` : ""}>
              {f.label}
            </span>
          </button>
        ))}
      </div>

      {/* Side-by-side: original on left, 3D on right */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Original video */}
        <div className="relative rounded-xl overflow-hidden border border-gray-700/50">
          <video
            ref={originalRef}
            src={VIDEO_DEMO.original || undefined}
            autoPlay
            loop
            muted
            playsInline
            className="w-full aspect-video object-cover"
          />
          <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent px-3 py-2">
            <span className="text-xs font-semibold text-white/90">Original Video</span>
          </div>
        </div>

        {/* 3D output video */}
        <div className="relative rounded-xl overflow-hidden border border-gray-700/50">
          <video
            ref={outputRef}
            key={fmt.key}
            src={VIDEO_DEMO[fmt.key] || undefined}
            autoPlay
            loop
            muted
            playsInline
            className="w-full aspect-video object-cover"
          />
          <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent px-3 py-2">
            <span className={`text-xs font-semibold bg-gradient-to-r ${fmt.color} bg-clip-text text-transparent`}>
              {fmt.label}
            </span>
            <span className="text-[9px] text-white/40 ml-1.5">{fmt.desc}</span>
          </div>
        </div>
      </div>

      <p className="text-[10px] text-gray-600 text-center mt-3">
        Niagara Falls &middot; 50 seconds &middot; Upload any video and get 3D output in multiple formats
      </p>
    </div>
  );
}

interface OnboardingFlowProps {
  onGetStarted: () => void;
  onClose?: () => void;
}

export default function OnboardingFlow({ onGetStarted, onClose }: OnboardingFlowProps) {
  const [gallery, setGallery] = useState<{ items: { url: string; label: string }[]; index: number } | null>(null);

  const openGallery = useCallback((items: { url: string; label: string }[], index: number) => {
    setGallery({ items, index });
  }, []);

  const goNext = useCallback(() => {
    setGallery((g) => g ? { ...g, index: (g.index + 1) % g.items.length } : null);
  }, []);

  const goPrev = useCallback(() => {
    setGallery((g) => g ? { ...g, index: (g.index - 1 + g.items.length) % g.items.length } : null);
  }, []);

  // Keyboard navigation
  useEffect(() => {
    if (!gallery) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") goNext();
      else if (e.key === "ArrowLeft") goPrev();
      else if (e.key === "Escape") setGallery(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [gallery, goNext, goPrev]);

  const current = gallery ? gallery.items[gallery.index] : null;

  return (
    <div className="mb-8 sm:mb-10 animate-fade-in">
      {/* Lightbox gallery */}
      {gallery && current && (
        <div
          className="fixed inset-0 z-50 bg-black/95 flex flex-col items-center justify-center p-4"
          onClick={() => setGallery(null)}
        >
          {/* Close */}
          <button
            className="absolute top-4 right-4 text-white/70 hover:text-white transition-colors z-10"
            onClick={() => setGallery(null)}
          >
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          {/* Prev arrow */}
          {gallery.items.length > 1 && (
            <button
              className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors z-10"
              onClick={(e) => { e.stopPropagation(); goPrev(); }}
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
            </button>
          )}

          {/* Image */}
          <div className="max-w-6xl max-h-[85vh] w-full flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={current.url}
              src={current.url}
              alt={current.label}
              className="max-w-full max-h-[85vh] object-contain rounded-lg"
            />
          </div>

          {/* Next arrow */}
          {gallery.items.length > 1 && (
            <button
              className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors z-10"
              onClick={(e) => { e.stopPropagation(); goNext(); }}
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            </button>
          )}

          {/* Label + counter */}
          <div className="mt-3 text-center" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm text-gray-300">{current.label}</p>
            {gallery.items.length > 1 && (
              <p className="text-[10px] text-gray-500 mt-1">{gallery.index + 1} / {gallery.items.length} &middot; Arrow keys to navigate</p>
            )}
          </div>
        </div>
      )}

      {/* Close button for returning users */}
      {onClose && (
        <div className="flex justify-end mb-2">
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 transition-colors text-xs flex items-center gap-1"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
            Close
          </button>
        </div>
      )}

      {/* Results showcase — original + all outputs */}
      <div className="bg-gray-900/40 backdrop-blur-sm border border-gray-800/30 rounded-2xl p-4 sm:p-6 mb-6">
        <p className="text-xs text-gray-500 text-center mb-4 tracking-wide uppercase font-medium">Example Results</p>

        {/* Original — hero image */}
        <div className="mb-4">
          <div
            className="relative rounded-xl overflow-hidden border border-gray-700/50 cursor-pointer group"
            onClick={() => openGallery(MAIN_GALLERY, 0)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={DEMO.original}
              alt="Original photo — El Capitan, Yosemite"
              loading="lazy"
              className="w-full aspect-[16/9] object-cover group-hover:scale-[1.02] transition-transform duration-300"
            />
            <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent px-3 py-2">
              <span className="text-xs font-semibold text-white/90">Original Photo</span>
            </div>
          </div>
        </div>

        {/* Arrow */}
        <div className="flex justify-center mb-4 text-gray-600">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 13.5L12 21m0 0l-7.5-7.5M12 21V3" />
          </svg>
        </div>

        {/* All 5 outputs in a grid — SBS spans full width */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {OUTPUTS.map((fmt, i) => (
            <div
              key={fmt.key}
              className={`relative rounded-xl overflow-hidden border border-gray-700/50 cursor-pointer group ${fmt.wide ? "col-span-2 sm:col-span-4" : ""}`}
              onClick={() => openGallery(MAIN_GALLERY, i + 1)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={DEMO[fmt.key as keyof typeof DEMO]}
                alt={fmt.label}
                loading="lazy"
                className={`w-full ${fmt.wide ? "aspect-auto object-contain bg-black/50" : "aspect-[16/10] object-cover"} group-hover:scale-[1.01] transition-transform duration-300`}
              />
              <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent px-2 py-1.5">
                <span className={`text-[11px] font-semibold bg-gradient-to-r ${fmt.color} bg-clip-text text-transparent`}>
                  {fmt.label}
                </span>
                <span className="text-[9px] text-white/40 ml-1.5 hidden sm:inline">{fmt.desc}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* How it works — 3 steps */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6 mb-8">
        {/* Step 1 */}
        <div className="relative bg-gray-900/60 backdrop-blur-sm border border-gray-800/40 rounded-2xl p-5 sm:p-6 text-center group hover:border-cyan-800/40 transition-colors">
          <div className="absolute -top-3 left-1/2 -translate-x-1/2 w-7 h-7 rounded-full bg-cyan-600 text-white text-xs font-bold flex items-center justify-center shadow-lg shadow-cyan-500/20">
            1
          </div>
          <div className="text-3xl mb-3 mt-1">
            <svg className="w-10 h-10 mx-auto text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
          </div>
          <h3 className="text-sm font-semibold text-gray-100 mb-1">Upload Photo</h3>
          <p className="text-xs text-gray-500 leading-relaxed">
            Drop any JPG, PNG, or WebP image. Videos too.
          </p>
        </div>

        {/* Step 2 */}
        <div className="relative bg-gray-900/60 backdrop-blur-sm border border-gray-800/40 rounded-2xl p-5 sm:p-6 text-center group hover:border-purple-800/40 transition-colors">
          <div className="absolute -top-3 left-1/2 -translate-x-1/2 w-7 h-7 rounded-full bg-purple-600 text-white text-xs font-bold flex items-center justify-center shadow-lg shadow-purple-500/20">
            2
          </div>
          <div className="text-3xl mb-3 mt-1">
            <svg className="w-10 h-10 mx-auto text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
            </svg>
          </div>
          <h3 className="text-sm font-semibold text-gray-100 mb-1">AI Estimates Depth</h3>
          <p className="text-xs text-gray-500 leading-relaxed">
            Server-side AI analyzes every pixel&apos;s distance from the camera.
          </p>
        </div>

        {/* Step 3 */}
        <div className="relative bg-gray-900/60 backdrop-blur-sm border border-gray-800/40 rounded-2xl p-5 sm:p-6 text-center group hover:border-blue-800/40 transition-colors">
          <div className="absolute -top-3 left-1/2 -translate-x-1/2 w-7 h-7 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center shadow-lg shadow-blue-500/20">
            3
          </div>
          <div className="text-3xl mb-3 mt-1">
            <svg className="w-10 h-10 mx-auto text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
            </svg>
          </div>
          <h3 className="text-sm font-semibold text-gray-100 mb-1">Get 6 Outputs</h3>
          <p className="text-xs text-gray-500 leading-relaxed">
            Anaglyph 3D, depth map, color map, Magic Eye, side-by-side &amp; more.
          </p>
        </div>
      </div>

      {/* Features note */}
      <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 mb-8 text-xs text-gray-500">
        <div className="flex items-center gap-1.5">
          <svg className="w-4 h-4 text-cyan-500/70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
          </svg>
          Adjustable depth intensity
        </div>
        <div className="flex items-center gap-1.5">
          <svg className="w-4 h-4 text-purple-500/70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 01-1.125-1.125M3.375 19.5h1.5C5.496 19.5 6 18.996 6 18.375m-3.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m0 3.75h-1.5A1.125 1.125 0 0118 18.375M20.625 4.5H3.375m17.25 0c.621 0 1.125.504 1.125 1.125M20.625 4.5h-1.5C18.504 4.5 18 5.004 18 5.625m3.75 0v1.5c0 .621-.504 1.125-1.125 1.125M3.375 4.5c-.621 0-1.125.504-1.125 1.125M3.375 4.5h1.5C5.496 4.5 6 5.004 6 5.625m-3.75 0v1.5c0 .621.504 1.125 1.125 1.125m0 0h1.5m-1.5 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m1.5-3.75C5.496 8.25 6 7.746 6 7.125v-1.5M4.875 8.25C5.496 8.25 6 8.754 6 9.375v1.5m0-5.25v5.25m0-5.25C6 5.004 6.504 4.5 7.125 4.5h9.75c.621 0 1.125.504 1.125 1.125m1.125 2.625h1.5m-1.5 0A1.125 1.125 0 0118 7.125v-1.5m1.125 2.625c-.621 0-1.125.504-1.125 1.125v1.5m2.625-2.625c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125M18 5.625v5.25M7.125 12h9.75m-9.75 0A1.125 1.125 0 016 10.875M7.125 12C6.504 12 6 12.504 6 13.125m0-2.25C6 11.496 5.496 12 4.875 12M18 10.875c0 .621-.504 1.125-1.125 1.125M18 10.875c0 .621.504 1.125 1.125 1.125m-2.25 0c.621 0 1.125.504 1.125 1.125m-12 5.25v-5.25m0 5.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125m-12 0v-1.5c0-.621-.504-1.125-1.125-1.125M18 18.375v-5.25m0 5.25v-1.5c0-.621.504-1.125 1.125-1.125M18 13.125v1.5c0 .621.504 1.125 1.125 1.125M18 13.125c0-.621.504-1.125 1.125-1.125M6 13.125v1.5c0 .621-.504 1.125-1.125 1.125M6 13.125C6 12.504 5.496 12 4.875 12m-1.5 0h1.5m-1.5 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125M19.125 12h1.5m0 0c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125m-17.25 0h1.5m14.25 0h1.5" />
          </svg>
          Video support (paid)
        </div>
      </div>

      {/* Video demo */}
      <VideoDemo />

      {/* More examples — original + all outputs */}
      <div className="mb-8">
        <p className="text-xs text-gray-500 text-center mb-4 tracking-wide uppercase font-medium">More Examples</p>
        <div className="space-y-6">
          {MORE_EXAMPLES.map((ex, exIdx) => (
            <div key={ex.label}>
              <p className="text-[11px] text-gray-400 font-medium mb-2">{ex.label}</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {/* Original */}
                <div
                  className="relative rounded-xl overflow-hidden border border-gray-700/50 cursor-pointer group"
                  onClick={() => openGallery(MORE_GALLERIES[exIdx], 0)}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={ex.original} alt={`${ex.label} — Original`} loading="lazy" className="w-full aspect-[16/10] object-cover group-hover:scale-[1.02] transition-transform duration-300" />
                  <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-1">
                    <span className="text-[10px] text-white/80 font-medium">Original</span>
                  </div>
                </div>
                {/* Outputs */}
                {ex.outputs.map((out, outIdx) => (
                  <div
                    key={out.label}
                    className={`relative rounded-xl overflow-hidden border border-gray-700/50 cursor-pointer group ${out.wide ? "col-span-2 sm:col-span-4" : ""}`}
                    onClick={() => openGallery(MORE_GALLERIES[exIdx], outIdx + 1)}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={out.url}
                      alt={`${ex.label} — ${out.label}`}
                      loading="lazy"
                      className={`w-full ${out.wide ? "aspect-auto object-contain bg-black/50" : "aspect-[16/10] object-cover"} group-hover:scale-[1.01] transition-transform duration-300`}
                    />
                    <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-1">
                      <span className={`text-[10px] font-semibold bg-gradient-to-r ${out.color} bg-clip-text text-transparent`}>{out.label}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* CTA */}
      <div className="text-center">
        <button
          onClick={onGetStarted}
          className="px-6 py-2.5 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 rounded-xl text-sm font-semibold transition-all shadow-lg shadow-cyan-500/20 hover:shadow-cyan-500/30 active:scale-95"
        >
          Try It Now — Upload Your Photo
        </button>
        <p className="text-[10px] text-gray-600 mt-2">Free to use &middot; No account required &middot; Processing continues even if you close the page</p>
      </div>
    </div>
  );
}
