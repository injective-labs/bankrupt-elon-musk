import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/server/http/sessionCookie";

export const runtime = "nodejs";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  clearSessionCookie(response);
  return response;
}
