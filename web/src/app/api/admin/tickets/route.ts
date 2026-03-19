import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/session";

export const dynamic = "force-dynamic";

/** GET — list all tickets */
export async function GET(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tickets = await prisma.ticket.findMany({
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(tickets);
}

/** PATCH — update ticket status or add admin note */
export async function PATCH(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { ticketId, status, adminNote } = await req.json();

  if (!ticketId) {
    return NextResponse.json({ error: "ticketId required" }, { status: 400 });
  }

  const data: Record<string, string> = {};
  if (status) data.status = status;
  if (adminNote !== undefined) data.adminNote = adminNote;

  const updated = await prisma.ticket.update({
    where: { id: ticketId },
    data,
  });

  return NextResponse.json(updated);
}
