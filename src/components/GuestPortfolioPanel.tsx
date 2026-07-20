"use client";

import { t } from "@/i18n";
import { useGame } from "@/state/GameProvider";
import { ConnectButton } from "@/wallet/ConnectButton";

export function GuestPortfolioPanel() {
  const { state } = useGame();
  const locale = state.locale;

  return (
    <aside className="panel inventory-panel guest-portfolio" aria-labelledby="guestPortfolioTitle">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Portfolio</p>
          <h2 id="guestPortfolioTitle">{t(locale, "guestTitle")}</h2>
        </div>
      </div>
      <div className="guest-hero">
        <strong>{t(locale, "guestGrantTitle")}</strong>
        <p>{t(locale, "guestGrantText")}</p>
        <ConnectButton />
      </div>
      <ol className="guest-steps">
        <li><span>1</span><p>{t(locale, "guestStepMarket")}</p></li>
        <li><span>2</span><p>{t(locale, "guestStepConnect")}</p></li>
        <li><span>3</span><p>{t(locale, "guestStepRestore")}</p></li>
      </ol>
      <p className="guest-readonly">{t(locale, "guestReadOnly")}</p>
    </aside>
  );
}
