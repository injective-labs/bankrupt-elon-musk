// Fetches real English names for every generated equity ticker from Yahoo Finance
// (v8 chart meta longName/shortName) and writes src/data/assetNames.ts.
// Re-runnable. Run with:  node --experimental-strip-types scripts/fetch-asset-names.mts
//
// Crypto / precious metals / commodities already have curated English names, so we
// only enrich the equity groups (the ones that fell back to "TICKER · US Stocks").
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  US_EQUITY_GROUPS,
  HK_EQUITY_GROUPS,
  A_SHARE_GROUPS,
  KOREA_EQUITY_GROUPS,
  TAIWAN_EQUITY_GROUPS,
  JAPAN_EQUITY_GROUPS,
  EUROPE_EQUITY_GROUPS,
} from "../src/data/marketGroups.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "../src/data/assetNames.ts");

// [groups, finalTicker(rawTicker)] — mirrors expandedAssets.ts ticker construction.
const GROUP_SETS: [[string, string][], (t: string) => string][] = [
  [US_EQUITY_GROUPS, (t) => t],
  [A_SHARE_GROUPS, (t) => t],
  [KOREA_EQUITY_GROUPS, (t) => t],
  [TAIWAN_EQUITY_GROUPS, (t) => t],
  [JAPAN_EQUITY_GROUPS, (t) => t],
  [EUROPE_EQUITY_GROUPS, (t) => t],
  [HK_EQUITY_GROUPS, (t) => t.padStart(4, "0") + ".HK"],
];

const tickers = new Set<string>();
for (const [groups, xf] of GROUP_SETS) {
  for (const [, syms] of groups) {
    for (const raw of syms.trim().split(/\s+/).filter(Boolean)) tickers.add(xf(raw));
  }
}
const all = [...tickers];
console.log(`Tickers to resolve: ${all.length}`);

async function fetchName(symbol: string): Promise<string | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12000);
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) {
        if (res.status === 429) await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      const json = await res.json();
      const meta = json?.chart?.result?.[0]?.meta;
      const name = meta?.longName || meta?.shortName;
      return typeof name === "string" && name.trim() ? name.trim() : null;
    } catch {
      // retry once
    }
  }
  return null;
}

const names: Record<string, { en: string }> = {};
const CONCURRENCY = 8;
let idx = 0;
let done = 0;

async function worker() {
  while (idx < all.length) {
    const i = idx++;
    const ticker = all[i];
    const name = await fetchName(ticker);
    if (name) names[ticker] = { en: name };
    done += 1;
    if (done % 50 === 0) console.log(`  ${done}/${all.length} (resolved ${Object.keys(names).length})`);
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

const sorted = Object.keys(names).sort();
const body = sorted.map((k) => `  ${JSON.stringify(k)}: { en: ${JSON.stringify(names[k].en)} },`).join("\n");

const file = `// Real company / instrument names per ticker, fetched from Yahoo Finance at build
// time by \`scripts/fetch-asset-names.mts\` (re-runnable). Keyed by the asset's final
// \`ticker\`. Used by expandedAssets.ts to give generated assets a real English name;
// missing entries fall back to "TICKER · <English asset class>".
//
// This file is generated — edit the script, not this file by hand.

export interface AssetName {
  en?: string;
  zh?: string;
}

export const ASSET_NAMES: Record<string, AssetName> = {
${body}
};
`;

writeFileSync(OUT, file);
console.log(`Wrote ${sorted.length} names to ${OUT}`);
