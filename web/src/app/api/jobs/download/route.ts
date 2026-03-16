import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import JSZip from "jszip";

export async function POST(req: NextRequest) {
  try {
    const { ids } = await req.json();
    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: "No ids provided" }, { status: 400 });
    }

    const jobs = await prisma.image.findMany({
      where: { id: { in: ids }, status: "done" },
    });

    if (jobs.length === 0) {
      return NextResponse.json({ error: "No completed jobs found" }, { status: 404 });
    }

    // Single file — redirect directly
    if (jobs.length === 1) {
      const j = jobs[0];
      const url = j.mediaType === "video" ? j.videoUrl : j.anaglyphUrl;
      if (!url) return NextResponse.json({ error: "No output file" }, { status: 404 });
      const res = await fetch(url);
      if (!res.ok) return NextResponse.json({ error: "Download failed" }, { status: 500 });
      const buf = Buffer.from(await res.arrayBuffer());
      const ext = j.mediaType === "video" ? "mp4" : "png";
      return new NextResponse(buf, {
        headers: {
          "Content-Type": j.mediaType === "video" ? "video/mp4" : "image/png",
          "Content-Disposition": `attachment; filename="3d-${j.fileName.replace(/\.[^.]+$/, "")}.${ext}"`,
        },
      });
    }

    // Multiple files — zip
    const zip = new JSZip();
    const usedNames = new Set<string>();

    for (const j of jobs) {
      const url = j.mediaType === "video" ? j.videoUrl : j.anaglyphUrl;
      if (!url) continue;
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        const buf = Buffer.from(await res.arrayBuffer());
        const ext = j.mediaType === "video" ? "mp4" : "png";
        let name = `3d-${j.fileName.replace(/\.[^.]+$/, "")}.${ext}`;
        // Deduplicate names
        let counter = 1;
        while (usedNames.has(name)) {
          name = `3d-${j.fileName.replace(/\.[^.]+$/, "")}-${counter}.${ext}`;
          counter++;
        }
        usedNames.add(name);
        zip.file(name, buf);
      } catch {
        // skip failed downloads
      }
    }

    if (Object.keys(zip.files).length === 0) {
      return NextResponse.json({ error: "No files could be fetched" }, { status: 500 });
    }

    const zipBuffer = await zip.generateAsync({ type: "arraybuffer" });

    return new NextResponse(Buffer.from(zipBuffer) as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="3d-images.zip"',
      },
    });
  } catch (err) {
    console.error("[download] Error:", err);
    return NextResponse.json({ error: "Download failed" }, { status: 500 });
  }
}
