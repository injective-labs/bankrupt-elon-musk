import { beforeEach, describe, expect, it, vi } from "vitest";

const connectorState = vi.hoisted(() => ({
  embedded: true,
  instances: [] as Array<{ config: unknown; destroy: ReturnType<typeof vi.fn> }>,
}));

vi.mock("@injpass/cli", () => ({
  InjPassMiniAppConnector: class MockInjPassMiniAppConnector {
    static isEmbedded() {
      return connectorState.embedded;
    }

    config: unknown;
    destroy = vi.fn();

    constructor(config: unknown) {
      this.config = config;
      connectorState.instances.push(this);
    }
  },
}));

import {
  destroyElonMiniAppConnector,
  getElonMiniAppConnector,
  trustedInjPassHostOrigin,
} from "./host";

describe("trustedInjPassHostOrigin", () => {
  it("accepts the exact configured production origin", () => {
    expect(trustedInjPassHostOrigin(
      "https://elon.example/?injpass_miniapp=1&injpass_host_origin=https%3A%2F%2Finjpass.com",
      "production",
      "https://injpass.com/embed",
    )).toBe("https://injpass.com");
  });

  it("rejects an origin injected by an untrusted production parent", () => {
    expect(() => trustedInjPassHostOrigin(
      "https://elon.example/?injpass_miniapp=1&injpass_host_origin=https%3A%2F%2Fevil.example",
      "production",
      "https://injpass.com/embed",
    )).toThrow("Untrusted INJ Pass host origin");
  });

  it.each([
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://[::1]:3000",
  ])("accepts a development loopback host %s", (origin) => {
    const location = `http://localhost:3002/?injpass_miniapp=1&injpass_host_origin=${encodeURIComponent(origin)}`;
    expect(trustedInjPassHostOrigin(location, "development", "http://localhost:3000/embed"))
      .toBe(origin);
  });

  it.each([
    "https://localhost:3000",
    "http://evil.example",
    "not-a-url",
  ])("rejects an unsafe development host %s", (origin) => {
    const location = `http://localhost:3002/?injpass_miniapp=1&injpass_host_origin=${encodeURIComponent(origin)}`;
    expect(() => trustedInjPassHostOrigin(location, "development", "http://localhost:3000/embed"))
      .toThrow();
  });

  it("requires explicit mini-app mode and configured URLs", () => {
    expect(() => trustedInjPassHostOrigin(
      "https://elon.example/?injpass_host_origin=https%3A%2F%2Finjpass.com",
      "production",
      "https://injpass.com/embed",
    )).toThrow("Not running as an INJ Pass mini app");
    expect(() => trustedInjPassHostOrigin(
      "https://elon.example/?injpass_miniapp=1",
      "production",
      "https://injpass.com/embed",
    )).toThrow("Missing INJ Pass host origin");
  });
});

describe("Elon connector ownership", () => {
  beforeEach(() => {
    destroyElonMiniAppConnector();
    connectorState.instances.length = 0;
    connectorState.embedded = true;
  });

  it("shares one connector and recreates it after destruction", () => {
    const location = "https://elon.example/?injpass_miniapp=1&injpass_host_origin=https%3A%2F%2Finjpass.com";
    const first = getElonMiniAppConnector(location, "production", "https://injpass.com/embed");
    const second = getElonMiniAppConnector(location, "production", "https://injpass.com/embed");

    expect(first).toBe(second);
    expect(connectorState.instances).toHaveLength(1);
    expect(connectorState.instances[0].config).toEqual({ hostOrigin: "https://injpass.com" });

    destroyElonMiniAppConnector();
    destroyElonMiniAppConnector();
    expect(connectorState.instances[0].destroy).toHaveBeenCalledTimes(1);

    const third = getElonMiniAppConnector(location, "production", "https://injpass.com/embed");
    expect(third).not.toBe(first);
    expect(connectorState.instances).toHaveLength(2);
  });

  it("does not construct a connector outside embedded mode", () => {
    connectorState.embedded = false;
    expect(getElonMiniAppConnector(
      "https://elon.example/",
      "production",
      "https://injpass.com/embed",
    )).toBeNull();
    expect(connectorState.instances).toHaveLength(0);
  });
});
