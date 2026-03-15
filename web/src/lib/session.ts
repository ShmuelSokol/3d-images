import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env["JWT_SECRET"] || "3d-images-secret-key-change-in-prod";
const SESSION_COOKIE = "td_session";
const AUTH_COOKIE = "td_auth";

/**
 * Get or create a session ID from the request cookies.
 */
export function getSessionId(req: NextRequest): string {
  const existing = req.cookies.get(SESSION_COOKIE)?.value;
  if (existing) return existing;
  // Generate a new one — will be set on response
  return crypto.randomUUID();
}

/**
 * Set the session cookie on a response if it's new.
 */
export function setSessionCookie(res: NextResponse, sessionId: string, req: NextRequest): void {
  if (!req.cookies.get(SESSION_COOKIE)?.value) {
    res.cookies.set(SESSION_COOKIE, sessionId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365, // 1 year
    });
  }
}

/**
 * Get the logged-in user ID from the auth cookie, if any.
 */
export function getUserId(req: NextRequest): string | null {
  const token = req.cookies.get(AUTH_COOKIE)?.value;
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { userId: string };
    return payload.userId;
  } catch {
    return null;
  }
}

/**
 * Create a JWT token for a user.
 */
export function createAuthToken(userId: string): string {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: "90d" });
}

export { SESSION_COOKIE, AUTH_COOKIE };
