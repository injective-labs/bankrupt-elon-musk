import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getLossLeaderboard: vi.fn(), verifyToken: vi.fn() }));
vi.mock("@/server/leaderboard", () => ({ getLossLeaderboard: mocks.getLossLeaderboard }));
vi.mock("@/server/auth", () => ({ verifyToken: mocks.verifyToken }));

import { GET } from "./route";

describe("GET /api/leaderboard", () => {
  beforeEach(() => vi.clearAllMocks());

  it("serves a masked public leaderboard without accepting a wallet query parameter", async () => {
    mocks.getLossLeaderboard.mockResolvedValueOnce({ top: [], total: 0, you: null });
    const response = await GET(new Request("http://localhost/api/leaderboard?wallet=0xattacker"));

    expect(response.status).toBe(200);
    expect(mocks.getLossLeaderboard).toHaveBeenCalledWith(null, 10);
  });

  it("includes caller rank only when the session cookie verifies", async () => {
    mocks.verifyToken.mockResolvedValueOnce("0xcaller");
    mocks.getLossLeaderboard.mockResolvedValueOnce({ top: [], total: 20, you: { rank: 12, total: 20, pnl: "-1" } });
    await GET(new Request("http://localhost/api/leaderboard", { headers: { cookie: "musk_session=token" } }));
    expect(mocks.verifyToken).toHaveBeenCalledWith("token");
    expect(mocks.getLossLeaderboard).toHaveBeenCalledWith("0xcaller", 10);
  });
});
