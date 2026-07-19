import { randomBytes } from "node:crypto";
import { isAddress, verifyMessage, getAddress, type Hex } from "viem";
import { SignJWT, jwtVerify } from "jose";
import { prisma } from "./db";
import { ApiError } from "./http/errors";
import { readSessionCookie } from "./http/sessionCookie";

const NONCE_TTL_MS = 5 * 60 * 1000;
const TOKEN_TTL = "7d";

function jwtSecret(): Uint8Array {
  const value = process.env.JWT_SECRET;
  if (value) return new TextEncoder().encode(value);
  if (process.env.NODE_ENV !== "test" && process.env.NODE_ENV !== "development") {
    throw new Error("JWT_SECRET is required outside test and development");
  }
  return new TextEncoder().encode("dev-insecure-secret-change-me");
}

export function isValidAddress(address: unknown): address is string {
  return typeof address === "string" && isAddress(address);
}

function buildMessage(address: string, nonce: string): string {
  return `Bankrupt Elon Musk — sign in\nAddress: ${address}\nNonce: ${nonce}`;
}

/** Create (or replace) a login nonce for an address; returns the message to sign. */
export async function createNonce(address: string): Promise<{ nonce: string; message: string }> {
  const wallet = getAddress(address); // checksum-normalized
  const nonce = randomBytes(24).toString("hex");
  const message = buildMessage(wallet, nonce);
  const expiresAt = new Date(Date.now() + NONCE_TTL_MS);
  await prisma.authNonce.upsert({
    where: { walletAddress: wallet },
    create: { walletAddress: wallet, nonce, message, expiresAt },
    update: { nonce, message, expiresAt },
  });
  return { nonce, message };
}

/** Verify the signature over the stored nonce message; on success issue a JWT. */
export async function verifyAndIssueToken(
  address: string,
  signature: string,
): Promise<string | null> {
  const wallet = getAddress(address);
  const record = await prisma.authNonce.findUnique({ where: { walletAddress: wallet } });
  if (!record || record.expiresAt.getTime() < Date.now()) return null;

  let ok = false;
  try {
    ok = await verifyMessage({
      address: wallet as `0x${string}`,
      message: record.message,
      signature: signature as Hex,
    });
  } catch {
    ok = false;
  }
  if (!ok) return null;

  // One-time use: consume the nonce.
  await prisma.authNonce.delete({ where: { walletAddress: wallet } }).catch(() => {});

  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(wallet)
    .setIssuedAt()
    .setExpirationTime(TOKEN_TTL)
    .sign(jwtSecret());
}

/** Verify a session JWT and return the wallet address (checksum) or null. */
export async function verifyToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, jwtSecret());
    return typeof payload.sub === "string" && isAddress(payload.sub)
      ? getAddress(payload.sub)
      : null;
  } catch {
    return null;
  }
}

export async function authenticateRequest(request: Request): Promise<string> {
  const token = readSessionCookie(request);
  if (!token) throw new ApiError(401, "UNAUTHORIZED", "Authentication required");
  const wallet = await verifyToken(token);
  if (!wallet) throw new ApiError(401, "UNAUTHORIZED", "Invalid or expired session");
  return wallet;
}
