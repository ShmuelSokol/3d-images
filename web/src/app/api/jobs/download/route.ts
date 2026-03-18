import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import JSZip from "jszip";

export const maxDuration = 300;

type StyleType = "anaglyph" | "stereogram" | "sbs" | "depth" | "colormap" | "all-3d";

function getUrlForStyle(job: Record<string, unknown>, style: StyleType): string | null {
  switch (style) {
    case "stereogram": return job.stereogramUrl as string | null;
    case "sbs": return job.sbsUrl as string | null;
    case "depth": return job.depthMapUrl as string | null;
    case "colormap": return job.distanceMapUrl as string | null;
    default: return (job.mediaType === "video" ? job.videoUrl : job.anaglyphUrl) as string | null;
  }
}

function getAll3DUrls(job: Record<string, unknown>): { url: string; prefix: string }[] {
  const isVideo = job.mediaType === "video";
  const entries = [
    { url: (isVideo ? job.videoUrl : job.anaglyphUrl) as string | null, prefix: "3d" },
    { url: job.stereogramUrl as string | null, prefix: "stereogram" },
    { url: job.sbsUrl as string | null, prefix: "sbs" },
  ];
  return entries.filter((e): e is { url: string; prefix: string } => !!e.url);
}

const STYLE_PREFIX: Record<string, string> = {
  anaglyph: "3d",
  stereogram: "stereogram",
  sbs: "sbs",
  depth: "depth",
  colormap: "colormap",
  "all-3d": "all-3d",
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { ids, style: rawStyle } = body;
    const style: StyleType = ["anaglyph", "stereogram", "sbs", "depth", "colormap", "all-3d"].includes(rawStyle) ? rawStyle : "anaglyph";

    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: "No ids provided" }, { status: 400 });
    }

    const jobs = await prisma.image.findMany({
      where: { id: { in: ids }, status: "done" },
    });

    if (jobs.length === 0) {
      return NextResponse.json({ error: "No completed jobs found" }, { status: 404 });
    }

    const prefix = STYLE_PREFIX[style];

    // All 3D formats — always zip
    if (style === "all-3d") {
      const zip = new JSZip();
      const usedNames = new Set<string>();

      const fetches: Promise<void>[] = [];
      for (const j of jobs) {
        const urls = getAll3DUrls(j as unknown as Record<string, unknown>);
        for (const { url, prefix: p } of urls) {
          fetches.push(
            fetch(url).then(async (res) => {
              if (!res.ok) return;
              const buf = Buffer.from(await res.arrayBuffer());
              const ext = j.mediaType === "video" ? "mp4" : "png";
              let name = `${p}-${j.fileName.replace(/\.[^.]+$/, "")}.${ext}`;
              let counter = 1;
              while (usedNames.has(name)) { name = `${p}-${j.fileName.replace(/\.[^.]+$/, "")}-${counter}.${ext}`; counter++; }
              usedNames.add(name);
              zip.file(name, buf);
            })
          );
        }
      }
      await Promise.allSettled(fetches);

      if (Object.keys(zip.files).length === 0) {
        return NextResponse.json({ error: "No files could be fetched" }, { status: 500 });
      }
      const zipBytes = await zip.generateAsync({ type: "uint8array", streamFiles: true });
      return new Response(zipBytes as unknown as BodyInit, {
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="all-3d.zip"`,
          "Content-Length": zipBytes.length.toString(),
        },
      });
    }

    // Single file — stream directly without buffering
    if (jobs.length === 1) {
      const j = jobs[0];
      const url = getUrlForStyle(j as unknown as Record<string, unknown>, style);
      if (!url) return NextResponse.json({ error: "No output file for this style" }, { status: 404 });
      const upstream = await fetch(url);
      if (!upstream.ok || !upstream.body) return NextResponse.json({ error: "Download failed" }, { status: 500 });
      const ext = j.mediaType === "video" ? "mp4" : "png";
      return new Response(upstream.body, {
        headers: {
          "Content-Type": j.mediaType === "video" ? "video/mp4" : "image/png",
          "Content-Disposition": `attachment; filename="${prefix}-${j.fileName.replace(/\.[^.]+$/, "")}.${ext}"`,
          ...(upstream.headers.get("content-length") ? { "Content-Length": upstream.headers.get("content-length")! } : {}),
        },
      });
    }

    // Multiple — zip (still needs buffering for zip format, but fetch files in parallel with streaming)
    const zip = new JSZip();
    const usedNames = new Set<string>();

    const results = await Promise.allSettled(
      jobs.map(async (j) => {
        const url = getUrlForStyle(j as unknown as Record<string, unknown>, style);
        if (!url) return null;
        const res = await fetch(url);
        if (!res.ok) return null;
        const buf = Buffer.from(await res.arrayBuffer());
        const ext = j.mediaType === "video" ? "mp4" : "png";
        return { buf, ext, fileName: j.fileName };
      })
    );

    for (const r of results) {
      if (r.status !== "fulfilled" || !r.value) continue;
      const { buf, ext, fileName } = r.value;
      let name = `${prefix}-${fileName.replace(/\.[^.]+$/, "")}.${ext}`;
      let counter = 1;
      while (usedNames.has(name)) {
        name = `${prefix}-${fileName.replace(/\.[^.]+$/, "")}-${counter}.${ext}`;
        counter++;
      }
      usedNames.add(name);
      zip.file(name, buf);
    }

    if (Object.keys(zip.files).length === 0) {
      return NextResponse.json({ error: "No files could be fetched" }, { status: 500 });
    }

    // Generate zip as Uint8Array for Response compatibility
    const zipBytes = await zip.generateAsync({ type: "uint8array", streamFiles: true });

    return new Response(zipBytes as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${prefix}-images.zip"`,
        "Content-Length": zipBytes.length.toString(),
      },
    });
  } catch (err) {
    console.error("[download] Error:", err);
    return NextResponse.json({ error: "Download failed" }, { status: 500 });
  }
}
