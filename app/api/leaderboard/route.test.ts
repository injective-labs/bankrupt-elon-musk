import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateGameRequest: vi.fn(),
  verifyToken: vi.fn(),
  leaderboard: vi.fn(),
  readCookie: vi.fn(),
}));

vi.mock("@/server/auth", () => ({
  authenticateGameRequest: mocks.authenticateGameRequest,
  verifyToken: mocks.verifyToken,
}));
vi.mock("@/server/leaderboard", () => ({ getLossLeaderboard: mocks.leaderboard }));
vi.mock("@/server/http/sessionCookie", () => ({ readSessionCookie: mocks.readCookie }));

import { GET } from "./route";

describe("GET /api/leaderboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.leaderboard.mockResolvedValue({ top: [] });
    mocks.readCookie.mockReturnValue(null);
  });

  it("keeps the leaderboard public without caller identity", async () => {
    const response = await GET(new Request("http://localhost/api/leaderboard"));
    expect(response.status).toBe(200);
    expect(mocks.leaderboard).toHaveBeenCalledWith(null, 10);
    expect(mocks.authenticateGameRequest).not.toHaveBeenCalled();
  });

  it("authenticates an explicit Agent bearer for current-user rank", async () => {
    mocks.authenticateGameRequest.mockResolvedValue("0xagent");
    await GET(new Request("http://localhost/api/leaderboard", {
      headers: { authorization: "Bearer agent.jwt" },
    }));
    expect(mocks.authenticateGameRequest).toHaveBeenCalledWith(expect.any(Request), "game:read");
    expect(mocks.leaderboard).toHaveBeenCalledWith("0xagent", 10);
  });

  it("preserves optional standalone cookie identity", async () => {
    mocks.readCookie.mockReturnValue("cookie.jwt");
    mocks.verifyToken.mockResolvedValue("0xcookie");
    await GET(new Request("http://localhost/api/leaderboard", {
      headers: { cookie: "musk_session=cookie.jwt" },
    }));
    expect(mocks.verifyToken).toHaveBeenCalledWith("cookie.jwt");
    expect(mocks.leaderboard).toHaveBeenCalledWith("0xcookie", 10);
  });
});
