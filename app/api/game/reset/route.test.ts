import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/server/http/errors";

const mocks = vi.hoisted(() => ({ authenticateGame: vi.fn(), authenticateLegacy: vi.fn(), reset: vi.fn() }));
vi.mock("@/server/auth", () => ({
  authenticateGameRequest: mocks.authenticateGame,
  authenticateRequest: mocks.authenticateLegacy,
}));
vi.mock("@/server/reset", () => ({ resetAccount: mocks.reset }));

import { POST } from "./route";

describe("POST /api/game/reset", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("requires an authenticated session", async () => {
    mocks.authenticateGame.mockRejectedValue(new ApiError(401, "UNAUTHORIZED", "Invalid session"));
    mocks.authenticateLegacy.mockRejectedValue(new ApiError(401, "UNAUTHORIZED", "Invalid session"));
    const response = await POST(new Request("http://localhost/api/game/reset", { method: "POST", body: JSON.stringify({ idempotencyKey: "00000000-0000-4000-8000-000000000071" }) }));
    expect(response.status).toBe(401);
    expect(mocks.reset).not.toHaveBeenCalled();
  });

  it("uses only the authenticated wallet and idempotency key", async () => {
    mocks.authenticateGame.mockResolvedValue("0xsession");
    mocks.authenticateLegacy.mockResolvedValue("0xlegacy");
    mocks.reset.mockResolvedValue({ walletAddress: "0xsession", cash: "50000000000" });
    const response = await POST(new Request("http://localhost/api/game/reset", { method: "POST", body: JSON.stringify({
      idempotencyKey: "00000000-0000-4000-8000-000000000071", walletAddress: "0xattacker", cash: "1", positions: [{ assetId: "x" }],
    }) }));
    expect(response.status).toBe(200);
    expect(mocks.authenticateGame).toHaveBeenCalledWith(expect.any(Request), "game:trade");
    expect(mocks.authenticateLegacy).not.toHaveBeenCalled();
    expect(mocks.reset).toHaveBeenCalledWith("0xsession", "00000000-0000-4000-8000-000000000071");
    expect(await response.json()).toEqual({ walletAddress: "0xsession", cash: "50000000000" });
  });

  it.each([{}, { idempotencyKey: "bad" }])("rejects a missing or malformed idempotency key", async (body) => {
    mocks.authenticateGame.mockResolvedValue("0xsession");
    mocks.authenticateLegacy.mockResolvedValue("0xlegacy");
    const response = await POST(new Request("http://localhost/api/game/reset", { method: "POST", body: JSON.stringify(body) }));
    expect(response.status).toBe(422);
    expect(mocks.reset).not.toHaveBeenCalled();
  });
});
