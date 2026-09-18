import "server-only";
// Server side of "Sync with Google Drive" (OAuth 2.0 web server flow).
// The refresh token never reaches the browser: it lives in an encrypted,
// httpOnly cookie, and /api/google/token trades it for short-lived access tokens.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import type { NextRequest } from "next/server";

export const TOKEN_COOKIE = "fn_google";
export const STATE_COOKIE = "fn_google_state";
export const COOKIE_PATH = "/api/google";
// "profile" gives the account's name, used to fill in "Your name" when it's empty.
export const SCOPES = ["openid", "email", "profile", "https://www.googleapis.com/auth/drive.appdata"];

export interface GoogleSession {
  refreshToken: string;
  email: string | null;
  /** First name (or full name) from the Google account, when the profile scope was granted. */
  name?: string | null;
}

export const googleConfigured = () => Boolean(process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

/** Public origin of this deployment (works behind Netlify/Vercel proxies). */
export function publicOrigin(req: NextRequest) {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0] ?? new URL(req.url).protocol.replace(":", "");
  return host ? `${proto}://${host}` : new URL(req.url).origin;
}

export const redirectUri = (req: NextRequest) => process.env.GOOGLE_REDIRECT_URI || `${publicOrigin(req)}/api/google/callback`;

export const cookieOptions = (maxAgeSeconds: number) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: COOKIE_PATH,
  maxAge: maxAgeSeconds,
});

const key = () =>
  createHash("sha256").update(`four-notes-google:${process.env.GOOGLE_TOKEN_SECRET || process.env.GOOGLE_CLIENT_SECRET}`).digest();

/** AES-256-GCM so the cookie can't be read or altered by the client. */
export function seal(data: object) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(data), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
}

export function unseal<T>(value?: string): T | null {
  if (!value) return null;
  try {
    const buf = Buffer.from(value, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key(), buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8")) as T;
  } catch {
    return null;
  }
}

export class GoogleTokenError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
  }
}

export async function googleTokenRequest(params: Record<string, string>) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      ...params,
    }),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string; expires_in?: number; refresh_token?: string; id_token?: string; scope?: string;
    error?: string; error_description?: string;
  };
  if (!res.ok || !json.access_token) {
    throw new GoogleTokenError(json.error_description || json.error || `Google token request failed (${res.status})`, json.error);
  }
  return json as typeof json & { access_token: string; expires_in: number };
}

/** The id_token comes straight from Google's token endpoint over TLS, so reading its payload is safe here. */
export function profileFromIdToken(idToken?: string): { email: string | null; name: string | null } {
  try {
    const payload = JSON.parse(Buffer.from(idToken!.split(".")[1], "base64url").toString("utf8")) as {
      email?: string; given_name?: string; name?: string;
    };
    // First name reads better in the daily brief greeting than the full name.
    const name = (payload.given_name || payload.name || "").trim().slice(0, 60);
    return { email: payload.email ?? null, name: name || null };
  } catch {
    return { email: null, name: null };
  }
}
