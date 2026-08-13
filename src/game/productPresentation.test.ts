import { describe, expect, it } from "vitest";

import { getTradeEstimateText } from "./productPresentation";

describe("getTradeEstimateText", () => {
  it("keeps quantities above Number.MAX_SAFE_INTEGER exact in buy estimates", () => {
    expect(getTradeEstimateText(
      "en",
      "1",
      "buy",
      "9007199254740993",
      "9007199254740994",
    )).toContain("$9,007,199,254,740,993");
  });

  it("keeps the remaining quantity exact in sell estimates", () => {
    expect(getTradeEstimateText(
      "en",
      "1",
      "sell",
      "1",
      "9007199254740994",
    )).toContain("9,007,199,254,740,993");
  });
});
