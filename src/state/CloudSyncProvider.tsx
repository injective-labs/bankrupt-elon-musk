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
import { useInjPass } from "@/wallet/InjPassProvider";
import { useGame } from "./GameProvider";
import {
  requestNonce,
  verifySignature,
  getCloudState,
  putCloudState,
  getLeaderboard,
  toHexSignature,
  type SaveMetrics,
} from "@/client/gameApi";
import { getNetWorth, getPnl, getHoldingsValue } from "@/game/engine";
import type { GameState, LeaderboardSnapshot } from "@/types";

export type CloudStatus = "idle" | "syncing" | "synced" | "error";

function computeMetrics(state: GameState): SaveMetrics {
  return {
    netWorth: getNetWorth(state),
    pnl: getPnl(state),
    holdingsValue: getHoldingsValue(state),
  };
}

interface CloudSyncContextValue {
  status: CloudStatus;
  leaderboard: LeaderboardSnapshot | null;
  /** Manually (re-)run login + load — useful if the signature popup was blocked. */
  syncNow: () => void;
}

const CloudSyncContext = createContext<CloudSyncContextValue | null>(null);

export function useCloudSync(): CloudSyncContextValue {
  const ctx = useContext(CloudSyncContext);
  if (!ctx) throw new Error("useCloudSync must be used within CloudSyncProvider");
  return ctx;
}

export function CloudSyncProvider({ children }: { children: ReactNode }) {
  const { wallet, status: walletStatus, signMessage } = useInjPass();
  const { state, actions } = useGame();

  const [status, setStatus] = useState<CloudStatus>("idle");
  const [leaderboard, setLeaderboard] = useState<LeaderboardSnapshot | null>(null);
  const tokenRef = useRef<string | null>(null);
  const loadedRef = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  const refreshLeaderboard = useCallback(async () => {
    const snap = await getLeaderboard(tokenRef.current);
    if (snap) setLeaderboard(snap);
  }, []);

  const login = useCallback(async () => {
    if (!wallet) return;
    setStatus("syncing");
    try {
      const { message } = await requestNonce(wallet.address);
      const sig = await signMessage(message); // opens passkey popup
      if (!sig) {
        setStatus("error");
        return;
      }
      const token = await verifySignature(wallet.address, toHexSignature(sig));
      if (!token) {
        setStatus("error");
        return;
      }
      tokenRef.current = token;
      const cloud = await getCloudState(token);
      if (cloud) {
        actions.replaceState(cloud);
      } else {
        const s = stateRef.current;
        await putCloudState(token, s, computeMetrics(s), wallet.walletName);
      }
      loadedRef.current = true;
      setStatus("synced");
      void refreshLeaderboard();
    } catch {
      setStatus("error");
    }
  }, [wallet, signMessage, actions, refreshLeaderboard]);

  // Auto-attempt sign-in once per connected address.
  const attemptedFor = useRef<string | null>(null);
  useEffect(() => {
    if (walletStatus !== "connected" || !wallet) {
      tokenRef.current = null;
      loadedRef.current = false;
      attemptedFor.current = null;
      setStatus("idle");
      return;
    }
    if (attemptedFor.current === wallet.address) return;
    attemptedFor.current = wallet.address;
    void login();
  }, [walletStatus, wallet, login]);

  // Debounced cloud save on state change (only once logged in + initial load done).
  useEffect(() => {
    if (!tokenRef.current || !loadedRef.current) return;
    const id = setTimeout(async () => {
      if (!tokenRef.current) return;
      const ok = await putCloudState(tokenRef.current, state, computeMetrics(state), wallet?.walletName);
      if (ok) void refreshLeaderboard();
    }, 1500);
    return () => clearTimeout(id);
  }, [state, wallet, refreshLeaderboard]);

  return (
    <CloudSyncContext.Provider value={{ status, leaderboard, syncNow: () => void login() }}>
      {children}
    </CloudSyncContext.Provider>
  );
}
