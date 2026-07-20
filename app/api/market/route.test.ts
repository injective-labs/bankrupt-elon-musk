import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ projection: vi.fn() }));

vi.mock("@/server/market/projection", () => ({
  getMarketProjection: mocks.projection,
}));

import { GET } from "./route";

describe("GET /api/market", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns public market data without authentication", async () => {
    mocks.projection.mockResolvedValue({ assets: [], marketAsOf: null });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ assets: [], marketAsOf: null });
  });

  it("returns an error response when the database is unavailable", async () => {
    mocks.projection.mockRejectedValue(new Error("database offline"));

    const response = await GET();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    });
  });
});
