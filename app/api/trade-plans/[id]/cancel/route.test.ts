import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), cancel: vi.fn() }));
vi.mock("@/server/auth", () => ({ authenticateGameRequest: mocks.auth }));
vi.mock("@/server/tradePlans", () => ({ cancelTradePlan: mocks.cancel }));

import { POST } from "./route";

describe("POST /api/trade-plans/:id/cancel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue("0x0000000000000000000000000000000000000001");
    mocks.cancel.mockResolvedValue({ planId: "plan-1", status: "CANCELLED" });
  });

  it("cancels the route plan for the authenticated wallet", async () => {
    const response = await POST(new Request("http://localhost/api/trade-plans/plan-1/cancel", { method: "POST" }), {
      params: Promise.resolve({ id: "plan-1" }),
    });
    expect(response.status).toBe(200);
    expect(mocks.cancel).toHaveBeenCalledWith("0x0000000000000000000000000000000000000001", "plan-1");
  });
});
