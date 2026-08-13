import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), execute: vi.fn() }));
vi.mock("@/server/auth", () => ({ authenticateGameRequest: mocks.auth }));
vi.mock("@/server/tradePlans", () => ({ executeTradePlan: mocks.execute }));

import { POST } from "./route";

describe("POST /api/trade-plans/:id/execute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue("0x0000000000000000000000000000000000000001");
    mocks.execute.mockResolvedValue({ planId: "plan-1", legs: [] });
  });

  it("executes only the route plan with the supplied confirmation signature", async () => {
    const response = await POST(new Request("http://localhost/api/trade-plans/plan-1/execute", {
      method: "POST",
      body: JSON.stringify({ signature: "0x1234" }),
    }), { params: Promise.resolve({ id: "plan-1" }) });
    expect(response.status).toBe(200);
    expect(mocks.auth).toHaveBeenCalledWith(expect.any(Request), "game:trade");
    expect(mocks.execute).toHaveBeenCalledWith("0x0000000000000000000000000000000000000001", "plan-1", "0x1234");
  });

  it("rejects extra authority fields", async () => {
    const response = await POST(new Request("http://localhost/api/trade-plans/plan-1/execute", {
      method: "POST",
      body: JSON.stringify({ signature: "0x1234", walletAddress: "0xattacker" }),
    }), { params: Promise.resolve({ id: "plan-1" }) });
    expect(response.status).toBe(422);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
