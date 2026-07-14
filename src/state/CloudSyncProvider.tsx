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
import { getOrCreateAnonWallet } from "@/wallet/anonWallet";
import { useGame } from "./GameProvider";
import {
  getCloudState,
  putCloudState,
  getLeaderboard,
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
  /** The wallet address currently used as the DB key (anon or INJ Pass). */
  walletAddress: string;
}

const CloudSyncContext = createContext<CloudSyncContextValue | null>(null);

export function useCloudSync(): CloudSyncContextValue {
  const ctx = useContext(CloudSyncContext);
  if (!ctx) throw new Error("useCloudSync must be used within CloudSyncProvider");
  return ctx;
}

export function CloudSyncProvider({ children }: { children: ReactNode }) {
  const { wallet } = useInjPass();
  const { state, actions } = useGame();

  const [status, setStatus] = useState<CloudStatus>("idle");
  const [leaderboard, setLeaderboard] = useState<LeaderboardSnapshot | null>(null);
  const [anon, setAnon] = useState("");

  // Assign the anonymous device address after mount (client-only).
  useEffect(() => {
    setAnon(getOrCreateAnonWallet());
  }, []);

  // INJ Pass address (once linked) takes precedence over the anon device address.
  const address = wallet?.address || anon;
  const walletName = wallet?.walletName ?? null;

  const stateRef = useRef(state);
  stateRef.current = state;
  const loadedForRef = useRef<string | null>(null);

  const refreshLeaderboard = useCallback(async (addr: string) => {
    const snap = await getLeaderboard(addr);
    if (snap) setLeaderboard(snap);
  }, []);

  // Load the cloud record for the active address; create it (migrating current
  // local progress) if the DB has none yet.
  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    setStatus("syncing");
    (async () => {
      try {
        const cloud = await getCloudState(address);
        if (cancelled) return;
        if (cloud) {
          actions.replaceState(cloud);
        } else {
          await putCloudState(
            address,
            stateRef.current,
            computeMetrics(stateRef.current),
            walletName,
          );
        }
        loadedForRef.current = address;
        setStatus("synced");
        void refreshLeaderboard(address);
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [address, walletName, actions, refreshLeaderboard]);

  // Debounced save on every state change, once the active address has loaded.
  useEffect(() => {
    if (!address || loadedForRef.current !== address) return;
    const id = setTimeout(async () => {
      const ok = await putCloudState(address, state, computeMetrics(state), walletName);
      if (ok) void refreshLeaderboard(address);
    }, 1200);
    return () => clearTimeout(id);
  }, [state, address, walletName, refreshLeaderboard]);

  return (
    <CloudSyncContext.Provider value={{ status, leaderboard, walletAddress: address }}>
      {children}
    </CloudSyncContext.Provider>
  );
}
