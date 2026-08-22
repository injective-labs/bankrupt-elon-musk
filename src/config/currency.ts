/**
 * Display name for the INJ Pass spendable balance, as referenced by this
 * mini-app's copy.
 *
 * Mirrors inj-pass-frontend/src/config/currency.ts. Separate repos cannot share
 * the constant, so a rebrand updates both. Nothing else here should contain the
 * brand string -- these two lines exist because the reset dialog names the
 * currency and its amount.
 */
export const CURRENCY = {
  /** Ticker shown next to amounts. */
  symbol: 'xINJ',
  /**
   * What resetting the account costs, in the current unit.
   * (was "1 LAM"; 1 LAM = 0.0001 xINJ after the redenomination)
   */
  resetCost: '0.0001',
} as const;
