// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  login: vi.fn(),
}));

vi.mock("./InjPassProvider", () => ({
  useInjPass: () => ({ status: "idle", error: null, connect: mocks.connect }),
}));
vi.mock("@/state/GameProvider", () => ({
  useGame: () => ({ actions: { login: mocks.login }, pendingCommand: null }),
}));

import { useInjPassLogin } from "./useInjPassLogin";

describe("useInjPassLogin", () => {
  afterEach(() => { cleanup(); vi.resetAllMocks(); });

  it("connects and delegates exact server-message signing to the connected wallet", async () => {
    const signMessage = vi.fn().mockResolvedValue(new Uint8Array([1, 2]));
    mocks.connect.mockResolvedValue({ address: "0x1", walletName: "guest", signer: { signMessage } });
    mocks.login.mockImplementation(async (_address, _name, signer) => {
      expect(await signer("exact nonce message")).toEqual(new Uint8Array([1, 2]));
      return true;
    });
    const { result } = renderHook(() => useInjPassLogin());

    await act(async () => expect(result.current.beginLogin()).resolves.toBe(true));

    expect(mocks.login).toHaveBeenCalledWith("0x1", "guest", expect.any(Function));
    expect(signMessage).toHaveBeenCalledWith("exact nonce message");
  });

  it("does not authenticate when the connection is cancelled", async () => {
    mocks.connect.mockResolvedValue(null);
    const { result } = renderHook(() => useInjPassLogin());

    await act(async () => expect(result.current.beginLogin()).resolves.toBe(false));

    expect(mocks.login).not.toHaveBeenCalled();
  });
});
