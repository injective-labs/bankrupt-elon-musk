"use client";

import { useEffect } from "react";
import { GameProvider, useGame } from "@/state/GameProvider";
import { InjPassProvider } from "@/wallet/InjPassProvider";
import { errorText, t } from "@/i18n";
import { TopBar } from "./TopBar";
import { FxTicker } from "./FxTicker";
import { SessionBar } from "./SessionBar";
import { PortfolioPanel } from "./PortfolioPanel";
import { MarketPanel } from "./MarketPanel";
import { GuestPortfolioPanel } from "./GuestPortfolioPanel";
import { OperationToast } from "./OperationToast";
import { InjPassAgentBridge } from "@/agentos/InjPassAgentBridge";
import { HostWalletSessionGuard } from "@/wallet/HostWalletSessionGuard";

export function GameShell() {
  const { state, authStatus, lastError } = useGame();

  useEffect(() => {
    document.documentElement.lang = state.locale === "en" ? "en" : "zh-CN";
    document.title = t(state.locale, "brandTitle");
  }, [state.locale]);

  return (
    <div className="app-shell" data-auth-state={authStatus}>
      <TopBar />
      {authStatus === "expired" && <p role="alert">{errorText(state.locale, lastError ?? "UNAUTHORIZED")}</p>}
      <OperationToast />
      <FxTicker />
      <SessionBar />
      <main className="dashboard-grid">
        {authStatus === "authenticated" ? <PortfolioPanel /> : <GuestPortfolioPanel />}
        <MarketPanel />
      </main>
    </div>
  );
}

export function GameApp() {
  return (
    <InjPassProvider>
      <GameProvider>
        <InjPassAgentBridge />
        <HostWalletSessionGuard>
          <GameShell />
        </HostWalletSessionGuard>
      </GameProvider>
    </InjPassProvider>
  );
}
