import { SignJWT, jwtVerify } from "jose";
import { privateKeyToAccount } from "viem/accounts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { nonceFindUnique, nonceDeleteMany } = vi.hoisted(() => ({
  nonceFindUnique: vi.fn(),
  nonceDeleteMany: vi.fn(),
}));

vi.mock("./db", () => ({
  prisma: {
    authNonce: {
      findUnique: nonceFindUnique,
      deleteMany: nonceDeleteMany,
    },
  },
}));

import {
  authenticateGameRequest,
  authenticateRequest,
  verifyAgentToken,
  verifyAndIssueAgentToken,
  verifyAndIssueToken,
  verifyToken,
} from "./auth";

const privateKey = "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const account = privateKeyToAccount(privateKey);

describe("signed authentication", () => {
  beforeEach(() => {
    nonceFindUnique.mockReset();
    nonceDeleteMany.mockReset();
    vi.stubEnv("JWT_SECRET", "test-secret-at-least-32-bytes-long");
  });

  it("atomically consumes a signed nonce so concurrent replay succeeds once", async () => {
    const nonce = "nonce-1";
    const message = `Bankrupt Elon Musk — sign in\nAddress: ${account.address}\nNonce: ${nonce}`;
    const record = { walletAddress: account.address, nonce, message, expiresAt: new Date(Date.now() + 60_000) };
    nonceFindUnique.mockResolvedValue(record);
    let consumed = false;
    nonceDeleteMany.mockImplementation(async () => {
      if (consumed) return { count: 0 };
      consumed = true;
      return { count: 1 };
    });
    const signature = await account.signMessage({ message });

    const results = await Promise.all([
      verifyAndIssueToken(account.address.toLowerCase(), signature),
      verifyAndIssueToken(account.address.toLowerCase(), signature),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(nonceDeleteMany).toHaveBeenCalledTimes(2);
    expect(nonceDeleteMany.mock.calls[0][0].where).toMatchObject({
      walletAddress: account.address,
      nonce,
      expiresAt: { gt: expect.any(Date) },
    });
    expect(await verifyToken(results.find(Boolean)!)).toBe(account.address);
  });

  it("does not issue a token when atomic nonce consumption fails", async () => {
    const message = `Bankrupt Elon Musk — sign in\nAddress: ${account.address}\nNonce: nonce-1`;
    nonceFindUnique.mockResolvedValue({
      walletAddress: account.address,
      nonce: "nonce-1",
      message,
      expiresAt: new Date(Date.now() + 60_000),
    });
    nonceDeleteMany.mockRejectedValue(new Error("database unavailable"));
    const signature = await account.signMessage({ message });
    await expect(verifyAndIssueToken(account.address, signature)).rejects.toThrow("database unavailable");
  });

  it("rejects expired and wrong-secret JWTs and authenticates a valid cookie with checksum normalization", async () => {
    const currentSecret = new TextEncoder().encode("test-secret-at-least-32-bytes-long");
    const expired = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject(account.address.toLowerCase()).setExpirationTime("0s").sign(currentSecret);
    expect(await verifyToken(expired)).toBeNull();

    const wrongSecretToken = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject(account.address).setExpirationTime("1h").sign(new TextEncoder().encode("different-secret-at-least-32-bytes"));
    expect(await verifyToken(wrongSecretToken)).toBeNull();

    const valid = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject(account.address.toLowerCase()).setExpirationTime("1h").sign(currentSecret);
    const request = new Request("http://localhost/private", { headers: { cookie: `other=x; musk_session=${valid}` } });
    expect(await authenticateRequest(request)).toBe(account.address);
  });

  it("issues a distinct 15-minute AgentOS token with read and trade scopes", async () => {
    const nonce = "agent-nonce";
    const message = `Bankrupt Elon Musk — sign in\nAddress: ${account.address}\nNonce: ${nonce}`;
    nonceFindUnique.mockResolvedValue({
      walletAddress: account.address,
      nonce,
      message,
      expiresAt: new Date(Date.now() + 60_000),
    });
    nonceDeleteMany.mockResolvedValue({ count: 1 });

    const token = await verifyAndIssueAgentToken(
      account.address.toLowerCase(),
      await account.signMessage({ message }),
    );

    expect(token).not.toBeNull();
    const secret = new TextEncoder().encode("test-secret-at-least-32-bytes-long");
    const { payload } = await jwtVerify(token!, secret, { audience: "bankrupt-elon-agentos" });
    expect(payload.sub).toBe(account.address);
    expect(payload.scope).toBe("game:read game:trade");
    expect(payload.exp! - payload.iat!).toBeLessThanOrEqual(900);
    expect(payload.exp! - payload.iat!).toBeGreaterThanOrEqual(899);
    expect(await verifyAgentToken(token!)).toEqual({
      walletAddress: account.address,
      scopes: ["game:read", "game:trade"],
    });
    expect(await verifyToken(token!)).toBeNull();
  });

  it("rejects a normal cookie token as an AgentOS token", async () => {
    const secret = new TextEncoder().encode("test-secret-at-least-32-bytes-long");
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(account.address)
      .setExpirationTime("1h")
      .sign(secret);
    expect(await verifyAgentToken(token)).toBeNull();
  });

  it("uses an explicit Agent bearer before a stale cookie", async () => {
    const secret = new TextEncoder().encode("test-secret-at-least-32-bytes-long");
    const staleCookie = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("0x0000000000000000000000000000000000000001")
      .setExpirationTime("1h")
      .sign(secret);
    const agentToken = await new SignJWT({ scope: "game:read game:trade" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(account.address)
      .setAudience("bankrupt-elon-agentos")
      .setExpirationTime("15m")
      .sign(secret);
    const request = new Request("http://localhost/api/game", {
      headers: {
        authorization: `Bearer ${agentToken}`,
        cookie: `musk_session=${staleCookie}`,
      },
    });

    expect(await authenticateGameRequest(request, "game:read")).toBe(account.address);
  });

  it("does not fall back to a cookie for malformed bearer auth", async () => {
    const request = new Request("http://localhost/api/game", {
      headers: {
        authorization: "Basic bad",
        cookie: "musk_session=otherwise-valid",
      },
    });
    await expect(authenticateGameRequest(request, "game:read"))
      .rejects.toMatchObject({ status: 401, code: "UNAUTHORIZED" });
  });

  it("rejects an Agent token that lacks the required scope", async () => {
    const secret = new TextEncoder().encode("test-secret-at-least-32-bytes-long");
    const readOnly = await new SignJWT({ scope: "game:read" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(account.address)
      .setAudience("bankrupt-elon-agentos")
      .setExpirationTime("15m")
      .sign(secret);
    const request = new Request("http://localhost/api/trades", {
      headers: { authorization: `Bearer ${readOnly}` },
    });
    await expect(authenticateGameRequest(request, "game:trade"))
      .rejects.toMatchObject({ status: 403, code: "INSUFFICIENT_SCOPE" });
  });
});
