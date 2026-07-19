"use client";

import { useState } from "react";
import { useInjPass } from "./InjPassProvider";
import { useGame } from "@/state/GameProvider";

function truncate(address: string): string {
  if (!address) return "";
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

const LABELS = {
  connect: { zh: "连接 INJ Pass", en: "Connect INJ Pass" },
  connecting: { zh: "连接中…", en: "Connecting…" },
  sign: { zh: "签名测试", en: "Sign test" },
  signed: { zh: "签名成功", en: "Signed" },
  disconnect: { zh: "断开", en: "Disconnect" },
  authenticated: { zh: "已认证", en: "Authenticated" },
  loginRequired: { zh: "需要签名认证", en: "Signature required" },
  popupBlocked: {
    zh: "弹窗被拦截，请允许本站弹窗后重试。",
    en: "Popup blocked — allow popups for this site and retry.",
  },
};

export function ConnectButton() {
  const { status, wallet, error, connect, disconnect, signMessage } = useInjPass();
  const { state, authStatus, account, actions, pendingCommand } = useGame();
  const locale = state.locale;

  const [open, setOpen] = useState(false);

  const label = (key: keyof typeof LABELS) => LABELS[key][locale];

  const identity = authStatus === "authenticated" && account
    ? { address: account.walletAddress, walletName: account.walletName }
    : status === "connected" && wallet
      ? { address: wallet.address, walletName: wallet.walletName }
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
              {label(authStatus === "authenticated" ? "authenticated" : "loginRequired")}
            </div>
            {authStatus !== "authenticated" && wallet && (
              <button
                type="button"
                role="menuitem"
                disabled={pendingCommand === "login"}
                onClick={() => void actions.login(wallet.address, wallet.walletName ?? null, async (message) => {
                  const signature = await signMessage(message);
                  if (!signature) throw new Error("SIGNATURE_REQUIRED");
                  return signature;
                })}
              >
                {label("sign")}
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              className="danger"
              onClick={() => void (async () => {
                await actions.logout();
                if (wallet) disconnect();
                setOpen(false);
              })()}
            >
              {label("disconnect")}
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="wallet-chip-wrap">
      <button
        className="icon-button wallet-connect"
        type="button"
        disabled={status === "connecting" || pendingCommand === "login"}
        onClick={() => void (async () => {
          const connected = await connect();
          if (!connected) return;
          await actions.login(connected.address, connected.walletName ?? null, async (message) => {
            const signature = await connected.signer.signMessage(message);
            if (!signature) throw new Error("SIGNATURE_REQUIRED");
            return signature;
          });
        })()}
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
