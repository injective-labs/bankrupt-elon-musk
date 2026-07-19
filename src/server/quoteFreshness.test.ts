import { describe, expect, it } from "vitest";
import { isQuoteFresh } from "./quoteFreshness";

describe("isQuoteFresh", () => {
  it("accepts exactly seven UTC calendar days and rejects eight", () => {
    const now = new Date("2026-07-19T23:59:59-07:00"); // 2026-07-20 UTC
    expect(isQuoteFresh(new Date("2026-07-13T00:00:00Z"), now)).toBe(true);
    expect(isQuoteFresh(new Date("2026-07-12T23:59:59+02:00"), now)).toBe(false);
  });

  it("uses UTC calendar dates rather than elapsed hours or host timezone", () => {
    const now = new Date("2026-07-19T00:01:00+14:00"); // 2026-07-18 UTC
    expect(isQuoteFresh(new Date("2026-07-11T23:59:00-12:00"), now)).toBe(true); // July 12 UTC
  });

  it("accepts future market dates", () => {
    expect(isQuoteFresh(new Date("2026-07-21T00:00:00Z"), new Date("2026-07-19T23:59:59Z"))).toBe(true);
  });
});
