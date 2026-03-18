"use client";

import { useState } from "react";

// Real processed demo images from Supabase
const DEMO = {
  original: "https://ushngszdltlctmqlwgot.supabase.co/storage/v1/object/public/3d-images/originals/1773805666776-9fqtqjuzzob.jpg",
  anaglyph: "https://ushngszdltlctmqlwgot.supabase.co/storage/v1/object/public/3d-images/anaglyph/cmmvi3gmq0001i5oss7qldoax-anaglyph.png",
  depth: "https://ushngszdltlctmqlwgot.supabase.co/storage/v1/object/public/3d-images/depth/cmmvi3gmq0001i5oss7qldoax-depth.png",
  colormap: "https://ushngszdltlctmqlwgot.supabase.co/storage/v1/object/public/3d-images/distance/cmmvi3gmq0001i5oss7qldoax-distance.png",
  stereogram: "https://ushngszdltlctmqlwgot.supabase.co/storage/v1/object/public/3d-images/stereogram/cmmvi3gmq0001i5oss7qldoax-stereogram.png",
  sbs: "https://ushngszdltlctmqlwgot.supabase.co/storage/v1/object/public/3d-images/sbs/cmmvi3gmq0001i5oss7qldoax-sbs.png",
};

const FORMATS = [
  { key: "anaglyph", label: "Anaglyph 3D", desc: "Red/cyan glasses", color: "from-red-500 to-cyan-500" },
  { key: "depth", label: "Depth Map", desc: "AI depth per pixel", color: "from-gray-400 to-white" },
  { key: "colormap", label: "Color Map", desc: "Depth visualization", color: "from-blue-500 to-red-500" },
  { key: "stereogram", label: "Magic Eye", desc: "Autostereogram", color: "from-green-500 to-purple-500" },
  { key: "sbs", label: "Side-by-Side", desc: "Cross-eye 3D", color: "from-cyan-500 to-blue-500" },
  { key: "original", label: "Original", desc: "Untouched photo", color: "from-gray-500 to-gray-400" },
];

interface OnboardingFlowProps {
  onGetStarted: () => void;
}

export default function OnboardingFlow({ onGetStarted }: OnboardingFlowProps) {
  const [activeFormat, setActiveFormat] = useState(0);
  const currentFormat = FORMATS[activeFormat];
  const currentUrl = DEMO[currentFormat.key as keyof typeof DEMO];

  return (
    <div className="mb-8 sm:mb-10 animate-fade-in">
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

      {/* Live demo: before → after with format selector */}
      <div className="bg-gray-900/40 backdrop-blur-sm border border-gray-800/30 rounded-2xl p-4 sm:p-6 mb-6">
        <p className="text-xs text-gray-500 text-center mb-4 tracking-wide uppercase font-medium">Live Example</p>

        {/* Before / After row */}
        <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 items-center mb-4">
          {/* Original (small) */}
          <div className="flex-shrink-0 w-full sm:w-36">
            <div className="relative rounded-xl overflow-hidden border border-gray-700/50">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={DEMO.original}
                alt="Original photo"
                loading="lazy"
                className="w-full aspect-square object-cover"
              />
              <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-1.5">
                <span className="text-[10px] text-white/80 font-medium">Original</span>
              </div>
            </div>
          </div>

          {/* Arrow */}
          <div className="flex-shrink-0 text-gray-600">
            <svg className="w-6 h-6 rotate-90 sm:rotate-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
            </svg>
          </div>

          {/* Output (large) */}
          <div className="flex-1 min-w-0 w-full">
            <div className="relative rounded-xl overflow-hidden border border-gray-700/50">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={currentUrl}
                alt={currentFormat.label}
                loading="lazy"
                className="w-full aspect-[16/10] object-cover transition-opacity duration-300"
              />
              <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent px-3 py-2">
                <span className={`text-xs font-semibold bg-gradient-to-r ${currentFormat.color} bg-clip-text text-transparent`}>
                  {currentFormat.label}
                </span>
                <span className="text-[10px] text-white/50 ml-2">{currentFormat.desc}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Format selector pills */}
        <div className="flex flex-wrap justify-center gap-1.5">
          {FORMATS.map((fmt, i) => (
            <button
              key={fmt.key}
              onClick={() => setActiveFormat(i)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-all
                ${activeFormat === i
                  ? "bg-white/10 text-white shadow-sm"
                  : "text-gray-500 hover:text-gray-300 hover:bg-white/5"
                }`}
            >
              {fmt.label}
            </button>
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
