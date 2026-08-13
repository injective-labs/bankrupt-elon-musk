import { InjPassMiniAppConnector } from "@injpass/cli";

type NodeEnvironment = string | undefined;

let connector: InjPassMiniAppConnector | null = null;

function isDevelopmentLoopback(url: URL): boolean {
  return url.protocol === "http:"
    && ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname);
}

function configuredInjPassHostOrigins(
  embedUrl: string | undefined,
  allowedHostOrigins: string | undefined,
): Set<string> {
  if (!embedUrl) throw new Error("Missing NEXT_PUBLIC_INJPASS_EMBED_URL");

  const values = [
    embedUrl,
    ...(allowedHostOrigins?.split(",") ?? []),
  ].map((value) => value.trim()).filter(Boolean);

  const origins = new Set<string>();
  for (const value of values) {
    let configured: URL;
    try {
      configured = new URL(value);
    } catch {
      throw new Error("Invalid INJ Pass host origin configuration");
    }
    if (configured.protocol !== "https:" && configured.protocol !== "http:") {
      throw new Error("Invalid INJ Pass host origin configuration");
    }
    origins.add(configured.origin);
  }
  return origins;
}

export function trustedInjPassHostOrigin(
  locationHref: string,
  nodeEnv: NodeEnvironment,
  embedUrl: string | undefined,
  allowedHostOrigins = process.env.NEXT_PUBLIC_INJPASS_ALLOWED_HOST_ORIGINS,
): string {
  const location = new URL(locationHref);
  if (location.searchParams.get("injpass_miniapp") !== "1") {
    throw new Error("Not running as an INJ Pass mini app");
  }

  const claimedValue = location.searchParams.get("injpass_host_origin");
  if (!claimedValue) throw new Error("Missing INJ Pass host origin");

  let claimed: URL;
  try {
    claimed = new URL(claimedValue);
  } catch {
    throw new Error("Invalid INJ Pass host origin");
  }

  const configuredOrigins = configuredInjPassHostOrigins(embedUrl, allowedHostOrigins);
  if (configuredOrigins.has(claimed.origin)) return claimed.origin;
  if (nodeEnv !== "production" && isDevelopmentLoopback(claimed)) return claimed.origin;
  throw new Error("Untrusted INJ Pass host origin");
}

export function getElonMiniAppConnector(
  locationHref = typeof window === "undefined" ? "" : window.location.href,
  nodeEnv: NodeEnvironment = process.env.NODE_ENV,
  embedUrl = process.env.NEXT_PUBLIC_INJPASS_EMBED_URL,
  allowedHostOrigins = process.env.NEXT_PUBLIC_INJPASS_ALLOWED_HOST_ORIGINS,
): InjPassMiniAppConnector | null {
  if (!InjPassMiniAppConnector.isEmbedded()) return null;
  if (connector) return connector;
  const hostOrigin = trustedInjPassHostOrigin(
    locationHref,
    nodeEnv,
    embedUrl,
    allowedHostOrigins,
  );
  connector = new InjPassMiniAppConnector({ hostOrigin });
  return connector;
}

export function destroyElonMiniAppConnector(): void {
  if (!connector) return;
  connector.destroy();
  connector = null;
}
