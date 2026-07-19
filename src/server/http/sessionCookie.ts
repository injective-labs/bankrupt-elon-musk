import type { NextResponse } from "next/server";

export const SESSION_COOKIE_NAME = "musk_session";
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
};

function secureCookie(): boolean {
  return process.env.NODE_ENV === "production";
}

export function setSessionCookie(response: NextResponse, token: string): void {
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    ...cookieOptions,
    secure: secureCookie(),
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    ...cookieOptions,
    secure: secureCookie(),
    maxAge: 0,
  });
}

export function readSessionCookie(request: Request): string | null {
  const cookie = request.headers.get("cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === SESSION_COOKIE_NAME) return decodeURIComponent(value.join("="));
  }
  return null;
}
