import { verifyToken } from "./auth";

/** Extract & verify the Bearer token from a request; returns wallet address or null. */
export async function requireWallet(request: Request): Promise<string | null> {
  const header = request.headers.get("authorization") || "";
  const match = header.match(/^Bearer (.+)$/i);
  if (!match) return null;
  return verifyToken(match[1]);
}
