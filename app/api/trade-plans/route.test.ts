import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), prepare: vi.fn() }));
vi.mock("@/server/auth", () => ({ authenticateGameRequest: mocks.auth }));
vi.mock("@/server/tradePlans", () => ({
  parseTradePlanRequest: (value: unknown) => value,
  prepareTradePlan: mocks.prepare,
}));

import { POST } from "./route";

describe("POST /api/trade-plans", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue("0x0000000000000000000000000000000000000001");
    mocks.prepare.mockResolvedValue({ planId: "00000000-0000-4000-8000-000000000001", status: "PENDING" });
  });

  it("prepares a wallet-bound plan using the game:trade scope", async () => {
    const body = { legs: [{ side: "BUY", asset: "DOGE", cashBps: 5000 }] };
    const response = await POST(new Request("http://localhost/api/trade-plans", {
      method: "POST",
      body: JSON.stringify(body),
    }));

    expect(response.status).toBe(200);
    expect(mocks.auth).toHaveBeenCalledWith(expect.any(Request), "game:trade");
    expect(mocks.prepare).toHaveBeenCalledWith("0x0000000000000000000000000000000000000001", body);
  });

  it("rejects malformed JSON before calling the domain", async () => {
    const response = await POST(new Request("http://localhost/api/trade-plans", { method: "POST", body: "{" }));
    expect(response.status).toBe(422);
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
});
