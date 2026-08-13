// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  origin: "http://localhost:3000",
  connector: null as null | {
    getEthereumProvider: ReturnType<typeof vi.fn>;
    getSession: ReturnType<typeof vi.fn>;
    onSession: ReturnType<typeof vi.fn>;
  },
  sessionListener: null as null | ((session: unknown) => void),
  destroy: vi.fn(),
  execute: vi.fn(),
  clear: vi.fn(),
}));

vi.mock("./host", () => ({
  getElonMiniAppConnector: () => state.connector,
  trustedInjPassHostOrigin: () => state.origin,
  destroyElonMiniAppConnector: state.destroy,
}));
vi.mock("./api", () => ({
  createElonAgentApi: () => ({
    getMarket: vi.fn(), getGame: vi.fn(), getTransactions: vi.fn(),
    getLeaderboard: vi.fn(), submitTrade: vi.fn(), clearAgentSession: state.clear,
  }),
}));
vi.mock("./execute", () => ({ executeElonAgentCommand: state.execute }));

import { InjPassAgentBridge } from "./InjPassAgentBridge";

const session = {
  authenticated: true,
  address: "0x0000000000000000000000000000000000000001",
  walletName: "alice.inj",
  chainId: 1,
};
const validCommand = {
  appId: "bankrupt-elon-musk",
  action: "balance",
  rawText: "balance",
  language: "en",
  params: {},
};

function dispatch(data: Record<string, unknown>, origin = state.origin, source: MessageEventSource | null = window.parent) {
  window.dispatchEvent(new MessageEvent("message", { data, origin, source }));
}

describe("InjPassAgentBridge", () => {
  let post: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    state.sessionListener = null;
    state.connector = {
      getEthereumProvider: vi.fn().mockReturnValue({ request: vi.fn() }),
      getSession: vi.fn().mockReturnValue(session),
      onSession: vi.fn((listener) => {
        state.sessionListener = listener;
        return vi.fn();
      }),
    };
    state.execute.mockResolvedValue({ ok: true, key: "game_balance", data: { cash: "1" } });
    post = vi.spyOn(window.parent, "postMessage").mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("correlates one valid command result", async () => {
    render(<InjPassAgentBridge />);

    act(() => dispatch({
      channel: "injpass-miniapp-v1", type: "agent-command", id: "command-1", command: validCommand,
    }));

    await waitFor(() => expect(state.execute).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(post).toHaveBeenCalledWith({
      channel: "injpass-miniapp-v1",
      type: "agent-command-result",
      id: "command-1",
      result: { ok: true, key: "game_balance", data: { cash: "1" } },
    }, state.origin));
  });

  it("ignores untrusted, malformed, and duplicate active commands", async () => {
    let resolve!: (value: unknown) => void;
    state.execute.mockReturnValue(new Promise((done) => { resolve = done; }));
    render(<InjPassAgentBridge />);
    const envelope = { channel: "injpass-miniapp-v1", type: "agent-command", id: "same-id", command: validCommand };

    act(() => {
      dispatch(envelope, "http://evil.example");
      dispatch({ ...envelope, channel: "wrong" });
      dispatch({ ...envelope, command: { ...validCommand, appId: "inj-gift" } });
      dispatch({ ...envelope, command: { ...validCommand, params: { walletAddress: session.address } } });
      dispatch(envelope);
      dispatch(envelope);
    });
    expect(state.execute).toHaveBeenCalledTimes(1);

    await act(async () => resolve({ ok: true, key: "game_balance" }));
    await waitFor(() => expect(post.mock.calls.filter((call: unknown[]) =>
      (call[0] as { type?: string }).type === "agent-command-result")).toHaveLength(1));
  });

  it("replays a completed command result without executing the same id again", async () => {
    render(<InjPassAgentBridge />);
    const envelope = {
      channel: "injpass-miniapp-v1", type: "agent-command", id: "completed-id", command: validCommand,
    };

    act(() => dispatch(envelope));
    await waitFor(() => expect(state.execute).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(post.mock.calls.filter((call: unknown[]) =>
      (call[0] as { id?: string }).id === "completed-id")).toHaveLength(1));

    act(() => dispatch(envelope));
    await waitFor(() => expect(post.mock.calls.filter((call: unknown[]) =>
      (call[0] as { id?: string }).id === "completed-id")).toHaveLength(2));
    expect(state.execute).toHaveBeenCalledTimes(1);
  });

  it("never re-executes a completed command id after the host wallet changes", async () => {
    render(<InjPassAgentBridge />);
    const envelope = {
      channel: "injpass-miniapp-v1", type: "agent-command", id: "old-completed-id", command: validCommand,
    };
    act(() => dispatch(envelope));
    await waitFor(() => expect(post.mock.calls.filter((call: unknown[]) =>
      (call[0] as { id?: string }).id === "old-completed-id")).toHaveLength(1));

    act(() => state.sessionListener?.({
      ...session,
      address: "0x0000000000000000000000000000000000000002",
    }));
    act(() => dispatch(envelope));

    await waitFor(() => expect(post).toHaveBeenCalledWith({
      channel: "injpass-miniapp-v1", type: "agent-command-result", id: "old-completed-id",
      result: { ok: false, key: "session_expired" },
    }, state.origin));
    expect(state.execute).toHaveBeenCalledTimes(1);
  });

  it("returns one timeout result after 60 seconds", async () => {
    vi.useFakeTimers();
    state.execute.mockReturnValue(new Promise(() => undefined));
    render(<InjPassAgentBridge />);
    act(() => dispatch({
      channel: "injpass-miniapp-v1", type: "agent-command", id: "slow", command: validCommand,
    }));

    await act(async () => vi.advanceTimersByTime(60_000));
    expect(post).toHaveBeenCalledWith({
      channel: "injpass-miniapp-v1", type: "agent-command-result", id: "slow",
      result: { ok: false, key: "command_timeout" },
    }, state.origin);
  });

  it("clears in-memory auth on wallet switch without destroying the shared connector", () => {
    const view = render(<InjPassAgentBridge />);
    act(() => state.sessionListener?.({ ...session, address: "0x0000000000000000000000000000000000000002" }));
    expect(state.clear).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(state.destroy).not.toHaveBeenCalled();
  });

  it("terminates an active old-wallet command once when the host wallet switches", async () => {
    let resolve!: (value: unknown) => void;
    state.execute.mockReturnValue(new Promise((done) => { resolve = done; }));
    render(<InjPassAgentBridge />);
    act(() => dispatch({
      channel: "injpass-miniapp-v1", type: "agent-command", id: "old-wallet", command: validCommand,
    }));
    expect(state.execute).toHaveBeenCalledTimes(1);

    const signal = state.execute.mock.calls[0]?.[1]?.signal as AbortSignal;
    expect(signal.aborted).toBe(false);

    act(() => state.sessionListener?.({ ...session, address: "0x0000000000000000000000000000000000000002" }));
    expect(signal.aborted).toBe(true);
    expect(post).toHaveBeenCalledWith({
      channel: "injpass-miniapp-v1", type: "agent-command-result", id: "old-wallet",
      result: { ok: false, key: "session_expired" },
    }, state.origin);

    await act(async () => resolve({ ok: true, key: "game_balance", data: { cash: "old" } }));
    await Promise.resolve();
    expect(post.mock.calls.filter((call: unknown[]) =>
      (call[0] as { id?: string }).id === "old-wallet")).toHaveLength(1);
  });

  it("aborts an active command when authentication is lost without changing address", () => {
    state.execute.mockReturnValue(new Promise(() => undefined));
    render(<InjPassAgentBridge />);
    act(() => dispatch({
      channel: "injpass-miniapp-v1", type: "agent-command", id: "logout", command: validCommand,
    }));
    const signal = state.execute.mock.calls[0]?.[1]?.signal as AbortSignal;

    act(() => state.sessionListener?.({ ...session, authenticated: false }));

    expect(signal.aborted).toBe(true);
    expect(state.clear).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith({
      channel: "injpass-miniapp-v1", type: "agent-command-result", id: "logout",
      result: { ok: false, key: "session_expired" },
    }, state.origin);
  });

  it("does nothing outside embedded mode", () => {
    state.connector = null;
    const view = render(<InjPassAgentBridge />);
    expect(view.container).toBeEmptyDOMElement();
    expect(post).not.toHaveBeenCalled();
    expect(state.destroy).not.toHaveBeenCalled();
  });
});
