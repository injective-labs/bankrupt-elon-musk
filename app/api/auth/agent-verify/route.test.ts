import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  issue: vi.fn(),
  loginPlayer: vi.fn(),
}));

vi.mock("@/server/auth", () => ({
  AGENT_TTL_SECONDS: 900,
  isValidAddress: (value: unknown) => typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value),
  verifyAndIssueAgentToken: mocks.issue,
}));
vi.mock("@/server/account", () => ({ loginPlayer: mocks.loginPlayer }));

import { POST } from "./route";

const wallet = "0x0000000000000000000000000000000000000001";

describe("POST /api/auth/agent-verify", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns a short-lived bearer and public wallet metadata without setting a cookie", async () => {
    mocks.issue.mockResolvedValue("agent.jwt");
    mocks.loginPlayer.mockResolvedValue({ walletAddress: wallet, walletName: "alice.inj" });

    const response = await POST(new Request("http://localhost/api/auth/agent-verify", {
      method: "POST",
      body: JSON.stringify({ address: wallet, signature: "0xsigned", walletName: "alice.inj" }),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      walletAddress: wallet,
      walletName: "alice.inj",
      accessToken: "agent.jwt",
      expiresIn: 900,
    });
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("returns 401 and no token or cookie for an invalid signature", async () => {
    mocks.issue.mockResolvedValue(null);
    const response = await POST(new Request("http://localhost/api/auth/agent-verify", {
      method: "POST",
      body: JSON.stringify({ address: wallet, signature: "bad" }),
    }));

    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(mocks.loginPlayer).not.toHaveBeenCalled();
    expect(JSON.stringify(await response.json())).not.toContain("accessToken");
  });
});
