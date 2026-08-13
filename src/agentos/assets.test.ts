import { describe, expect, it } from "vitest";

import type { AssetView } from "@/types";
import { resolveElonAsset } from "./assets";

const asset = (id: string, ticker: string, name: string, nameEn?: string): AssetView => ({
  id,
  ticker,
  name,
  nameEn,
  category: "模拟资产",
  currency: "USD",
  unit: "股",
  enabled: true,
  displayOrder: 1,
  usdPrice: "10",
  marketDate: "2026-08-12T00:00:00.000Z",
  quoteStatus: "ACTIVE",
});

const assets = [
  asset("tesla-stock", "TSLA", "特斯拉股票", "Tesla Stock"),
  asset("bitcoin", "BTC", "比特币", "Bitcoin"),
  asset("dogecoin-pack", "DOGE", "狗狗币一百万枚", "Dogecoin (1M pack)"),
  asset("mars-coin", "MARS", "火星币", "Mars Coin"),
  asset("mars-land", "LAND", "火星土地", "Mars Land"),
];

describe("resolveElonAsset", () => {
  it.each([
    ["TESLA-STOCK", "tesla-stock"],
    ["tsla", "tesla-stock"],
    ["比特币", "bitcoin"],
    ["  Tesla   Stock ", "tesla-stock"],
  ])("resolves exact ID, ticker, or normalized full name %s", (input, id) => {
    expect(resolveElonAsset(assets, input)).toMatchObject({ kind: "exact", asset: { id } });
  });

  it.each(["dogecoin", "doge coin", "doges coin"])("resolves the common Dogecoin alias %s", (input) => {
    expect(resolveElonAsset(assets, input)).toMatchObject({
      kind: "exact",
      asset: { id: "dogecoin-pack", ticker: "DOGE" },
    });
  });

  it("returns missing instead of selecting an unrelated asset", () => {
    expect(resolveElonAsset(assets, "PEPE")).toEqual({ kind: "missing" });
  });

  it("returns bounded candidates instead of choosing the first fuzzy match", () => {
    expect(resolveElonAsset(assets, "火星")).toEqual({
      kind: "ambiguous",
      candidates: [assets[3], assets[4]],
    });
  });
});
