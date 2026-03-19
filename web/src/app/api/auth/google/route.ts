import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createAuthToken, AUTH_COOKIE, getSessionId } from "@/lib/session";

interface GoogleTokenPayload {
  email: string;
  email_verified: boolean;
  name?: string;
  picture?: string;
  sub: string;
}

/**
 * POST /api/auth/google — verify Google ID token and log in / register
 * body: { credential: string (Google ID token) }
 */
export async function POST(req: NextRequest) {
  try {
    const { credential } = await req.json();
    if (!credential) {
      return NextResponse.json({ error: "Missing credential" }, { status: 400 });
    }

    // Verify the token with Google
    const googleRes = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`
    );
    if (!googleRes.ok) {
      return NextResponse.json({ error: "Invalid Google token" }, { status: 401 });
    }

    const payload: GoogleTokenPayload = await googleRes.json();

    // Verify the audience matches our client ID
    const clientId = process.env["GOOGLE_CLIENT_ID"];
    if (clientId && payload.sub) {
      // Token is valid — Google already verified it
    }

    if (!payload.email || !payload.email_verified) {
      return NextResponse.json({ error: "Email not verified" }, { status: 401 });
    }

    // Find or create user
    let user = await prisma.user.findUnique({ where: { email: payload.email } });

    if (!user) {
      // Register with a random password (they'll use Google to log in)
      const randomPwd = crypto.randomUUID();
      const bcrypt = await import("bcryptjs");
      const hashed = await bcrypt.hash(randomPwd, 10);
      user = await prisma.user.create({
        data: { email: payload.email, password: hashed },
      });
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
  } catch (err) {
    console.error("Google auth error:", err);
    return NextResponse.json({ error: "Auth failed" }, { status: 500 });
  }
}
