"use client";

import { useEffect } from "react";
import { errorText, t } from "@/i18n";
import { formatDecimalCurrency } from "@/game/format";
import { useGame, type OperationFeedback } from "@/state/GameProvider";
import type { Locale } from "@/types";

function successTitle(locale: Locale, feedback: OperationFeedback): string {
  if (feedback.kind === "trade") return t(locale, feedback.side === "SELL" ? "tradeSellSuccess" : "tradeBuySuccess");
  return t(locale, `${feedback.kind}Success`);
}

export function OperationToastView({
  locale,
  feedback,
  assetName,
  onDismiss,
}: {
  locale: Locale;
  feedback: OperationFeedback;
  assetName?: string;
  onDismiss: () => void;
}) {
  const error = feedback.status === "error";
  const tradeDetail = feedback.kind === "trade" && feedback.status === "success"
    ? [assetName, feedback.quantity ? `×${feedback.quantity}` : null, feedback.usdAmount ? formatDecimalCurrency(feedback.usdAmount) : null].filter(Boolean).join(" ")
    : null;
  return (
    <div className={`operation-toast ${feedback.status}`} role={error ? "alert" : "status"} data-operation={feedback.kind}>
      <span className="operation-toast-icon" aria-hidden="true">{error ? "!" : "✓"}</span>
      <div className="operation-toast-copy">
        <strong>{error ? errorText(locale, feedback.code ?? "REQUEST_FAILED") : successTitle(locale, feedback)}</strong>
        {tradeDetail ? <p>{tradeDetail}</p> : null}
      </div>
      <button type="button" className="operation-toast-close" aria-label={t(locale, "dismiss")} onClick={onDismiss}>×</button>
    </div>
  );
}

export function OperationToast() {
  const { state, account, market, feedback, actions } = useGame();
  useEffect(() => {
    if (!feedback) return;
    const timeout = window.setTimeout(actions.dismissFeedback, feedback.status === "error" ? 5_000 : 3_500);
    return () => window.clearTimeout(timeout);
  }, [actions.dismissFeedback, feedback]);
  if (!feedback) return null;
  const asset = (account?.assets ?? market?.assets)?.find((item) => item.id === feedback.assetId);
  return <OperationToastView key={feedback.id} locale={state.locale} feedback={feedback} assetName={asset?.name} onDismiss={actions.dismissFeedback} />;
}
