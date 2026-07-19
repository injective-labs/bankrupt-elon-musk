import { describe, expect, it, vi } from "vitest";

const { loadState, saveState } = vi.hoisted(() => ({ loadState: vi.fn(), saveState: vi.fn() }));
vi.mock("@/server/gameState", () => ({ loadState, saveState }));

import { GET, PUT } from "./route";

describe("retired game state API", () => {
  it.each([
    ["GET", GET, new Request("http://localhost/api/state?wallet=0x0000000000000000000000000000000000000001")],
    ["PUT", PUT, new Request("http://localhost/api/state", { method: "PUT", body: "not-json" })],
  ] as const)("returns 503 for %s without persistence access", async (_method, handler, request) => {
    const response = await handler(request);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: { code: "GAME_STATE_API_RETIRED", message: "Legacy game state API is retired" },
    });
    expect(loadState).not.toHaveBeenCalled();
    expect(saveState).not.toHaveBeenCalled();
  });
});
