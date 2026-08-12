import { InjPassMiniAppConnector } from "@injpass/cli";

type NodeEnvironment = string | undefined;

let connector: InjPassMiniAppConnector | null = null;

function isDevelopmentLoopback(url: URL): boolean {
  return url.protocol === "http:"
    && ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname);
}

export function trustedInjPassHostOrigin(
  locationHref: string,
  nodeEnv: NodeEnvironment,
  embedUrl: string | undefined,
): string {
  const location = new URL(locationHref);
  if (location.searchParams.get("injpass_miniapp") !== "1") {
    throw new Error("Not running as an INJ Pass mini app");
  }

  const claimedValue = location.searchParams.get("injpass_host_origin");
  if (!claimedValue) throw new Error("Missing INJ Pass host origin");
  if (!embedUrl) throw new Error("Missing NEXT_PUBLIC_INJPASS_EMBED_URL");

  let claimed: URL;
  let configured: URL;
  try {
    claimed = new URL(claimedValue);
    configured = new URL(embedUrl);
  } catch {
    throw new Error("Invalid INJ Pass host origin");
  }

  if (claimed.origin === configured.origin) return claimed.origin;
  if (nodeEnv !== "production" && isDevelopmentLoopback(claimed)) return claimed.origin;
  throw new Error("Untrusted INJ Pass host origin");
}

export function getElonMiniAppConnector(
  locationHref = typeof window === "undefined" ? "" : window.location.href,
  nodeEnv: NodeEnvironment = process.env.NODE_ENV,
  embedUrl = process.env.NEXT_PUBLIC_INJPASS_EMBED_URL,
): InjPassMiniAppConnector | null {
  if (!InjPassMiniAppConnector.isEmbedded()) return null;
  if (connector) return connector;
  const hostOrigin = trustedInjPassHostOrigin(locationHref, nodeEnv, embedUrl);
  connector = new InjPassMiniAppConnector({ hostOrigin });
  return connector;
}

export function destroyElonMiniAppConnector(): void {
  if (!connector) return;
  connector.destroy();
  connector = null;
}
