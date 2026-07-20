"use client";

import { useCallback } from "react";
import { useGame } from "@/state/GameProvider";
import { useInjPass } from "./InjPassProvider";

export function useInjPassLogin() {
  const { status, error, connect } = useInjPass();
  const { actions, pendingCommand } = useGame();

  const beginLogin = useCallback(async () => {
    const connected = await connect();
    if (!connected) return false;
    return actions.login(connected.address, connected.walletName ?? null, async (message) => {
      const signature = await connected.signer.signMessage(message);
      if (!signature) throw new Error("SIGNATURE_REQUIRED");
      return signature;
    });
  }, [actions, connect]);

  return {
    beginLogin,
    busy: status === "connecting" || pendingCommand === "login",
    error,
  };
}
