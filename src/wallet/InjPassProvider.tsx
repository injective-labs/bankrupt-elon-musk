"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  InjPassConnector,
  InjPassMiniAppConnector,
  type InjPassMiniAppSession,
} from "@injpass/cli";
import { hexToBytes, isHex, stringToHex } from "viem";

import {
  destroyElonMiniAppConnector,
  getElonMiniAppConnector,
} from "@/agentos/host";

export type WalletStatus = "idle" | "connecting" | "connected";

export interface InjPassWallet {
  address: string;
  walletName?: string;
  signer: {
    signMessage(message: string): Promise<Uint8Array>;
  };
}

interface InjPassContextValue {
  status: WalletStatus;
  wallet: InjPassWallet | null;
  error: string | null;
  environmentReady: boolean;
  embedded: boolean;
  sessionReady: boolean;
  connect: () => Promise<InjPassWallet | null>;
  disconnect: () => void;
  signMessage: (message: string) => Promise<Uint8Array | null>;
}

const InjPassContext = createContext<InjPassContextValue | null>(null);

export function useInjPass(): InjPassContextValue {
  const ctx = useContext(InjPassContext);
  if (!ctx) throw new Error("useInjPass must be used within InjPassProvider");
  return ctx;
}

const EMBED_URL =
  process.env.NEXT_PUBLIC_INJPASS_EMBED_URL || "http://localhost:3000/embed";
const HOST_SESSION_TIMEOUT_MS = 10_000;
const HOST_LOGIN_TIMEOUT_MS = 180_000;

function walletFromHostSession(
  session: InjPassMiniAppSession,
  connector: InjPassMiniAppConnector,
): InjPassWallet | null {
  if (!session.authenticated || !session.address) return null;
  return {
    address: session.address,
    walletName: session.walletName,
    signer: {
      signMessage: async (message) => {
        const signature = await connector.getEthereumProvider().request({
          method: "personal_sign",
          params: [stringToHex(message), session.address],
        });
        if (typeof signature !== "string" || !isHex(signature)) {
          throw new Error("INJ Pass returned an invalid signature");
        }
        return hexToBytes(signature);
      },
    },
  };
}

function waitForAuthenticatedHostWallet(
  connector: InjPassMiniAppConnector,
  signal?: AbortSignal,
  timeoutMs = HOST_LOGIN_TIMEOUT_MS,
): Promise<InjPassWallet> {
  const current = connector.getSession();
  if (current) {
    const wallet = walletFromHostSession(current, connector);
    if (wallet) return Promise.resolve(wallet);
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      window.clearTimeout(timeout);
      unsubscribe();
      signal?.removeEventListener("abort", handleAbort);
    };
    const finish = (wallet: InjPassWallet) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(wallet);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const timeout = window.setTimeout(() => {
      fail(new Error("INJ Pass login was not completed"));
    }, timeoutMs);
    const unsubscribe = connector.onSession((session) => {
      const wallet = walletFromHostSession(session, connector);
      if (!wallet) return;
      finish(wallet);
    });
    const handleAbort = () => fail(new Error("INJ Pass login was cancelled"));
    signal?.addEventListener("abort", handleAbort, { once: true });
    if (signal?.aborted) handleAbort();
  });
}

export function InjPassProvider({ children }: { children: ReactNode }) {
  const connectorRef = useRef<InjPassConnector | null>(null);
  const connectPromiseRef = useRef<Promise<InjPassWallet | null> | null>(null);
  const hostWaitAbortRef = useRef<AbortController | null>(null);
  const [status, setStatus] = useState<WalletStatus>("idle");
  const [wallet, setWallet] = useState<InjPassWallet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [environmentReady, setEnvironmentReady] = useState(false);
  const [embedded, setEmbedded] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    const isEmbedded = InjPassMiniAppConnector.isEmbedded();
    setEmbedded(isEmbedded);
    setEnvironmentReady(true);
    if (!isEmbedded) {
      setSessionReady(true);
      return;
    }
    hostWaitAbortRef.current = new AbortController();
    const connector = getElonMiniAppConnector();
    if (!connector) return;
    let sessionReceived = false;
    const sessionTimeout = window.setTimeout(() => {
      if (sessionReceived) return;
      setError("INJ Pass host session was not received");
      setSessionReady(true);
    }, HOST_SESSION_TIMEOUT_MS);
    const applySession = (session: InjPassMiniAppSession) => {
      sessionReceived = true;
      window.clearTimeout(sessionTimeout);
      const connected = walletFromHostSession(session, connector);
      setWallet(connected);
      setStatus(connected ? "connected" : "idle");
      setError(null);
      setSessionReady(true);
    };
    const current = connector.getSession();
    if (current) applySession(current);
    const unsubscribe = connector.onSession(applySession);
    return () => {
      window.clearTimeout(sessionTimeout);
      hostWaitAbortRef.current?.abort();
      hostWaitAbortRef.current = null;
      unsubscribe();
      destroyElonMiniAppConnector();
    };
  }, []);

  const getConnector = useCallback((): InjPassConnector => {
    if (!connectorRef.current) {
      connectorRef.current = new InjPassConnector({
        embedUrl: EMBED_URL,
        mode: "floating",
        autoHide: false,
      });
      connectorRef.current.onDisconnect(() => {
        setWallet(null);
        setStatus("idle");
      });
    }
    return connectorRef.current;
  }, []);

  const connect = useCallback(() => {
    if (connectPromiseRef.current) return connectPromiseRef.current;
    const request = (async () => {
      setError(null);
      setStatus("connecting");
      try {
        let connected: InjPassWallet | null;
        if (InjPassMiniAppConnector.isEmbedded()) {
          const connector = getElonMiniAppConnector();
          if (!connector) throw new Error("INJ Pass host bridge is unavailable");
          const current = connector.getSession();
          connected = current ? walletFromHostSession(current, connector) : null;
          if (!connected) {
            // Must remain in the user gesture call chain so the host can open login UI.
            await connector.requestLogin();
            connected = await waitForAuthenticatedHostWallet(
              connector,
              hostWaitAbortRef.current?.signal,
            );
          }
        } else {
          // Must be triggered from a user gesture so the auth popup is allowed.
          connected = await getConnector().connect();
        }
        setWallet(connected);
        setStatus("connected");
        return connected;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        setStatus("idle");
        return null;
      } finally {
        connectPromiseRef.current = null;
      }
    })();
    connectPromiseRef.current = request;
    return request;
  }, [getConnector]);

  const disconnect = useCallback(() => {
    if (InjPassMiniAppConnector.isEmbedded()) {
      void getElonMiniAppConnector()?.requestLogout().catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      });
    } else {
      connectorRef.current?.disconnect();
    }
    setWallet(null);
    setStatus("idle");
    setError(null);
  }, []);

  const signMessage = useCallback(
    async (message: string): Promise<Uint8Array | null> => {
      if (!wallet) return null;
      try {
        return await wallet.signer.signMessage(message);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return null;
      }
    },
    [wallet],
  );

  return (
    <InjPassContext.Provider value={{ status, wallet, error, environmentReady, embedded, sessionReady, connect, disconnect, signMessage }}>
      {children}
    </InjPassContext.Provider>
  );
}
