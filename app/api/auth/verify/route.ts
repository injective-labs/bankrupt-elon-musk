import { NextResponse } from "next/server";
import { verifyAndIssueToken, isValidAddress } from "@/server/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: { address?: string; signature?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!isValidAddress(body.address) || typeof body.signature !== "string") {
    return NextResponse.json({ error: "Invalid address or signature" }, { status: 400 });
  }
  const token = await verifyAndIssueToken(body.address, body.signature);
  if (!token) {
    return NextResponse.json({ error: "Signature verification failed" }, { status: 401 });
  }
  return NextResponse.json({ token });
}
