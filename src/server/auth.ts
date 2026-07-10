import { randomBytes } from "node:crypto";
import { isAddress, verifyMessage, getAddress, type Hex } from "viem";
import { SignJWT, jwtVerify } from "jose";
import { prisma } from "./db";

const NONCE_TTL_MS = 5 * 60 * 1000;
const TOKEN_TTL = "7d";

const secret = new TextEncoder().encode(
  process.env.JWT_SECRET || "dev-insecure-secret-change-me",
);

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
    .sign(secret);
}

/** Verify a session JWT and return the wallet address (checksum) or null. */
export async function verifyToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}
