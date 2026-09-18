"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

interface LibraryItem {
  id: string;
  anaglyphUrl: string | null;
  stereogramUrl: string | null;
  sbsUrl: string | null;
  videoUrl: string | null;
  width: number;
  height: number;
  intensity: number;
  colorMode: string;
  mediaType: string;
  publishedAt: string | null;
}

type Filter = "all" | "image" | "video";
type View = "anaglyph" | "stereogram" | "sbs";

export default function LibraryPage() {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [lightbox, setLightbox] = useState<LibraryItem | null>(null);
  const [view, setView] = useState<View>("anaglyph");

  const load = useCallback(async (nextPage: number, f: Filter, append: boolean) => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ page: String(nextPage) });
      if (f !== "all") qs.set("type", f);
      const res = await fetch(`/api/library?${qs}`);
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json();
      setItems((prev) => (append ? [...prev, ...data.items] : data.items));
      setHasMore(data.hasMore);
      setTotal(data.total);
      setPage(nextPage);
    } catch {
      if (!append) setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(0, filter, false);
  }, [filter, load]);

  // Close the lightbox on Escape.
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

  function previewOf(item: LibraryItem): string | null {
    return item.anaglyphUrl || item.stereogramUrl || item.sbsUrl;
  }

  function urlFor(item: LibraryItem, v: View): string | null {
    if (v === "stereogram") return item.stereogramUrl;
    if (v === "sbs") return item.sbsUrl;
    return item.anaglyphUrl;
  }

  return (
    <main className="min-h-screen bg-black text-white px-4 py-10">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between gap-4 flex-wrap mb-2">
          <h1 className="text-3xl font-bold">Community Library</h1>
          <Link
            href="/"
            className="text-xs px-3 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg transition-colors"
          >
            Make your own
          </Link>
        </div>
        <p className="text-gray-400 text-sm mb-6">
          3D results shared by other users. Grab your red/cyan glasses — no credits needed to browse.
          {total > 0 && <span className="text-gray-500"> · {total} shared</span>}
        </p>

        <div className="flex gap-2 mb-6">
          {(["all", "image", "video"] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                filter === f
                  ? "bg-cyan-600 text-white"
                  : "bg-gray-800 text-gray-400 hover:bg-gray-700"
              }`}
            >
              {f === "all" ? "Everything" : f === "image" ? "Images" : "Videos"}
            </button>
          ))}
        </div>

        {loading && items.length === 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="aspect-square bg-gray-900 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-20 border border-gray-800 rounded-xl">
            <p className="text-gray-400 mb-2">Nothing shared yet.</p>
            <p className="text-gray-600 text-sm mb-5">
              Finish a 3D conversion and hit “Share to library” to be the first.
            </p>
            <Link
              href="/"
              className="inline-block px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-sm transition-colors"
            >
              Create a 3D image
            </Link>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {items.map((item) => {
                const preview = previewOf(item);
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      setView("anaglyph");
                      setLightbox(item);
                    }}
                    className="group relative aspect-square bg-gray-900 rounded-xl overflow-hidden border border-gray-800 hover:border-cyan-600 transition-colors"
                  >
                    {item.mediaType === "video" && item.videoUrl ? (
                      <video
                        src={item.videoUrl}
                        muted
                        loop
                        playsInline
                        onMouseEnter={(e) => void e.currentTarget.play().catch(() => {})}
                        onMouseLeave={(e) => e.currentTarget.pause()}
                        className="w-full h-full object-cover"
                      />
                    ) : preview ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={preview}
                        alt="Shared 3D result"
                        loading="lazy"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-600 text-xs">
                        No preview
                      </div>
                    )}
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <p className="text-[10px] text-gray-300">
                        {item.mediaType === "video" ? "Video" : `${item.width}×${item.height}`} ·{" "}
                        {item.colorMode === "classic" ? "Classic" : "Dubois"}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>

            {hasMore && (
              <div className="text-center mt-8">
                <button
                  onClick={() => load(page + 1, filter, true)}
                  disabled={loading}
                  className="px-5 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm transition-colors disabled:opacity-50"
                >
                  {loading ? "Loading…" : "Load more"}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {lightbox && (
        <div
          className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <div
            className="max-w-5xl w-full max-h-full overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {lightbox.mediaType === "video" && lightbox.videoUrl ? (
              <video src={lightbox.videoUrl} controls autoPlay loop className="w-full rounded-xl" />
            ) : (
              <>
                {(() => {
                  const src = urlFor(lightbox, view);
                  return src ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={src} alt="Shared 3D result" className="w-full rounded-xl" />
                  ) : (
                    <p className="text-center text-gray-400 py-10">That format isn’t available.</p>
                  );
                })()}
                <div className="flex justify-center gap-2 mt-4">
                  {(["anaglyph", "stereogram", "sbs"] as View[]).map((v) => (
                    <button
                      key={v}
                      disabled={!urlFor(lightbox, v)}
                      onClick={() => setView(v)}
                      className={`px-3 py-1.5 rounded-lg text-xs transition-colors disabled:opacity-30 ${
                        view === v ? "bg-cyan-600" : "bg-gray-800 hover:bg-gray-700"
                      }`}
                    >
                      {v === "sbs" ? "Side-by-side" : v === "anaglyph" ? "Red/Cyan" : "Stereogram"}
                    </button>
                  ))}
                </div>
              </>
            )}
            <div className="flex justify-center gap-3 mt-4">
              <a
                href={
                  (lightbox.mediaType === "video"
                    ? lightbox.videoUrl
                    : urlFor(lightbox, view)) || "#"
                }
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-sm transition-colors"
              >
                Open full size
              </a>
              <button
                onClick={() => setLightbox(null)}
                className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
