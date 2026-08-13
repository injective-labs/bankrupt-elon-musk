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

  it("accepts a strongly typed multi-asset preparation without authority fields", () => {
    expect(parseElonAgentCommand({
      appId: "bankrupt-elon-musk",
      action: "prepare_trade",
      params: {
        legs: [
          { side: "BUY", asset: "DOGE", cashBps: 5000 },
          { side: "BUY", asset: "BTC", cashBps: 5000 },
        ],
      },
    })).toMatchObject({
      action: "prepare_trade",
      params: { legs: [
        { side: "BUY", asset: "DOGE", cashBps: 5000 },
        { side: "BUY", asset: "BTC", cashBps: 5000 },
      ] },
    });
  });

  it("accepts only a stored plan id and server confirmation message for execution", () => {
    expect(parseElonAgentCommand({
      appId: "bankrupt-elon-musk",
      action: "execute_trade_plan",
      params: { planId: "plan-1", confirmationMessage: "confirm plan-1" },
    })).toMatchObject({
      action: "execute_trade_plan",
      params: { planId: "plan-1", confirmationMessage: "confirm plan-1" },
    });
  });

  it("accepts cancellation of one stored plan", () => {
    expect(parseElonAgentCommand({
      appId: "bankrupt-elon-musk",
      action: "cancel_trade_plan",
      params: { planId: "plan-1" },
    })).toMatchObject({ action: "cancel_trade_plan", params: { planId: "plan-1" } });
  });

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
    { appId: "bankrupt-elon-musk", action: "prepare_trade", params: { legs: [{ side: "BUY", asset: "DOGE", cashBps: 5000, usdUnitPrice: "0.07" }] } },
    { appId: "bankrupt-elon-musk", action: "prepare_trade", params: { legs: Array.from({ length: 21 }, () => ({ side: "BUY", asset: "DOGE", quantity: "1" })) } },
    { appId: "bankrupt-elon-musk", action: "execute_trade_plan", params: { planId: "plan-1", confirmationMessage: "message", signature: "0x1234" } },
    { appId: "bankrupt-elon-musk", action: "buy", params: {}, extra: true },
  ])("rejects malformed or authority-injecting commands %#", (command) => {
    expect(parseElonAgentCommand(command)).toBeNull();
  });
});
