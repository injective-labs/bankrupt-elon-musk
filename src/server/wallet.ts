// Wallet address is the sole persistence key. We accept both anonymous device
// addresses (0x + 40 hex) and real wallet addresses (e.g. INJ Pass). No auth: this
// is a stakes-free game and the product requires persistence without a login step.
export function isValidWallet(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9]{6,100}$/.test(value);
}

/** Read & validate the wallet from a request's `?wallet=` query param. */
export function walletFromQuery(request: Request): string | null {
  const wallet = new URL(request.url).searchParams.get("wallet");
  return isValidWallet(wallet) ? wallet : null;
}
