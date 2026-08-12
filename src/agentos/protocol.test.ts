import { describe, expect, it } from "vitest";

import { ELON_AGENT_CHANNEL, parseElonAgentCommand } from "./protocol";

describe("parseElonAgentCommand", () => {
  it("accepts a complete buy command and supplies protocol defaults", () => {
    expect(ELON_AGENT_CHANNEL).toBe("injpass-miniapp-v1");
    expect(parseElonAgentCommand({
      appId: "bankrupt-elon-musk",
      action: "buy",
      params: { asset: "TSLA", quantity: "100" },
    })).toEqual({
      appId: "bankrupt-elon-musk",
      action: "buy",
      rawText: "",
      language: "en",
      params: { asset: "TSLA", quantity: "100" },
    });
  });

  it.each(["open", "market", "balance", "portfolio", "history", "rank", "buy", "sell"])(
    "accepts the %s action",
    (action) => {
      expect(parseElonAgentCommand({ appId: "bankrupt-elon-musk", action, params: {} }))
        .toMatchObject({ action });
    },
  );

  it("preserves safe optional fields", () => {
    expect(parseElonAgentCommand({
      appId: "bankrupt-elon-musk",
      action: "history",
      rawText: "show five trades",
      language: "zh-Hans",
      params: { query: "recent", limit: 5 },
    })).toEqual({
      appId: "bankrupt-elon-musk",
      action: "history",
      rawText: "show five trades",
      language: "zh-Hans",
      params: { query: "recent", limit: 5 },
    });
  });

  it.each(["1", "100", "MAX"])("accepts the string quantity %s", (quantity) => {
    expect(parseElonAgentCommand({
      appId: "bankrupt-elon-musk",
      action: "sell",
      params: { asset: "BTC", quantity },
    })?.params.quantity).toBe(quantity);
  });

  it.each([0, -1, 1.2])("accepts the finite numeric limit %s", (limit) => {
    expect(parseElonAgentCommand({
      appId: "bankrupt-elon-musk",
      action: "history",
      params: { limit },
    })?.params.limit).toBe(limit);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, "5"])(
    "rejects the non-finite or non-numeric limit %s",
    (limit) => {
      expect(parseElonAgentCommand({
        appId: "bankrupt-elon-musk",
        action: "history",
        params: { limit },
      })).toBeNull();
    },
  );

  it.each([
    { appId: "another-app", action: "buy", params: {} },
    { appId: "bankrupt-elon-musk", action: "delete", params: {} },
    { appId: "bankrupt-elon-musk", action: "buy", params: [] },
    { appId: "bankrupt-elon-musk", action: "buy", params: { asset: "TSLA", quantity: 100 } },
    { appId: "bankrupt-elon-musk", action: "buy", params: { asset: "TSLA", quantity: "0" } },
    { appId: "bankrupt-elon-musk", action: "buy", params: { asset: "TSLA", quantity: "01" } },
    { appId: "bankrupt-elon-musk", action: "buy", params: { asset: "TSLA", quantity: "100", usdUnitPrice: "1" } },
    { appId: "bankrupt-elon-musk", action: "buy", params: { walletAddress: "0xabc" } },
    { appId: "bankrupt-elon-musk", action: "buy", params: { amount: "10" } },
    { appId: "bankrupt-elon-musk", action: "buy", params: { idempotencyKey: "host-value" } },
    { appId: "bankrupt-elon-musk", action: "buy", params: {}, extra: true },
  ])("rejects malformed or authority-injecting commands %#", (command) => {
    expect(parseElonAgentCommand(command)).toBeNull();
  });
});
