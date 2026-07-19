"use client";

import { useEffect } from "react";
import { t } from "@/i18n";
import type { Locale } from "@/types";

interface ResetDialogProps {
  open: boolean;
  locale: Locale;
  onCancel: () => void;
  onConfirm: () => void;
  disabled?: boolean;
}

// Confirmation modal for the (temporary) reset action. Kept self-contained so the
// whole reset feature can be removed in one step later.
export function ResetDialog({ open, locale, onCancel, onConfirm, disabled = false }: ResetDialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="reset-dialog-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="resetDialogTitle"
      aria-describedby="resetDialogText"
      onClick={onCancel}
    >
      <div className="reset-dialog-card" onClick={(event) => event.stopPropagation()}>
        <div className="reset-dialog-mark" aria-hidden="true">
          ↺
        </div>
        <div className="reset-dialog-copy">
          <h2 id="resetDialogTitle">{t(locale, "resetDialogTitle")}</h2>
          <p id="resetDialogText">{t(locale, "resetDialogText")}</p>
        </div>
        <div className="reset-dialog-actions">
          <button className="reset-dialog-button secondary" type="button" onClick={onCancel}>
            {t(locale, "resetDialogNo")}
          </button>
          <button className="reset-dialog-button danger" type="button" disabled={disabled} onClick={onConfirm}>
            {disabled ? t(locale, "error.RESET_DISABLED") : t(locale, "resetDialogYes")}
          </button>
        </div>
      </div>
    </div>
  );
}
