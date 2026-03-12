import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSupabase } from "@/lib/supabase";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const formData = await req.formData();
    const depthMap = formData.get("depthMap") as File | null;
    const anaglyph = formData.get("anaglyph") as File | null;
    const intensity = parseFloat(formData.get("intensity") as string) || 10;

    const supabase = getSupabase();
    const updates: Record<string, string | number> = { intensity };

    if (depthMap) {
      const depthBuf = Buffer.from(await depthMap.arrayBuffer());
      const depthName = `${id}-depth.png`;
      await supabase.storage
        .from("3d-images")
        .upload(`depth/${depthName}`, depthBuf, {
          contentType: "image/png",
          upsert: true,
        });
      const {
        data: { publicUrl },
      } = supabase.storage.from("3d-images").getPublicUrl(`depth/${depthName}`);
      updates.depthMapUrl = publicUrl;
    }

    if (anaglyph) {
      const anaBuf = Buffer.from(await anaglyph.arrayBuffer());
      const anaName = `${id}-anaglyph.png`;
      await supabase.storage
        .from("3d-images")
        .upload(`anaglyph/${anaName}`, anaBuf, {
          contentType: "image/png",
          upsert: true,
        });
      const {
        data: { publicUrl },
      } = supabase.storage
        .from("3d-images")
        .getPublicUrl(`anaglyph/${anaName}`);
      updates.anaglyphUrl = publicUrl;
    }

    const image = await prisma.image.update({
      where: { id },
      data: updates,
    });

    return NextResponse.json(image);
  } catch (err) {
    console.error("Save results error:", err);
    return NextResponse.json(
      { error: "Save results failed" },
      { status: 500 }
    );
  }
}
