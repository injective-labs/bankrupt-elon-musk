import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/server/http/errors";

const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), reset: vi.fn() }));
vi.mock("@/server/auth", () => ({ authenticateRequest: mocks.authenticate }));
vi.mock("@/server/reset", () => ({ resetAccount: mocks.reset }));

import { POST } from "./route";

describe("POST /api/game/reset", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("requires an authenticated session", async () => {
    mocks.authenticate.mockRejectedValue(new ApiError(401, "UNAUTHORIZED", "Invalid session"));
    const response = await POST(new Request("http://localhost/api/game/reset", { method: "POST", body: JSON.stringify({ idempotencyKey: "00000000-0000-4000-8000-000000000071" }) }));
    expect(response.status).toBe(401);
    expect(mocks.reset).not.toHaveBeenCalled();
  });

  it("uses only the authenticated wallet and idempotency key", async () => {
    mocks.authenticate.mockResolvedValue("0xsession");
    mocks.reset.mockResolvedValue({ walletAddress: "0xsession", cash: "50000000000" });
    const response = await POST(new Request("http://localhost/api/game/reset", { method: "POST", body: JSON.stringify({
      idempotencyKey: "00000000-0000-4000-8000-000000000071", walletAddress: "0xattacker", cash: "1", positions: [{ assetId: "x" }],
    }) }));
    expect(response.status).toBe(200);
    expect(mocks.reset).toHaveBeenCalledWith("0xsession", "00000000-0000-4000-8000-000000000071");
    expect(await response.json()).toEqual({ walletAddress: "0xsession", cash: "50000000000" });
  });

  it.each([{}, { idempotencyKey: "bad" }])("rejects a missing or malformed idempotency key", async (body) => {
    mocks.authenticate.mockResolvedValue("0xsession");
    const response = await POST(new Request("http://localhost/api/game/reset", { method: "POST", body: JSON.stringify(body) }));
    expect(response.status).toBe(422);
    expect(mocks.reset).not.toHaveBeenCalled();
  });
});
