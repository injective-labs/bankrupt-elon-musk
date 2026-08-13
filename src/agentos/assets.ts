import type { AssetView } from "@/types";

export type AssetResolution =
  | { kind: "exact"; asset: AssetView }
  | { kind: "missing" }
  | { kind: "ambiguous"; candidates: AssetView[] };

function normalize(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase().replace(/[\s_-]+/g, " ");
}

const TICKER_ALIASES = new Map([
  ["dogecoin", "doge"],
  ["doge coin", "doge"],
  ["doge coins", "doge"],
  ["doges coin", "doge"],
  ["doges coins", "doge"],
]);

function resolveStage(matches: AssetView[]): AssetResolution | null {
  if (matches.length === 1) return { kind: "exact", asset: matches[0] };
  if (matches.length > 1) return { kind: "ambiguous", candidates: matches.slice(0, 10) };
  return null;
}

export function resolveElonAsset(assets: AssetView[], input: string): AssetResolution {
  const raw = input.trim();
  if (!raw) return { kind: "missing" };
  const folded = raw.toLocaleLowerCase();
  const normalized = normalize(raw);
  const aliasedTicker = TICKER_ALIASES.get(normalized);
  const stages = [
    assets.filter((asset) => asset.id.toLocaleLowerCase() === folded),
    ...(aliasedTicker ? [assets.filter((asset) => asset.ticker.toLocaleLowerCase() === aliasedTicker)] : []),
    assets.filter((asset) => asset.ticker.toLocaleLowerCase() === folded),
    assets.filter((asset) => [asset.name, asset.nameEn].some((name) => name?.toLocaleLowerCase() === folded)),
    assets.filter((asset) => [asset.name, asset.nameEn].some((name) => name && normalize(name) === normalized)),
  ];
  for (const matches of stages) {
    const resolution = resolveStage(matches);
    if (resolution) return resolution;
  }

  const candidates = assets.filter((asset) => [asset.id, asset.ticker, asset.name, asset.nameEn]
    .some((value) => value && normalize(value).includes(normalized))).slice(0, 10);
  if (candidates.length > 0) return { kind: "ambiguous", candidates };
  return { kind: "missing" };
}
