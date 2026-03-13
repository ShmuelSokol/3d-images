import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const job = await prisma.image.findUnique({
      where: { id: params.id },
    });
    if (!job) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(job);
  } catch (err) {
    console.error("Fetch job error:", err);
    return NextResponse.json({ error: "Fetch failed" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json();

    if (body.action === "cancel") {
      await prisma.image.update({
        where: { id: params.id },
        data: { status: "cancelled" },
      });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    console.error("Patch job error:", err);
    return NextResponse.json({ error: "Patch failed" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await prisma.image.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Delete job error:", err);
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
}
