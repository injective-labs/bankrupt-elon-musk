"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { InjPassConnector, type ConnectedWallet } from "@injpass/cli";

export type WalletStatus = "idle" | "connecting" | "connected";

interface InjPassContextValue {
  status: WalletStatus;
  wallet: ConnectedWallet | null;
  error: string | null;
  connect: () => Promise<ConnectedWallet | null>;
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

export function InjPassProvider({ children }: { children: ReactNode }) {
  const connectorRef = useRef<InjPassConnector | null>(null);
  const [status, setStatus] = useState<WalletStatus>("idle");
  const [wallet, setWallet] = useState<ConnectedWallet | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const connect = useCallback(async () => {
    setError(null);
    setStatus("connecting");
    try {
      // Must be triggered from a user gesture so the auth popup is allowed.
      const connected = await getConnector().connect();
      setWallet(connected);
      setStatus("connected");
      return connected;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setStatus("idle");
      return null;
    }
  }, [getConnector]);

  const disconnect = useCallback(() => {
    connectorRef.current?.disconnect();
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
    <InjPassContext.Provider value={{ status, wallet, error, connect, disconnect, signMessage }}>
      {children}
    </InjPassContext.Provider>
  );
}
