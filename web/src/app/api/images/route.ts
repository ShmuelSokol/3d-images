import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSupabase } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const supabase = getSupabase();
    const buffer = Buffer.from(await file.arrayBuffer());
    const ext = file.name.split(".").pop() || "jpg";
    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("3d-images")
      .upload(`originals/${fileName}`, buffer, {
        contentType: file.type,
      });

    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from("3d-images").getPublicUrl(`originals/${fileName}`);

    // Get image dimensions from the client-sent metadata
    const width = parseInt(formData.get("width") as string) || 0;
    const height = parseInt(formData.get("height") as string) || 0;

    const image = await prisma.image.create({
      data: {
        originalUrl: publicUrl,
        fileName: file.name,
        width,
        height,
      },
    });

    return NextResponse.json(image);
  } catch (err) {
    console.error("Upload error:", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}

export async function GET() {
  try {
    const images = await prisma.image.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return NextResponse.json(images);
  } catch (err) {
    console.error("Fetch error:", err);
    return NextResponse.json({ error: "Fetch failed" }, { status: 500 });
  }
}
