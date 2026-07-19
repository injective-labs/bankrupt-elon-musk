import { SignJWT } from "jose";
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

import { authenticateRequest, verifyAndIssueToken, verifyToken } from "./auth";

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
});
