import { describe, expect, it } from "vitest";
import { ApiError, toErrorResponse } from "./errors";

describe("toErrorResponse", () => {
  it("does not serialize internal ApiError details", async () => {
    const response = toErrorResponse(new ApiError(400, "BAD_REQUEST", "Bad request", {
      database: "secret diagnostics",
    }));
    expect(await response.json()).toEqual({ error: { code: "BAD_REQUEST", message: "Bad request" } });
  });
});
