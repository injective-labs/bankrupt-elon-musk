import { beforeEach, describe, expect, it, vi } from "vitest";

const { verifyAndIssueToken, authenticateRequest, loginPlayer, findPlayer } = vi.hoisted(() => ({
  verifyAndIssueToken: vi.fn(),
  authenticateRequest: vi.fn(),
  loginPlayer: vi.fn(),
  findPlayer: vi.fn(),
}));

vi.mock("@/server/auth", () => ({
  isValidAddress: (value: unknown) => typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value),
  verifyAndIssueToken,
  authenticateRequest,
}));
vi.mock("@/server/account", () => ({ loginPlayer, findPlayer }));

import { POST as verify } from "./route";
import { GET as session } from "../session/route";
import { POST as logout } from "../logout/route";
import { ApiError } from "@/server/http/errors";

const wallet = "0x0000000000000000000000000000000000000001";

describe("wallet authentication routes", () => {
  beforeEach(() => {
    verifyAndIssueToken.mockReset();
    authenticateRequest.mockReset();
    loginPlayer.mockReset();
    findPlayer.mockReset();
  });

  it("sets a hardened session cookie and returns only public wallet metadata", async () => {
    verifyAndIssueToken.mockResolvedValue("signed.jwt");
    loginPlayer.mockResolvedValue({ walletAddress: wallet, walletName: "alice.inj" });

    const response = await verify(new Request("http://localhost/api/auth/verify", {
      method: "POST",
      body: JSON.stringify({ address: wallet, signature: "0xsigned", walletName: "alice.inj" }),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ walletAddress: wallet, walletName: "alice.inj" });
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("musk_session=signed.jwt");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie.toLowerCase()).toContain("samesite=lax");
  });

  it("sets no cookie for an invalid signature", async () => {
    verifyAndIssueToken.mockResolvedValue(null);

    const response = await verify(new Request("http://localhost/api/auth/verify", {
      method: "POST",
      body: JSON.stringify({ address: wallet, signature: "bad" }),
    }));

    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(loginPlayer).not.toHaveBeenCalled();
  });

  it.each(["missing", "expired"])("returns 401 for a %s session JWT", async () => {
    authenticateRequest.mockRejectedValue(new ApiError(401, "UNAUTHORIZED", "Invalid session"));
    const response = await session(new Request("http://localhost/api/auth/session"));
    expect(response.status).toBe(401);
  });

  it("returns the existing player's public wallet metadata", async () => {
    authenticateRequest.mockResolvedValue(wallet);
    findPlayer.mockResolvedValue({ walletAddress: wallet, walletName: "alice.inj" });
    const response = await session(new Request("http://localhost/api/auth/session"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ walletAddress: wallet, walletName: "alice.inj" });
  });

  it("logout expires the session cookie regardless of current validity", async () => {
    const response = await logout();
    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("musk_session=");
    expect(cookie).toContain("Max-Age=0");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Path=/");
    expect(cookie.toLowerCase()).toContain("samesite=lax");
  });
});
