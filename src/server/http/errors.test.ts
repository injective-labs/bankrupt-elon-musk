import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, toErrorResponse } from "./errors";

describe("toErrorResponse", () => {
  afterEach(() => vi.restoreAllMocks());

  it("does not serialize internal ApiError details", async () => {
    const response = toErrorResponse(new ApiError(400, "BAD_REQUEST", "Bad request", {
      database: "secret diagnostics",
    }));
    expect(await response.json()).toEqual({ error: { code: "BAD_REQUEST", message: "Bad request" } });
  });

  it("logs unexpected server errors before returning the generic response", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const error = Object.assign(new Error("database write failed"), { code: "P2022" });

    const response = toErrorResponse(error);

    expect(response.status).toBe(500);
    expect(log).toHaveBeenCalledWith("Unhandled API error", error);
    expect(await response.json()).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    });
  });
});
