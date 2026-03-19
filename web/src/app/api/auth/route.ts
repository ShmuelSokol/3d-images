import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { getUserId, getSessionId, createAuthToken, AUTH_COOKIE } from "@/lib/session";
import { rateLimit } from "@/lib/rate-limit";

/**
 * GET /api/auth — check current auth state
 */
export async function GET(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) {
    return NextResponse.json({ user: null });
  }
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true },
  });
  return NextResponse.json({ user });
}

/**
 * POST /api/auth — login or register
 * body: { action: "login" | "register", email, password }
 */
export async function POST(req: NextRequest) {
  try {
    // Rate limit: 10 auth attempts per IP per minute
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const { allowed } = rateLimit(`auth:${ip}`, 10, 60_000);
    if (!allowed) {
      return NextResponse.json({ error: "Too many attempts. Try again in a minute." }, { status: 429 });
    }

    const { action, email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password required" }, { status: 400 });
    }

    if (action === "register") {
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        return NextResponse.json({ error: "Email already registered" }, { status: 400 });
      }

      const hashed = await bcrypt.hash(password, 10);
      const user = await prisma.user.create({
        data: { email, password: hashed },
      });

      // Link current session's jobs to this user
      const sessionId = getSessionId(req);
      await prisma.image.updateMany({
        where: { sessionId, userId: null },
        data: { userId: user.id },
      });

      const token = createAuthToken(user.id);
      const res = NextResponse.json({ user: { id: user.id, email: user.email } });
      res.cookies.set(AUTH_COOKIE, token, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 90, // 90 days
      });
      return res;
    }

    if (action === "login") {
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) {
        return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
      }

      const valid = await bcrypt.compare(password, user.password);
      if (!valid) {
        return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
      }

      // Link current session's jobs to this user
      const sessionId = getSessionId(req);
      await prisma.image.updateMany({
        where: { sessionId, userId: null },
        data: { userId: user.id },
      });

      const token = createAuthToken(user.id);
      const res = NextResponse.json({ user: { id: user.id, email: user.email } });
      res.cookies.set(AUTH_COOKIE, token, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 90, // 90 days
      });
      return res;
    }

    if (action === "logout") {
      const res = NextResponse.json({ ok: true });
      res.cookies.delete(AUTH_COOKIE);
      return res;
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    console.error("Auth error:", err);
    return NextResponse.json({ error: "Auth failed" }, { status: 500 });
  }
}
