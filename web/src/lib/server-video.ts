import { execSync } from "child_process";
import { mkdirSync, rmSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { estimateDepth } from "./depth-estimator";
import {
  generateAnaglyphServer,
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
  model: string
): Promise<{ videoUrl: string }> {
  const jobDir = join(TMP_DIR, jobId);
  const framesDir = join(jobDir, "frames");
  const outDir = join(jobDir, "out");
  const inputPath = join(jobDir, "input");
  const outputPath = join(jobDir, "output.mp4");

  try {
    mkdirSync(framesDir, { recursive: true });
    mkdirSync(outDir, { recursive: true });

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

    for (let i = 0; i < frameFiles.length; i++) {
      const framePath = join(framesDir, frameFiles[i]);
      const frameBuffer = readFileSync(framePath);

      // Write frame to temp file for depth estimation
      const tmpFramePath = join(jobDir, "tmp-frame.jpg");
      writeFileSync(tmpFramePath, frameBuffer);

      // Depth estimation
      const depth = await estimateDepth(`file://${tmpFramePath}`, model);

      // Decode frame to raw RGBA
      const raw = await decodeToRaw(frameBuffer);

      // Generate anaglyph
      const anaglyph = generateAnaglyphServer(
        raw,
        depth.data,
        depth.width,
        depth.height,
        intensity
      );

      // Save processed frame
      const outPath = join(outDir, `frame-${String(i + 1).padStart(4, "0")}.png`);
      const pngBuf = await rawToPng(anaglyph);
      writeFileSync(outPath, pngBuf);

      // Update progress
      if (i % 5 === 0 || i === frameFiles.length - 1) {
        await prisma.image.update({
          where: { id: jobId },
          data: { framesDone: i + 1 },
        });
      }
    }

    // Reassemble video
    console.log(`[video] Reassembling video`);
    execSync(
      `ffmpeg -y -framerate ${fps} -i "${outDir}/frame-%04d.png" -c:v libx264 -pix_fmt yuv420p -crf 23 -movflags +faststart "${outputPath}"`,
      { stdio: "pipe" }
    );

    // Upload result
    const resultBuf = readFileSync(outputPath);
    const supabase = getSupabase();
    const storagePath = `videos/${jobId}-anaglyph.mp4`;

    const { error: uploadError } = await supabase.storage
      .from("3d-images")
      .upload(storagePath, resultBuf, {
        contentType: "video/mp4",
        upsert: true,
      });

    if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

    const {
      data: { publicUrl },
    } = supabase.storage.from("3d-images").getPublicUrl(storagePath);

    return { videoUrl: publicUrl };
  } finally {
    // Cleanup
    try {
      rmSync(jobDir, { recursive: true, force: true });
    } catch {
      /* ignore cleanup errors */
    }
  }
}
