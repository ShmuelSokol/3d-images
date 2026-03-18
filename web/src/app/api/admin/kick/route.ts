import { NextRequest, NextResponse } from "next/server";
import { jobQueue } from "@/lib/job-queue";

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const expected = process.env["ADMIN_PASSWORD"];
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  jobQueue.kick().catch(console.error);
  return NextResponse.json({ ok: true, message: "Queue kicked" });
}
