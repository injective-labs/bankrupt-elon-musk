import { NextResponse } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setSessionCookie } from "./sessionCookie";

describe("session cookie environment security", () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    ["production", true],
    ["development", false],
    ["test", false],
  ])("sets Secure=%s only in production", (environment, expectedSecure) => {
    vi.stubEnv("NODE_ENV", environment);
    const response = NextResponse.json({ ok: true });
    setSessionCookie(response, "token");
    expect(response.headers.get("set-cookie")?.includes("Secure")).toBe(expectedSecure);
  });
});
