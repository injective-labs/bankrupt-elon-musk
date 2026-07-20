// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ connect: vi.fn(), disconnect: vi.fn(), onDisconnect: vi.fn() }));
vi.mock("@injpass/cli", () => ({
  InjPassConnector: class {
    connect = mocks.connect;
    disconnect = mocks.disconnect;
    onDisconnect = mocks.onDisconnect;
  },
}));

import { InjPassProvider, useInjPass } from "./InjPassProvider";

describe("InjPassProvider", () => {
  afterEach(() => { cleanup(); vi.resetAllMocks(); });

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
});
