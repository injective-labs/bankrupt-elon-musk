import { describe, expect, it } from "vitest";

import { GET } from "./route";

describe("GET /api/leaderboard", () => {
  it("reports the leaderboard as unavailable instead of fabricating ranks", async () => {
    const response = await GET();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: {
        code: "LEADERBOARD_UNAVAILABLE",
        message: "Leaderboard is unavailable while authoritative ranking is being upgraded.",
      },
    });
  });
});
