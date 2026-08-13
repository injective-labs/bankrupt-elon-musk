"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { useGame } from "@/state/GameProvider";
import { useInjPass } from "./InjPassProvider";

export function HostWalletSessionGuard({ children }: { children: ReactNode }) {
  const { environmentReady, embedded, sessionReady, wallet } = useInjPass();
  const { authStatus, account, actions } = useGame();
  const invalidatingRef = useRef(false);
  const [invalidating, setInvalidating] = useState(false);

  const hostMismatch = embedded
    && sessionReady
    && authStatus === "authenticated"
    && account !== null
    && (!wallet || wallet.address.toLowerCase() !== account.walletAddress.toLowerCase());

  useEffect(() => {
    if (!hostMismatch || invalidatingRef.current) return;
    invalidatingRef.current = true;
    setInvalidating(true);
    void actions.invalidateSession().finally(() => {
      invalidatingRef.current = false;
      setInvalidating(false);
    });
  }, [actions, hostMismatch]);

  if (!environmentReady || (embedded && (!sessionReady || hostMismatch || invalidating))) {
    return <div className="app-shell" role="status">正在同步 INJ Pass 钱包…</div>;
  }

  return children;
}
