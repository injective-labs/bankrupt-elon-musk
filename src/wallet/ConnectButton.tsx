"use client";

import { useState } from "react";
import { useInjPass } from "./InjPassProvider";
import { useGame } from "@/state/GameProvider";
import { useInjPassLogin } from "./useInjPassLogin";

function truncate(address: string): string {
  if (!address) return "";
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

const LABELS = {
  connect: { zh: "连接 INJ Pass", en: "Connect INJ Pass" },
  connecting: { zh: "连接中…", en: "Connecting…" },
  authorize: { zh: "授权游戏", en: "Authorize game" },
  authorizing: { zh: "授权中…", en: "Authorizing…" },
  disconnect: { zh: "断开", en: "Disconnect" },
  authenticated: { zh: "已认证", en: "Authenticated" },
  popupBlocked: {
    zh: "弹窗被拦截，请允许本站弹窗后重试。",
    en: "Popup blocked — allow popups for this site and retry.",
  },
};

export function ConnectButton() {
  const { status, wallet, error, disconnect } = useInjPass();
  const { state, authStatus, account, actions, pendingCommand } = useGame();
  const { beginLogin, busy } = useInjPassLogin();
  const locale = state.locale;

  const [open, setOpen] = useState(false);
  const label = (key: keyof typeof LABELS) => LABELS[key][locale];

  const identity = authStatus === "authenticated" && account
    ? { address: account.walletAddress, walletName: account.walletName }
    : null;

  if (identity) {
    return (
      <div className="wallet-chip-wrap">
        <button
          className="icon-button wallet-chip"
          type="button"
          onClick={() => setOpen((v) => !v)}
          title={identity.address}
        >
          <span aria-hidden="true">🟣</span>
          <span className="wallet-chip-label">
            {identity.walletName ? `${identity.walletName} · ` : ""}
            {truncate(identity.address)}
          </span>
        </button>
        {open && (
          <div className="wallet-menu" role="menu">
            <div className="wallet-status" role="status">
              {label("authenticated")}
            </div>
            <button
              type="button"
              role="menuitem"
              className="danger"
              disabled={pendingCommand !== null}
              onClick={() => void (async () => {
                const loggedOut = await actions.logout();
                if (loggedOut) {
                  if (wallet) disconnect();
                  setOpen(false);
                }
              })()}
            >
              {label("disconnect")}
            </button>
          </div>
        )}
      </div>
    );
  }

  if (status === "connected" && wallet) {
    const walletLabel = wallet.walletName || truncate(wallet.address);
    return (
      <div className="wallet-chip-wrap">
        <button
          className="icon-button wallet-connect"
          type="button"
          disabled={busy}
          onClick={() => void beginLogin()}
          title={`${walletLabel} · ${label("authorize")}`}
        >
          <span aria-hidden="true">🟣</span>
          <span>{walletLabel} · {busy ? label("authorizing") : label("authorize")}</span>
        </button>
        {error && <div className="wallet-error">{error}</div>}
      </div>
    );
  }

  return (
    <div className="wallet-chip-wrap">
      <button
        className="icon-button wallet-connect"
        type="button"
        disabled={busy}
        onClick={() => void beginLogin()}
        title={label("connect")}
      >
        <span aria-hidden="true">🔗</span>
        <span>{status === "connecting" || pendingCommand === "login" ? label("connecting") : label("connect")}</span>
      </button>
      {error && (
        <div className="wallet-error">
          {error.toLowerCase().includes("popup") ? label("popupBlocked") : error}
        </div>
      )}
    </div>
  );
}
