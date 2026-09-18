import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";

/**
 * This secret signs both the admin cookie and every customer auth cookie, so a
 * guessable value lets anyone forge either. It previously fell back to a
 * literal committed to a public repo, which meant that with the env var unset
 * (as it was in production) anyone who read the repo could mint an admin token.
 *
 * Now it fails closed in production instead of silently running on a forgeable
 * secret. Resolved per call rather than at module load: this module is pulled
 * in while Next.js builds, and throwing there would break the build rather than
 * surface the misconfiguration at runtime.
 */
const DEV_FALLBACK_SECRET = "dev-only-insecure-secret";

function getJwtSecret(): string {
  const s = process.env["JWT_SECRET"];
  if (s && s.length >= 16) return s;
  if (process.env["NODE_ENV"] === "production") {
    throw new Error(
      "JWT_SECRET is missing or shorter than 16 characters. Set a strong " +
        "JWT_SECRET env var — sessions are forgeable without it."
    );
  }
  return DEV_FALLBACK_SECRET;
}
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
    const payload = jwt.verify(token, getJwtSecret()) as { userId: string };
    return payload.userId;
  } catch {
    return null;
  }
}

/**
 * Create a JWT token for a user.
 */
export function createAuthToken(userId: string): string {
  return jwt.sign({ userId }, getJwtSecret(), { expiresIn: "90d" });
}

const ADMIN_COOKIE = "td_admin";

/**
 * Check if the request is from an authenticated admin.
 */
export function isAdmin(req: NextRequest): boolean {
  const token = req.cookies.get(ADMIN_COOKIE)?.value;
  if (!token) return false;
  try {
    const payload = jwt.verify(token, getJwtSecret()) as { admin: boolean };
    return payload.admin === true;
  } catch {
    return false;
  }
}

/**
 * Create a JWT token for admin.
 */
export function createAdminToken(): string {
  return jwt.sign({ admin: true }, getJwtSecret(), { expiresIn: "7d" });
}

/**
 * A job belongs to the caller if they own it while logged in, or — for
 * anonymous jobs — if it was created in this browser session. Admins pass.
 *
 * Read the session cookie directly: getSessionId() mints a fresh id when none
 * exists, which would never match a stored one.
 *
 * Lives here rather than in a route so every caller shares one definition —
 * a second copy drifts the moment either is edited.
 */
export function ownsJob(
  job: { userId: string | null; sessionId: string | null },
  req: NextRequest
): boolean {
  if (isAdmin(req)) return true;
  const userId = getUserId(req);
  if (job.userId) return userId !== null && job.userId === userId;
  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  return !!job.sessionId && !!cookie && job.sessionId === cookie;
}

export { SESSION_COOKIE, AUTH_COOKIE, ADMIN_COOKIE };
