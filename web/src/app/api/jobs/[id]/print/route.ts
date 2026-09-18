import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserId, isAdmin, ownsJob } from "@/lib/session";
import { rateLimit } from "@/lib/rate-limit";
import sharp from "sharp";

/**
 * Print export. The 3D render itself stays at the HD cap — the maths is
 * O(pixels) and a 24x36 at 300dpi would need ~300MB per raw buffer. This step
 * is a pure resample of the finished result, which libvips streams, so even a
 * 78-megapixel target stays well under 400MB.
 *
 * 150dpi is deliberate: it's the large-format standard, and at these sizes it
 * means little or no upscaling (18x24 is only 1.2x a 3072px render). 300dpi
 * would demand a 3.5x enlargement of detail that isn't there, for a poster
 * nobody views from six inches away.
 */
const DPI = 150;

// Portrait pixel dimensions at 150dpi. Landscape sources swap them.
const SIZES: Record<string, { w: number; h: number; label: string }> = {
  "12x18": { w: 1800, h: 2700, label: '12" x 18"' },
  "16x20": { w: 2400, h: 3000, label: '16" x 20"' },
  "18x24": { w: 2700, h: 3600, label: '18" x 24"' },
  "24x36": { w: 3600, h: 5400, label: '24" x 36"' },
  a2: { w: 2480, h: 3508, label: "A2 (42 x 59.4cm)" },
};

const FORMATS = ["anaglyph", "sbs", "stereogram"] as const;

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // A 24x36 resample is a few hundred MB inside libvips, and this route is
    // not queued the way render jobs are — several at once would stack against
    // the container's memory ceiling.
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const { allowed } = rateLimit(`print:${ip}`, 12, 600_000);
    if (!allowed) {
      return NextResponse.json(
        { error: "Too many print exports at once. Try again in a few minutes." },
        { status: 429 }
      );
    }

    const url = new URL(req.url);
    const sizeKey = (url.searchParams.get("size") || "18x24").toLowerCase();
    const size = SIZES[sizeKey];
    if (!size) {
      return NextResponse.json(
        { error: `Unknown size. Options: ${Object.keys(SIZES).join(", ")}` },
        { status: 400 }
      );
    }
    // "cover" fills the paper and trims the overhang; "contain" keeps the whole
    // image and adds a white margin. Square AI images lose a third of the
    // picture to a 2:3 crop, so this is the user's call, not ours.
    const fit = url.searchParams.get("fit") === "contain" ? "contain" : "cover";
    const format = (url.searchParams.get("format") || "anaglyph") as
      (typeof FORMATS)[number];
    if (!FORMATS.includes(format)) {
      return NextResponse.json({ error: "Unknown format" }, { status: 400 });
    }

    const job = await prisma.image.findUnique({ where: { id: params.id } });
    if (!job) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const admin = isAdmin(req);
    const userId = getUserId(req);
    if (!ownsJob(job, req)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (job.mediaType !== "image" || job.status !== "done") {
      return NextResponse.json(
        { error: "Only finished images can be exported for print." },
        { status: 400 }
      );
    }

    // Same entitlement as HD. A job already rendered at HD qualifies on its own
    // — that render was paid for, and printing it costs nothing extra.
    let entitled = admin || job.hiRes;
    if (!entitled && userId) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { plan: true, hdCredits: true },
      });
      entitled = user?.plan === "pro" || (user?.hdCredits ?? 0) > 0;
    }
    if (!entitled) {
      return NextResponse.json(
        {
          error:
            "Print export requires Pro or an HD export. A print made from a standard render would be upscaled several times over and look soft.",
          code: "PRO_REQUIRED",
        },
        { status: 403 }
      );
    }

    const sourceUrl =
      format === "sbs"
        ? job.sbsUrl
        : format === "stereogram"
          ? job.stereogramUrl
          : job.anaglyphUrl;
    if (!sourceUrl) {
      return NextResponse.json(
        { error: "That format isn't available for this image." },
        { status: 400 }
      );
    }

    const srcRes = await fetch(sourceUrl);
    if (!srcRes.ok) {
      return NextResponse.json({ error: "Could not read the source image." }, { status: 502 });
    }
    const srcBuf = Buffer.from(await srcRes.arrayBuffer());

    // Match the paper to the rendered image so a landscape photo prints
    // landscape. Side-by-side output is always about twice as wide as tall, so
    // it always lands on landscape paper — correct for a stereo pair, even
    // from a portrait original.
    const meta = await sharp(srcBuf).metadata();
    const landscape = (meta.width || 0) > (meta.height || 0);
    const targetW = landscape ? size.h : size.w;
    const targetH = landscape ? size.w : size.h;

    const out = await sharp(srcBuf)
      .resize(targetW, targetH, {
        fit,
        kernel: "lanczos3",
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      })
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .withMetadata({ density: DPI })
      // No mozjpeg: measured ~23x slower for ~5% smaller, and the user is
      // waiting on a download with no progress indication.
      .jpeg({ quality: 95, chromaSubsampling: "4:4:4" })
      .toBuffer();

    const name = `3d-${format}-${sizeKey}-${DPI}dpi.jpg`;
    return new NextResponse(new Uint8Array(out), {
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Length": String(out.length),
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    console.error("Print export error:", err);
    return NextResponse.json({ error: "Print export failed" }, { status: 500 });
  }
}

export const dynamic = "force-dynamic";
