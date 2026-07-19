import { describe, expect, it, vi } from "vitest";

import { fetchDailyBar, parseYahooDailyBar } from "./yahoo";

const fixture = {
  chart: {
    result: [
      {
        meta: { currency: "HKD" },
        timestamp: [1_720_656_000, 1_720_742_400, 1_720_828_800],
        indicators: {
          quote: [
            {
              open: [10, 11, null],
              high: [12, 13, null],
              low: [9, 10, null],
              close: [11, 12, null],
            },
          ],
        },
      },
    ],
  },
};

describe("parseYahooDailyBar", () => {
  it("selects the latest row with a positive close and its matching OHLC values", () => {
    expect(parseYahooDailyBar("0700.HK", fixture)).toEqual({
      symbol: "0700.HK",
      marketDate: new Date("2024-07-12T00:00:00.000Z"),
      open: 11,
      high: 13,
      low: 10,
      close: 12,
      currency: "HKD",
    });
  });

  it("allows missing non-close OHLC values", () => {
    const payload = structuredClone(fixture);
    payload.chart.result[0].indicators.quote[0].open[1] = null;
    expect(parseYahooDailyBar("0700.HK", payload).open).toBeNull();
  });

  it("rejects missing closes and timestamps", () => {
    const noClose = structuredClone(fixture);
    noClose.chart.result[0].indicators.quote[0].close = [null, null, null];
    expect(() => parseYahooDailyBar("BAD", noClose)).toThrow(/no valid daily bar/i);

    const noTimestamp = structuredClone(fixture);
    noTimestamp.chart.result[0].timestamp = [];
    expect(() => parseYahooDailyBar("BAD", noTimestamp)).toThrow(/no valid daily bar/i);
  });

  it("rejects a missing currency", () => {
    const payload = structuredClone(fixture);
    payload.chart.result[0].meta.currency = "";
    expect(() => parseYahooDailyBar("BAD", payload)).toThrow(/currency/i);
  });
});

describe("fetchDailyBar", () => {
  it("uses the server Yahoo endpoint, fixed user agent, and parses the response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(fixture), { status: 200 }),
    );

    const bar = await fetchDailyBar("0700.HK", { fetch: fetchMock, timeoutMs: 50 });

    expect(bar.close).toBe(12);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("query1.finance.yahoo.com/v8/finance/chart/0700.HK");
    expect(url).toContain("range=10d");
    expect(init.headers["User-Agent"]).toMatch(/INJ-Pass/);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("throws on an upstream non-200 response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("rate limited", { status: 429 }));
    await expect(fetchDailyBar("BTC-USD", { fetch: fetchMock })).rejects.toThrow(/429/);
  });
});
