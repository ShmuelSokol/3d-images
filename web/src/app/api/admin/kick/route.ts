import { NextRequest, NextResponse } from "next/server";
import { jobQueue } from "@/lib/job-queue";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const expected = process.env["ADMIN_PASSWORD"];
  if (expected && auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const pending = await prisma.image.count({ where: { status: "pending" } });
  jobQueue.kick().catch(console.error);
  return NextResponse.json({ ok: true, pending, message: "Queue kicked" });
}
