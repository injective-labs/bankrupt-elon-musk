import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), execute: vi.fn(), history: vi.fn() }));
vi.mock("@/server/auth", () => ({ authenticateGameRequest: mocks.auth }));
vi.mock("@/server/trades", () => ({ executeTrade: mocks.execute, getTradeHistory: mocks.history }));
import { GET, POST } from "./route";

describe("/api/trades", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue("0xwallet"); });
  it("authenticates and validates UUID trade commands", async () => {
    const response = await POST(new Request("http://localhost/api/trades", { method: "POST", body: JSON.stringify({ assetId: "a", side: "BUY", quantity: "1", idempotencyKey: "bad" }) }));
    expect(response.status).toBe(422); expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("executes a valid authenticated trade", async () => {
    const body = { assetId: "a", side: "BUY", quantity: "MAX", idempotencyKey: "00000000-0000-4000-8000-000000000001" };
    mocks.execute.mockResolvedValue({ cash: "1" });
    const response = await POST(new Request("http://localhost/api/trades", { method: "POST", body: JSON.stringify(body) }));
    expect(response.status).toBe(200); expect(mocks.execute).toHaveBeenCalledWith("0xwallet", body);
    expect(mocks.auth).toHaveBeenCalledWith(expect.any(Request), "game:trade");
  });
  it("caps authenticated history pagination at 100", async () => {
    mocks.history.mockResolvedValue({ rows: [], nextCursor: null });
    await GET(new Request("http://localhost/api/trades?cursor=5&limit=900"));
    expect(mocks.history).toHaveBeenCalledWith("0xwallet", { cursor: "5", limit: 100 });
    expect(mocks.auth).toHaveBeenCalledWith(expect.any(Request), "game:read");
  });
});
