// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  onDisconnect: vi.fn(),
  isEmbedded: vi.fn(() => false),
  getSession: vi.fn(),
  onSession: vi.fn(),
  getEthereumProvider: vi.fn(),
  requestLogin: vi.fn(),
  requestLogout: vi.fn(),
  destroyMiniAppConnector: vi.fn(),
}));
vi.mock("@injpass/cli", () => ({
  InjPassConnector: class {
    connect = mocks.connect;
    disconnect = mocks.disconnect;
    onDisconnect = mocks.onDisconnect;
  },
  InjPassMiniAppConnector: { isEmbedded: mocks.isEmbedded },
}));
vi.mock("@/agentos/host", () => ({
  getElonMiniAppConnector: () => ({
    getSession: mocks.getSession,
    onSession: mocks.onSession,
    getEthereumProvider: mocks.getEthereumProvider,
    requestLogin: mocks.requestLogin,
    requestLogout: mocks.requestLogout,
  }),
  destroyElonMiniAppConnector: mocks.destroyMiniAppConnector,
}));

import { InjPassProvider, useInjPass } from "./InjPassProvider";

describe("InjPassProvider", () => {
  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
    mocks.isEmbedded.mockReturnValue(false);
  });

  it("shares one connector request across concurrent login intents", async () => {
    let resolve!: (wallet: { address: string }) => void;
    mocks.connect.mockReturnValue(new Promise((yes) => { resolve = yes; }));
    let connector!: ReturnType<typeof useInjPass>;
    function Capture() { connector = useInjPass(); return null; }
    render(<InjPassProvider><Capture /></InjPassProvider>);

    let first!: Promise<unknown>;
    let second!: Promise<unknown>;
    act(() => { first = connector.connect(); second = connector.connect(); });
    expect(mocks.connect).toHaveBeenCalledOnce();
    await act(async () => resolve({ address: "0x1" }));
    await expect(Promise.all([first, second])).resolves.toEqual([{ address: "0x1" }, { address: "0x1" }]);
  });

  it("adopts an authenticated INJ Pass host wallet without opening a standalone connector", async () => {
    const session = {
      authenticated: true,
      address: "0x0000000000000000000000000000000000000001",
      walletName: "hello_1",
      chainId: 1776,
    };
    const request = vi.fn().mockResolvedValue(`0x${"01".repeat(65)}`);
    mocks.isEmbedded.mockReturnValue(true);
    mocks.getSession.mockReturnValue(session);
    mocks.getEthereumProvider.mockReturnValue({ request });
    mocks.onSession.mockImplementation((listener: (value: typeof session) => void) => {
      queueMicrotask(() => listener(session));
      return vi.fn();
    });
    let connector!: ReturnType<typeof useInjPass>;
    function Capture() { connector = useInjPass(); return null; }

    const view = render(<InjPassProvider><Capture /></InjPassProvider>);

    await waitFor(() => expect(connector.status).toBe("connected"));
    expect(connector.wallet).toMatchObject({ address: session.address, walletName: "hello_1" });
    await expect(connector.wallet?.signer.signMessage("game nonce")).resolves.toEqual(
      new Uint8Array(65).fill(1),
    );
    expect(request).toHaveBeenCalledWith({
      method: "personal_sign",
      params: ["0x67616d65206e6f6e6365", session.address],
    });
    expect(mocks.connect).not.toHaveBeenCalled();
    view.unmount();
    expect(mocks.destroyMiniAppConnector).toHaveBeenCalledOnce();
  });

  it("requests host login and waits for an authenticated session when the host is a guest", async () => {
    const guestSession = {
      authenticated: false,
      address: null,
      chainId: 1776,
    };
    const authenticatedSession = {
      authenticated: true,
      address: "0x0000000000000000000000000000000000000002",
      walletName: "hello_2",
      chainId: 1776,
    };
    let sessionListener: ((value: typeof guestSession | typeof authenticatedSession) => void) | null = null;
    mocks.isEmbedded.mockReturnValue(true);
    mocks.getSession.mockReturnValue(guestSession);
    mocks.onSession.mockImplementation((listener) => {
      sessionListener = listener;
      return vi.fn();
    });
    mocks.requestLogin.mockResolvedValue(undefined);
    mocks.getEthereumProvider.mockReturnValue({ request: vi.fn() });
    let connector!: ReturnType<typeof useInjPass>;
    function Capture() { connector = useInjPass(); return null; }
    render(<InjPassProvider><Capture /></InjPassProvider>);

    let pending!: Promise<unknown>;
    act(() => { pending = connector.connect(); });
    await waitFor(() => expect(mocks.requestLogin).toHaveBeenCalledOnce());
    await act(async () => sessionListener?.(authenticatedSession));

    await expect(pending).resolves.toMatchObject({
      address: authenticatedSession.address,
      walletName: "hello_2",
    });
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it("clears the embedded wallet when the INJ Pass host logs out", async () => {
    const authenticatedSession = {
      authenticated: true,
      address: "0x0000000000000000000000000000000000000003",
      walletName: "hello_3",
      chainId: 1776,
    };
    let sessionListener!: (value: typeof authenticatedSession | {
      authenticated: false;
      address: null;
      chainId: number;
    }) => void;
    mocks.isEmbedded.mockReturnValue(true);
    mocks.getSession.mockReturnValue(authenticatedSession);
    mocks.getEthereumProvider.mockReturnValue({ request: vi.fn() });
    mocks.onSession.mockImplementation((listener) => {
      sessionListener = listener;
      return vi.fn();
    });
    let connector!: ReturnType<typeof useInjPass>;
    function Capture() { connector = useInjPass(); return null; }
    render(<InjPassProvider><Capture /></InjPassProvider>);
    await waitFor(() => expect(connector.wallet?.walletName).toBe("hello_3"));

    act(() => sessionListener({ authenticated: false, address: null, chainId: 1776 }));

    await waitFor(() => expect(connector.status).toBe("idle"));
    expect(connector.wallet).toBeNull();
  });

  it("bounds the initial embedded host-session handshake", async () => {
    vi.useFakeTimers();
    mocks.isEmbedded.mockReturnValue(true);
    mocks.getSession.mockReturnValue(null);
    mocks.onSession.mockReturnValue(vi.fn());
    mocks.getEthereumProvider.mockReturnValue({ request: vi.fn() });
    let connector!: ReturnType<typeof useInjPass>;
    function Capture() { connector = useInjPass(); return null; }
    render(<InjPassProvider><Capture /></InjPassProvider>);

    expect(connector.sessionReady).toBe(false);
    await act(async () => vi.advanceTimersByTime(10_000));

    expect(connector.sessionReady).toBe(true);
    expect(connector.error).toBe("INJ Pass host session was not received");
    vi.useRealTimers();
  });

  it("keeps server and first client render stable before detecting embedded mode", async () => {
    mocks.isEmbedded.mockReturnValue(true);
    mocks.getSession.mockReturnValue(null);
    mocks.onSession.mockReturnValue(vi.fn());
    mocks.getEthereumProvider.mockReturnValue({ request: vi.fn() });
    function Readiness() {
      const value = useInjPass();
      return <output>{`${value.environmentReady}:${value.embedded}:${value.sessionReady}`}</output>;
    }
    const html = renderToString(<InjPassProvider><Readiness /></InjPassProvider>);
    expect(html).toContain("false:false:false");
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    let root!: ReturnType<typeof hydrateRoot>;
    await act(async () => {
      root = hydrateRoot(container, <InjPassProvider><Readiness /></InjPassProvider>);
    });

    expect(consoleError.mock.calls.flat().join(" ")).not.toMatch(/hydration|did not match/i);
    await waitFor(() => expect(container.textContent).toContain("true:true:false"));
    await act(async () => root.unmount());
    container.remove();
  });
});
