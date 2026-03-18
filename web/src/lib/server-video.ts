import { execSync } from "child_process";
import { mkdirSync, rmSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { estimateDepth } from "./depth-estimator";
import {
  generateAnaglyphServer,
  generateAutostereogram,
  generateSideBySide,
  decodeToRaw,
  rawToPng,
} from "./server-anaglyph";
import { prisma } from "./prisma";
import { getSupabase } from "./supabase";

const TMP_DIR = "/tmp/3d-jobs";

/**
 * Process a video job: download → extract frames → depth+anaglyph → reassemble → upload.
 */
export async function processVideoJob(
  jobId: string,
  originalUrl: string,
  intensity: number,
  model: string,
  colorMode: string = "dubois",
  fillOcclusion: boolean = true
): Promise<{ videoUrl: string; stereogramUrl: string; sbsUrl: string }> {
  const jobDir = join(TMP_DIR, jobId);
  const framesDir = join(jobDir, "frames");
  const outAnaglyph = join(jobDir, "out-anaglyph");
  const outStereo = join(jobDir, "out-stereo");
  const outSbs = join(jobDir, "out-sbs");
  const inputPath = join(jobDir, "input");
  const anaglyphPath = join(jobDir, "output-anaglyph.mp4");
  const stereoPath = join(jobDir, "output-stereo.mp4");
  const sbsPath = join(jobDir, "output-sbs.mp4");

  try {
    mkdirSync(framesDir, { recursive: true });
    mkdirSync(outAnaglyph, { recursive: true });
    mkdirSync(outStereo, { recursive: true });
    mkdirSync(outSbs, { recursive: true });

    // Download original video
    console.log(`[video] Downloading: ${originalUrl}`);
    const res = await fetch(originalUrl);
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(inputPath, buf);

    // Get video info
    const probeJson = execSync(
      `ffprobe -v quiet -print_format json -show_streams "${inputPath}"`,
      { encoding: "utf-8" }
    );
    const probe = JSON.parse(probeJson);
    const videoStream = probe.streams.find(
      (s: { codec_type: string }) => s.codec_type === "video"
    );
    if (!videoStream) throw new Error("No video stream found");

    const duration = Math.min(
      parseFloat(videoStream.duration || "60"),
      60
    );
    const fps = 15;
    const totalFrames = Math.ceil(duration * fps);

    // Update job with frame count
    await prisma.image.update({
      where: { id: jobId },
      data: { frameCount: totalFrames, duration },
    });

    // Extract frames
    console.log(`[video] Extracting ${totalFrames} frames at ${fps}fps`);
    execSync(
      `ffmpeg -y -i "${inputPath}" -t ${duration} -vf "fps=${fps},scale='min(720,iw)':'min(720,ih)':force_original_aspect_ratio=decrease,pad=ceil(iw/2)*2:ceil(ih/2)*2" -q:v 2 "${framesDir}/frame-%04d.jpg"`,
      { stdio: "pipe" }
    );

    // Process each frame
    const frameFiles = readdirSync(framesDir).sort();
    console.log(`[video] Processing ${frameFiles.length} frames`);

    // Get frame dimensions for stereogram
    const firstFrame = Buffer.from(readFileSync(join(framesDir, frameFiles[0])));
    const firstRaw = await decodeToRaw(firstFrame);
    const frameW = firstRaw.width;
    const frameH = firstRaw.height;

    for (let i = 0; i < frameFiles.length; i++) {
      // Check if job was cancelled
      if (i % 3 === 0) {
        const check = await prisma.image.findUnique({ where: { id: jobId }, select: { status: true } });
        if (check?.status === "cancelled") {
          console.log(`[video] Job cancelled: ${jobId}`);
          throw new Error("Job cancelled by user");
        }
      }

      const framePath = join(framesDir, frameFiles[i]);
      const frameBuffer = Buffer.from(readFileSync(framePath));

      // Depth estimation (expensive — only once per frame)
      const depth = await estimateDepth(frameBuffer, model);
      const raw = await decodeToRaw(frameBuffer);

      // Generate all 3 formats
      const anaglyph = generateAnaglyphServer(
        raw, depth.data, depth.width, depth.height,
        intensity, (colorMode === "classic" ? "classic" : "dubois"), fillOcclusion
      );
      const stereogram = generateAutostereogram(depth.data, depth.width, depth.height, frameW, frameH);
      const sbs = generateSideBySide(raw, depth.data, depth.width, depth.height, intensity);

      const pad = String(i + 1).padStart(4, "0");
      const [anaPng, sterPng, sbsPng] = await Promise.all([
        rawToPng(anaglyph), rawToPng(stereogram), rawToPng(sbs),
      ]);
      writeFileSync(join(outAnaglyph, `frame-${pad}.png`), anaPng);
      writeFileSync(join(outStereo, `frame-${pad}.png`), sterPng);
      writeFileSync(join(outSbs, `frame-${pad}.png`), sbsPng);

      // Update progress
      if (i % 5 === 0 || i === frameFiles.length - 1) {
        await prisma.image.update({
          where: { id: jobId },
          data: { framesDone: i + 1 },
        });
      }
    }

    // Reassemble 3 videos with original audio
    console.log(`[video] Reassembling 3 videos`);
    const ffmpegBase = (inDir: string, outPath: string) =>
      `ffmpeg -y -framerate ${fps} -i "${inDir}/frame-%04d.png" -i "${inputPath}" -map 0:v -map 1:a? -c:v libx264 -c:a aac -pix_fmt yuv420p -crf 23 -shortest -movflags +faststart "${outPath}"`;
    execSync(ffmpegBase(outAnaglyph, anaglyphPath), { stdio: "pipe" });
    execSync(ffmpegBase(outStereo, stereoPath), { stdio: "pipe" });
    execSync(ffmpegBase(outSbs, sbsPath), { stdio: "pipe" });

    // Upload all 3
    const supabase = getSupabase();
    const uploads = [
      { local: anaglyphPath, remote: `videos/${jobId}-anaglyph.mp4` },
      { local: stereoPath, remote: `videos/${jobId}-stereogram.mp4` },
      { local: sbsPath, remote: `videos/${jobId}-sbs.mp4` },
    ];

    const urls: Record<string, string> = {};
    for (const u of uploads) {
      const buf = readFileSync(u.local);
      const { error } = await supabase.storage.from("3d-images").upload(u.remote, buf, { contentType: "video/mp4", upsert: true });
      if (error) throw new Error(`Upload failed (${u.remote}): ${error.message}`);
      urls[u.remote] = supabase.storage.from("3d-images").getPublicUrl(u.remote).data.publicUrl;
    }

    return {
      videoUrl: urls[`videos/${jobId}-anaglyph.mp4`],
      stereogramUrl: urls[`videos/${jobId}-stereogram.mp4`],
      sbsUrl: urls[`videos/${jobId}-sbs.mp4`],
    };
  } finally {
    // Cleanup
    try {
      rmSync(jobDir, { recursive: true, force: true });
    } catch {
      /* ignore cleanup errors */
    }
  }
}
