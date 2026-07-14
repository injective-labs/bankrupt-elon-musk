// Anonymous, per-browser identity used as the DB key before (or without) an INJ
// Pass connection. Once INJ Pass is linked, its real wallet address takes over as
// the identifier; this stays as the fallback so every user can persist to the DB
// without any wallet/signature step.
const ANON_WALLET_KEY = "must-anon-wallet";

function isEthLike(value: string | null): value is string {
  return !!value && /^0x[0-9a-fA-F]{40}$/.test(value);
}

export function getOrCreateAnonWallet(): string {
  if (typeof window === "undefined") return "";
  try {
    const existing = window.localStorage.getItem(ANON_WALLET_KEY);
    if (isEthLike(existing)) return existing;
  } catch {
    /* ignore storage errors */
  }
  const bytes = new Uint8Array(20);
  (window.crypto || crypto).getRandomValues(bytes);
  const address = "0x" + Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  try {
    window.localStorage.setItem(ANON_WALLET_KEY, address);
  } catch {
    /* ignore storage errors */
  }
  return address;
}
