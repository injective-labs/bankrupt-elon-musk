"use client";

import { useEffect } from "react";
import { GameProvider, useGame } from "@/state/GameProvider";
import { InjPassProvider } from "@/wallet/InjPassProvider";
import { ConnectButton } from "@/wallet/ConnectButton";
import { t } from "@/i18n";
import { TopBar } from "./TopBar";
import { FxTicker } from "./FxTicker";
import { SessionBar } from "./SessionBar";
import { PortfolioPanel } from "./PortfolioPanel";
import { MarketPanel } from "./MarketPanel";

function GameShell() {
  const { state, authStatus, lastError } = useGame();

  useEffect(() => {
    document.documentElement.lang = state.locale === "en" ? "en" : "zh-CN";
    document.title = t(state.locale, "brandTitle");
  }, [state.locale]);

  if (authStatus !== "authenticated") {
    return <main className="app-shell" data-auth-state={authStatus}>
      <section className="panel" aria-busy={authStatus === "loading"}>
        <h1>{t(state.locale, "brandTitle")}</h1>
        {authStatus === "loading" ? <p>{t(state.locale, "accountSyncing")}</p> : <ConnectButton />}
        {authStatus === "expired" && <p role="alert">{t(state.locale, "error.UNAUTHORIZED")}</p>}
        {lastError && <p role="alert">{t(state.locale, `error.${lastError}`)}</p>}
      </section>
    </main>;
  }

  return (
    <div className="app-shell">
      <TopBar />
      <FxTicker />
      <SessionBar />
      <main className="dashboard-grid">
        <PortfolioPanel />
        <MarketPanel />
      </main>
    </div>
  );
}

export function GameApp() {
  return (
    <InjPassProvider>
      <GameProvider>
        <GameShell />
      </GameProvider>
    </InjPassProvider>
  );
}
