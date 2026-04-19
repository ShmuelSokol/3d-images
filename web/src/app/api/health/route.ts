import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Verify every critical table exists. If any is missing, return 503 so
// Railway health checks fail visibly — loud canary for a schema wipe.
const CRITICAL_TABLES = ["user", "image", "coupon", "couponRedemption", "payment", "ticket"] as const;

export async function GET() {
  const missing: string[] = [];
  for (const t of CRITICAL_TABLES) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (prisma as any)[t].count();
    } catch {
      missing.push(t);
    }
  }

  if (missing.length > 0) {
    return NextResponse.json(
      { status: "schema-missing", missing },
      { status: 503 }
    );
  }

  return NextResponse.json({ status: "ok" });
}
