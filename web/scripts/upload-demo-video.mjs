/**
 * One-time script: upload demo video to Supabase and create a job record.
 * Usage: npx tsx --env-file=.env scripts/upload-demo-video.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE env vars");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const prisma = new PrismaClient();

async function main() {
  const videoPath = "/tmp/yosemite-50s.mp4";
  const fileName = "yosemite-valley-demo.mp4";
  const buf = readFileSync(videoPath);

  // Upload to Supabase
  const storagePath = `originals/${Date.now()}-demo-video.mp4`;
  console.log("Uploading to Supabase...");
  const { error: uploadErr } = await supabase.storage
    .from("3d-images")
    .upload(storagePath, buf, { contentType: "video/mp4", upsert: true });
  if (uploadErr) { console.error("Upload error:", uploadErr.message); process.exit(1); }

  const originalUrl = supabase.storage.from("3d-images").getPublicUrl(storagePath).data.publicUrl;
  console.log("Uploaded:", originalUrl);

  // Create job record
  const job = await prisma.image.create({
    data: {
      originalUrl,
      fileName,
      width: 1280,
      height: 720,
      intensity: 10,
      colorMode: "dubois",
      fillOcclusion: true,
      status: "pending",
      mediaType: "video",
    },
  });

  console.log("Job created:", job.id);
  console.log("The job will be picked up by the queue on the server.");
  console.log("Once processed, use this job ID for the demo.");

  await prisma.$disconnect();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
