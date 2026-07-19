import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { refreshMarket } = vi.hoisted(() => ({ refreshMarket: vi.fn() }));
vi.mock("@/server/market/refresh", () => ({ refreshMarket }));

import { GET } from "./route";

describe("market refresh cron route", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => delete process.env.CRON_SECRET);

  it("rejects missing or non-exact authorization without running refresh", async () => {
    process.env.CRON_SECRET = "top-secret";
    for (const authorization of [undefined, "Bearer wrong", "bearer top-secret", "Bearer  top-secret"]) {
      const headers = authorization ? { Authorization: authorization } : undefined;
      const response = await GET(new Request("http://localhost/api/cron/refresh-market", { headers }));
      expect(response.status).toBe(401);
    }
    expect(refreshMarket).not.toHaveBeenCalled();
  });

  it("rejects all requests when CRON_SECRET is not configured", async () => {
    const response = await GET(new Request("http://localhost/api/cron/refresh-market", {
      headers: { Authorization: "Bearer undefined" },
    }));
    expect(response.status).toBe(401);
  });

  it("returns only the refresh summary for the exact bearer secret", async () => {
    process.env.CRON_SECRET = "top-secret";
    const summary = { attempted: 2, active: 1, stale: 1, failed: 1, marketDates: { apple: "2026-07-17" } };
    refreshMarket.mockResolvedValue(summary);

    const response = await GET(new Request("http://localhost/api/cron/refresh-market", {
      headers: { Authorization: "Bearer top-secret" },
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(summary);
    expect(refreshMarket).toHaveBeenCalledOnce();
  });
});
