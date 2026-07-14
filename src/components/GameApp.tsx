"use client";

import { useEffect } from "react";
import { GameProvider, useGame } from "@/state/GameProvider";
import { CloudSyncProvider } from "@/state/CloudSyncProvider";
import { InjPassProvider } from "@/wallet/InjPassProvider";
import { t } from "@/i18n";
import { TopBar } from "./TopBar";
import { FxTicker } from "./FxTicker";
import { SessionBar } from "./SessionBar";
import { PortfolioPanel } from "./PortfolioPanel";
import { MarketPanel } from "./MarketPanel";

function GameShell() {
  const { state, ready } = useGame();

  useEffect(() => {
    document.documentElement.lang = state.locale === "en" ? "en" : "zh-CN";
    document.title = t(state.locale, "brandTitle");
  }, [state.locale]);

  return (
    <div className="app-shell">
      <TopBar />
      <FxTicker />
      <SessionBar />
      <main className="dashboard-grid">
        <PortfolioPanel />
        <MarketPanel />
      </main>
      {!ready && <span hidden aria-hidden="true" data-loading="true" />}
    </div>
  );
}

export function GameApp() {
  return (
    <InjPassProvider>
      <GameProvider>
        <CloudSyncProvider>
          <GameShell />
        </CloudSyncProvider>
      </GameProvider>
    </InjPassProvider>
  );
}
