"use client";

import { useState } from "react";
import { useInjPass } from "./InjPassProvider";
import { useGame } from "@/state/GameProvider";
import { useCloudSync } from "@/state/CloudSyncProvider";

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
  cloudSync: { zh: "☁ 同步存档", en: "☁ Sync save" },
  cloudSyncing: { zh: "☁ 同步中…", en: "☁ Syncing…" },
  cloudSynced: { zh: "☁ 已同步 ✓", en: "☁ Synced ✓" },
  cloudError: { zh: "☁ 同步失败 · 重试", en: "☁ Sync failed · retry" },
  popupBlocked: {
    zh: "弹窗被拦截，请允许本站弹窗后重试。",
    en: "Popup blocked — allow popups for this site and retry.",
  },
};

export function ConnectButton() {
  const { status, wallet, error, connect, disconnect, signMessage } = useInjPass();
  const { state } = useGame();
  const { status: cloudStatus } = useCloudSync();
  const locale = state.locale;

  const cloudLabelKey =
    cloudStatus === "syncing"
      ? "cloudSyncing"
      : cloudStatus === "synced"
        ? "cloudSynced"
        : cloudStatus === "error"
          ? "cloudError"
          : "cloudSync";
  const [open, setOpen] = useState(false);
  const [signedNote, setSignedNote] = useState<string | null>(null);

  const label = (key: keyof typeof LABELS) => LABELS[key][locale];

  if (status === "connected" && wallet) {
    return (
      <div className="wallet-chip-wrap">
        <button
          className="icon-button wallet-chip"
          type="button"
          onClick={() => setOpen((v) => !v)}
          title={wallet.address}
        >
          <span aria-hidden="true">🟣</span>
          <span className="wallet-chip-label">
            {wallet.walletName ? `${wallet.walletName} · ` : ""}
            {truncate(wallet.address)}
          </span>
        </button>
        {open && (
          <div className="wallet-menu" role="menu">
            <div className="wallet-status" role="status">
              {LABELS[cloudLabelKey][locale]}
            </div>
            <button
              type="button"
              role="menuitem"
              onClick={async () => {
                const sig = await signMessage("INJ Pass × Bankrupt Elon Musk");
                if (sig) setSignedNote(`${label("signed")} (${sig.length}B)`);
                setTimeout(() => setSignedNote(null), 2400);
              }}
            >
              {signedNote || label("sign")}
            </button>
            <button
              type="button"
              role="menuitem"
              className="danger"
              onClick={() => {
                disconnect();
                setOpen(false);
              }}
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
        disabled={status === "connecting"}
        onClick={() => void connect()}
        title={label("connect")}
      >
        <span aria-hidden="true">🔗</span>
        <span>{status === "connecting" ? label("connecting") : label("connect")}</span>
      </button>
      {error && (
        <div className="wallet-error">
          {error.toLowerCase().includes("popup") ? label("popupBlocked") : error}
        </div>
      )}
    </div>
  );
}
