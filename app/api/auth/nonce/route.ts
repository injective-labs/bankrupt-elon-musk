import { NextResponse } from "next/server";
import { createNonce, isValidAddress } from "@/server/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: { address?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!isValidAddress(body.address)) {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }
  const { nonce, message } = await createNonce(body.address);
  return NextResponse.json({ nonce, message });
}
