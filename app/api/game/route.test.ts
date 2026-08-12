import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/server/http/errors";

const mocks = vi.hoisted(() => ({ authenticateGameRequest: vi.fn(), getAccountProjection: vi.fn() }));
vi.mock("@/server/auth", () => ({ authenticateGameRequest: mocks.authenticateGameRequest }));
vi.mock("@/server/account", () => ({ getAccountProjection: mocks.getAccountProjection }));

import { GET } from "./route";

describe("GET /api/game", () => {
  it("returns 401 without a valid session cookie and ignores wallet query input", async () => {
    mocks.authenticateGameRequest.mockRejectedValueOnce(new ApiError(401, "UNAUTHORIZED", "Authentication required"));
    const response = await GET(new Request("http://localhost/api/game?wallet=0xattacker"));
    expect(response.status).toBe(401);
    expect(mocks.getAccountProjection).not.toHaveBeenCalled();
  });

  it("projects only the wallet authenticated by the cookie", async () => {
    mocks.authenticateGameRequest.mockResolvedValueOnce("0xcaller");
    mocks.getAccountProjection.mockResolvedValueOnce({ walletAddress: "0xcaller" });
    const response = await GET(new Request("http://localhost/api/game?wallet=0xattacker", { headers: { cookie: "musk_session=token" } }));
    expect(response.status).toBe(200);
    expect(mocks.authenticateGameRequest).toHaveBeenCalledWith(expect.any(Request), "game:read");
    expect(mocks.getAccountProjection).toHaveBeenCalledWith("0xcaller");
  });
});
