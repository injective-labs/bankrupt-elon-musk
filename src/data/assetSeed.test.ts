import { describe, expect, it } from "vitest";

import { buildAssetSeed } from "./assetSeed";

describe("buildAssetSeed", () => {
  it("builds the complete enabled asset catalogue in display order", () => {
    const rows = buildAssetSeed();

    expect(rows).toHaveLength(160);
    expect(new Set(rows.map((row) => row.id)).size).toBe(160);
    expect(rows.every((row) => row.quoteSymbol && row.enabled)).toBe(true);
    expect(rows.map((row) => row.displayOrder)).toEqual(
      Array.from({ length: 160 }, (_, index) => index),
    );
  });

  it("preserves the approved market distribution", () => {
    const counts = buildAssetSeed().reduce<Record<string, number>>((result, row) => {
      result[row.assetClass] = (result[row.assetClass] ?? 0) + 1;
      return result;
    }, {});

    expect(counts).toEqual({
      加密货币: 12,
      美股: 38,
      港股: 20,
      韩股: 23,
      台股: 23,
      日股: 32,
      贵金属: 5,
      大宗商品: 7,
    });
  });
});
