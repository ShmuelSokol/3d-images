/**
 * One-time script: generate stereogram + SBS for 3 scenic demo jobs
 * that were processed before those features existed.
 *
 * Usage: node --env-file=.env.local scripts/backfill-stereo-sbs.mjs
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE env vars. Run with --env-file=.env.local");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const JOBS = [
  { id: "cmmugaa000015hw68b9jx7jrq", name: "Vernal Fall" },
  { id: "cmmugacm7001bhw68xb6mkz34", name: "Valley Sunset" },
  { id: "cmmuga4w7000thw68kq8rvuy3", name: "Merced River" },
];

async function main() {
  // Dynamic imports for ESM compatibility
  const sharp = (await import("sharp")).default;
  const { estimateDepth } = await import("../src/lib/depth-estimator.ts");
  const { generateAutostereogram, generateSideBySide, decodeToRaw, rawToPng } =
    await import("../src/lib/server-anaglyph.ts");

  for (const job of JOBS) {
    console.log(`\n=== ${job.name} (${job.id}) ===`);

    // Get original URL from DB
    const { data: row, error: dbErr } = await supabase
      .from("td_image")
      .select("originalUrl")
      .eq("id", job.id)
      .single();
    if (dbErr || !row) {
      console.error(`  DB error:`, dbErr?.message || "not found");
      continue;
    }

    // Download original
    console.log("  Downloading original...");
    const res = await fetch(row.originalUrl);
    if (!res.ok) { console.error(`  Download failed: ${res.status}`); continue; }
    const inputBuffer = Buffer.from(await res.arrayBuffer());

    // Resize same as job-processor
    const rotated = Buffer.from(await sharp(inputBuffer).rotate().toBuffer());
    const meta = await sharp(rotated).metadata();
    let w = meta.width || 0;
    let h = meta.height || 0;
    const maxDim = 1024;
    let resized = rotated;
    if (w > maxDim || h > maxDim) {
      const s = maxDim / Math.max(w, h);
      w = Math.round(w * s);
      h = Math.round(h * s);
      resized = Buffer.from(await sharp(rotated).resize(w, h).jpeg({ quality: 85 }).toBuffer());
    }

    // Depth estimation
    console.log("  Running depth estimation...");
    const jpegBuf = Buffer.from(await sharp(resized).jpeg({ quality: 85 }).toBuffer());
    const depth = await estimateDepth(jpegBuf);

    // Decode to raw for SBS
    const raw = await decodeToRaw(resized);

    // Generate stereogram + SBS
    console.log("  Generating stereogram + SBS...");
    const stereogram = generateAutostereogram(depth.data, depth.width, depth.height, w, h);
    const sbs = generateSideBySide(raw, depth.data, depth.width, depth.height, 10);

    const [stereogramPng, sbsPng] = await Promise.all([
      rawToPng(stereogram),
      rawToPng(sbs),
    ]);

    // Upload
    console.log("  Uploading...");
    const [stereoUp, sbsUp] = await Promise.all([
      supabase.storage.from("3d-images").upload(`stereogram/${job.id}-stereogram.png`, stereogramPng, {
        contentType: "image/png", upsert: true,
      }),
      supabase.storage.from("3d-images").upload(`sbs/${job.id}-sbs.png`, sbsPng, {
        contentType: "image/png", upsert: true,
      }),
    ]);

    if (stereoUp.error) console.error("  Stereogram upload error:", stereoUp.error.message);
    if (sbsUp.error) console.error("  SBS upload error:", sbsUp.error.message);

    // Update DB
    const stereogramUrl = supabase.storage.from("3d-images").getPublicUrl(`stereogram/${job.id}-stereogram.png`).data.publicUrl;
    const sbsUrl = supabase.storage.from("3d-images").getPublicUrl(`sbs/${job.id}-sbs.png`).data.publicUrl;

    const { error: updateErr } = await supabase
      .from("td_image")
      .update({ stereogramUrl, sbsUrl })
      .eq("id", job.id);

    if (updateErr) console.error("  DB update error:", updateErr.message);
    else console.log("  Done!");
  }

  console.log("\nAll done.");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
