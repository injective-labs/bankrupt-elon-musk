import { randomBytes } from "node:crypto";
import { isAddress, verifyMessage, getAddress, type Hex } from "viem";
import { SignJWT, jwtVerify } from "jose";
import { prisma } from "./db";
import { ApiError } from "./http/errors";
import { readSessionCookie } from "./http/sessionCookie";

const NONCE_TTL_MS = 5 * 60 * 1000;
const TOKEN_TTL = "7d";
export const AGENT_AUDIENCE = "bankrupt-elon-agentos";
export const AGENT_TTL_SECONDS = 15 * 60;
export const AGENT_SCOPES = ["game:read", "game:trade"] as const;
export type AgentScope = (typeof AGENT_SCOPES)[number];

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

async function verifyAndConsumeNonce(
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

  const consumed = await prisma.authNonce.deleteMany({
    where: {
      walletAddress: wallet,
      nonce: record.nonce,
      expiresAt: { gt: new Date() },
    },
  });
  if (consumed.count !== 1) return null;

  return wallet;
}

/** Verify the signature over the stored nonce message; on success issue a JWT. */
export async function verifyAndIssueToken(
  address: string,
  signature: string,
): Promise<string | null> {
  const wallet = await verifyAndConsumeNonce(address, signature);
  if (!wallet) return null;
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(wallet)
    .setIssuedAt()
    .setExpirationTime(TOKEN_TTL)
    .sign(jwtSecret());
}

export async function verifyAndIssueAgentToken(
  address: string,
  signature: string,
): Promise<string | null> {
  const wallet = await verifyAndConsumeNonce(address, signature);
  if (!wallet) return null;
  return new SignJWT({ scope: AGENT_SCOPES.join(" ") })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(wallet)
    .setAudience(AGENT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${AGENT_TTL_SECONDS}s`)
    .sign(jwtSecret());
}

/** Verify a session JWT and return the wallet address (checksum) or null. */
export async function verifyToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, jwtSecret());
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (audiences.includes(AGENT_AUDIENCE)) return null;
    return typeof payload.sub === "string" && isAddress(payload.sub)
      ? getAddress(payload.sub)
      : null;
  } catch {
    return null;
  }
}

export interface VerifiedAgentToken {
  walletAddress: string;
  scopes: AgentScope[];
}

export async function verifyAgentToken(token: string): Promise<VerifiedAgentToken | null> {
  try {
    const { payload } = await jwtVerify(token, jwtSecret(), { audience: AGENT_AUDIENCE });
    if (typeof payload.sub !== "string" || !isAddress(payload.sub)) return null;
    const suppliedScopes = typeof payload.scope === "string" ? payload.scope.split(/\s+/) : [];
    const scopes = AGENT_SCOPES.filter((scope) => suppliedScopes.includes(scope));
    return { walletAddress: getAddress(payload.sub), scopes: [...scopes] };
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

export async function authenticateGameRequest(
  request: Request,
  requiredScope: AgentScope,
): Promise<string> {
  const authorization = request.headers.get("authorization");
  if (authorization !== null) {
    const match = /^Bearer ([^\s,]+)$/.exec(authorization);
    if (!match) throw new ApiError(401, "UNAUTHORIZED", "Invalid bearer authorization");
    const verified = await verifyAgentToken(match[1]);
    if (!verified) throw new ApiError(401, "UNAUTHORIZED", "Invalid or expired agent session");
    if (!verified.scopes.includes(requiredScope)) {
      throw new ApiError(403, "INSUFFICIENT_SCOPE", "Agent session lacks the required scope");
    }
    return verified.walletAddress;
  }
  return authenticateRequest(request);
}
