import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const ADMIN_EMAIL = "shmuelsokol@yahoo.com";
const ADMIN_HASH = "$2b$10$JxK5Bblt4aDkxFI4yx0ANeT4ha239LkZclaM.6vDDTNGf6eZQBl7S";
const JWT_SECRET = process.env["JWT_SECRET"] || "3d-images-secret-key-change-in-prod";
const ADMIN_COOKIE = "td_admin";

export function isAdmin(req: NextRequest): boolean {
  const token = req.cookies.get(ADMIN_COOKIE)?.value;
  if (!token) return false;
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { admin: boolean };
    return payload.admin === true;
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  return NextResponse.json({ admin: isAdmin(req) });
}

export async function POST(req: NextRequest) {
  try {
    const { action, email, password } = await req.json();

    if (action === "logout") {
      const res = NextResponse.json({ ok: true });
      res.cookies.delete(ADMIN_COOKIE);
      return res;
    }

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password required" }, { status: 400 });
    }

    if (email !== ADMIN_EMAIL) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    const valid = await bcrypt.compare(password, ADMIN_HASH);
    if (!valid) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    const token = jwt.sign({ admin: true }, JWT_SECRET, { expiresIn: "7d" });
    const res = NextResponse.json({ admin: true });
    res.cookies.set(ADMIN_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
    return res;
  } catch (err) {
    console.error("Admin auth error:", err);
    return NextResponse.json({ error: "Auth failed" }, { status: 500 });
  }
}
