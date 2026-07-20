# Public Market Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show signed-out visitors the complete 160-asset market with real Supabase quotes while keeping every account and trade operation behind INJ Pass authentication.

**Architecture:** Introduce a dedicated `MarketProjection` returned by a public read-only API and loaded independently from session restoration. Share asset rendering between public and authenticated projections, render a guest onboarding panel when no account exists, and route every signed-out trade intent into the existing INJ Pass connect-and-sign flow.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Prisma 6, PostgreSQL/Supabase, Vitest, Testing Library, `@injpass/cli`.

## Global Constraints

- Public market responses contain asset metadata and quotes only; never expose players, wallets, positions, transactions, nonces, credentials, or reset metadata.
- Real values come from `Asset` and `AssetQuote`; do not add mock prices or browser-persisted financial state.
- Signed-out users may search, filter, sort, and inspect all enabled assets but cannot create an account, position, or transaction.
- Buy, buy-max, sell, and close controls remain visible for active assets and start INJ Pass authentication when signed out.
- `GET /api/game`, `POST /api/trades`, and `POST /api/game/reset` remain authenticated server-authoritative endpoints.
- Missing/error quotes show no price; stale quotes show the last stored price with a stale label and remain non-tradeable after login.
- A cancelled or failed login must preserve the already loaded public market.

---

### Task 1: Public Market Projection and Route

**Files:**
- Modify: `src/types/index.ts`
- Create: `src/server/market/projection.ts`
- Create: `src/server/market/projection.test.ts`
- Create: `app/api/market/route.ts`
- Create: `app/api/market/route.test.ts`

**Interfaces:**
- Consumes: Prisma models `Asset` and `AssetQuote`, `isQuoteFresh(marketDate: Date, now: Date): boolean`, and `toErrorResponse(error)`.
- Produces: `MarketProjection`, `getMarketProjection(now?: Date): Promise<MarketProjection>`, and public `GET /api/market`.

- [ ] **Step 1: Add failing projection tests**

Create `src/server/market/projection.test.ts` with Prisma mocked before importing the subject. Assert that enabled assets are ordered by `displayOrder`, decimal prices remain strings, stale quotes retain their price but become `STALE`, missing quotes become `MISSING`, and `marketAsOf` is the newest quote date.

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("@/server/db", () => ({ prisma: { asset: { findMany: mocks.findMany } } }));

import { getMarketProjection } from "./projection";

describe("getMarketProjection", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns public real quotes without account data", async () => {
    mocks.findMany.mockResolvedValue([
      { id: "fresh", nameZh: "新鲜", nameEn: "Fresh", assetClass: "美股", subCategory: null, ticker: "F", currency: "USD", unit: "股", unitEn: "share", enabled: true, displayOrder: 1, quote: { usdPrice: { toString: () => "12.25" }, marketDate: new Date("2026-07-20T00:00:00.000Z"), status: "ACTIVE" } },
      { id: "missing", nameZh: "缺失", nameEn: "Missing", assetClass: "美股", subCategory: null, ticker: "M", currency: "USD", unit: "股", unitEn: "share", enabled: true, displayOrder: 2, quote: null },
    ]);
    const result = await getMarketProjection(new Date("2026-07-20T12:00:00.000Z"));
    expect(result.assets.map((asset) => asset.usdPrice)).toEqual(["12.25", null]);
    expect(result.assets.map((asset) => asset.quoteStatus)).toEqual(["ACTIVE", "MISSING"]);
    expect(result.marketAsOf).toBe("2026-07-20T00:00:00.000Z");
    expect(result).not.toHaveProperty("walletAddress");
  });
});
```

- [ ] **Step 2: Run the projection test and verify failure**

Run:

```bash
pnpm test -- src/server/market/projection.test.ts
```

Expected: FAIL because `./projection` and `MarketProjection` do not exist.

- [ ] **Step 3: Define the public type and implement the projection**

Append to `src/types/index.ts`:

```ts
export interface MarketProjection {
  assets: AssetView[];
  marketAsOf: string | null;
}
```

Implement `src/server/market/projection.ts`:

```ts
import type { MarketProjection } from "@/types";
import { prisma } from "@/server/db";
import { isQuoteFresh } from "@/server/quoteFreshness";

export async function getMarketProjection(now = new Date()): Promise<MarketProjection> {
  const assets = await prisma.asset.findMany({
    where: { enabled: true },
    include: { quote: true },
    orderBy: { displayOrder: "asc" },
  });
  const quoteDates = assets.flatMap((asset) => asset.quote ? [asset.quote.marketDate] : []);
  return {
    assets: assets.map((asset) => ({
      id: asset.id,
      name: asset.nameZh,
      nameEn: asset.nameEn,
      category: asset.assetClass,
      subCategory: asset.subCategory,
      ticker: asset.ticker,
      currency: asset.currency,
      unit: asset.unit,
      unitEn: asset.unitEn,
      enabled: asset.enabled,
      displayOrder: asset.displayOrder,
      usdPrice: asset.quote?.usdPrice.toString() ?? null,
      marketDate: asset.quote?.marketDate.toISOString() ?? null,
      quoteStatus: !asset.quote ? "MISSING" : !isQuoteFresh(asset.quote.marketDate, now) ? "STALE" : asset.quote.status,
    })),
    marketAsOf: quoteDates.length ? new Date(Math.max(...quoteDates.map((date) => date.getTime()))).toISOString() : null,
  };
}
```

- [ ] **Step 4: Add the failing route test**

Create `app/api/market/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ projection: vi.fn() }));
vi.mock("@/server/market/projection", () => ({ getMarketProjection: mocks.projection }));

import { GET } from "./route";

describe("GET /api/market", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns public market data without authentication", async () => {
    mocks.projection.mockResolvedValue({ assets: [], marketAsOf: null });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ assets: [], marketAsOf: null });
  });

  it("does not hide database failures behind a successful response", async () => {
    mocks.projection.mockRejectedValue(new Error("database offline"));
    const response = await GET();
    expect(response.status).toBe(500);
  });
});
```

- [ ] **Step 5: Implement the public route**

Create `app/api/market/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getMarketProjection } from "@/server/market/projection";
import { toErrorResponse } from "@/server/http/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getMarketProjection());
  } catch (error) {
    return toErrorResponse(error);
  }
}
```

- [ ] **Step 6: Verify Task 1 and commit**

Run:

```bash
pnpm test -- src/server/market/projection.test.ts app/api/market/route.test.ts
pnpm typecheck
git add src/types/index.ts src/server/market/projection.ts src/server/market/projection.test.ts app/api/market/route.ts app/api/market/route.test.ts
git commit -m "feat: expose public market projection"
```

Expected: both test files pass and TypeScript reports no errors.

### Task 2: Validated Public Market Client and Independent State

**Files:**
- Modify: `src/client/gameApi.ts`
- Modify: `src/client/gameApi.test.ts`
- Modify: `src/state/GameProvider.tsx`
- Modify: `src/state/GameProvider.test.tsx`

**Interfaces:**
- Consumes: `MarketProjection` from Task 1 and `GET /api/market`.
- Produces: `getMarket(): Promise<MarketProjection>`, `GameApi.getMarket`, and context fields `market`, `marketStatus`, `marketError`, plus `actions.retryMarket()`.

- [ ] **Step 1: Add failing client validation tests**

In `src/client/gameApi.test.ts`, add tests that mock `fetch` and assert `getMarket()` accepts `{ assets, marketAsOf }`, rejects an asset with a numeric `usdPrice`, and never accepts account-only fields as a substitute for the required market schema.

```ts
it("validates the public market response", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ assets: [], marketAsOf: null }), { status: 200 })));
  await expect(gameApi.getMarket()).resolves.toEqual({ assets: [], marketAsOf: null });
});
```

- [ ] **Step 2: Run the client test and verify failure**

Run `pnpm test -- src/client/gameApi.test.ts`.

Expected: FAIL because `getMarket` is not exported.

- [ ] **Step 3: Implement strict client parsing**

Import `MarketProjection`, reuse `validAsset`, and add:

```ts
function market(value: unknown): MarketProjection {
  if (!record(value) || !Array.isArray(value.assets) || !value.assets.every(validAsset) || !stringOrNull(value.marketAsOf)) {
    return invalidResponse("Market response is malformed");
  }
  return value as MarketProjection;
}

export const getMarket = async (): Promise<MarketProjection> =>
  market(await response<unknown>(fetch("/api/market", json("GET"))));
```

- [ ] **Step 4: Add failing provider lifecycle tests**

Extend the `GameApi` test factory with `getMarket`. Add assertions for these flows:

```ts
it("loads public market without a session and preserves it through failed login", async () => {
  const publicMarket = { assets: [{ id: "asset", name: "资产", category: "美股", ticker: "AST", currency: "USD", unit: "股", enabled: true, displayOrder: 1, usdPrice: "12.25", marketDate: "2026-07-20T00:00:00.000Z", quoteStatus: "ACTIVE" as const }], marketAsOf: "2026-07-20T00:00:00.000Z" };
  const client = api({ getMarket: vi.fn().mockResolvedValue(publicMarket), loginWithSignature: vi.fn().mockRejectedValue(new Error("cancelled")) });
  render(<GameProvider api={client}><Probe /></GameProvider>);
  await waitFor(() => expect(screen.getByTestId("market-count")).toHaveTextContent("1"));
  await act(async () => screen.getByText("login").click());
  expect(screen.getByTestId("market-count")).toHaveTextContent("1");
});
```

Update `Probe` to render `game.market?.assets.length ?? 0` and `game.marketStatus`.

- [ ] **Step 5: Implement independent market state**

In `GameProvider.tsx`:

- add `getMarket(): Promise<MarketProjection>` to `GameApi`;
- store `market`, `marketStatus: "loading" | "loaded" | "error"`, and `marketError`;
- start `api.getMarket()` on mount independently of `getSession()`;
- keep market state intact when login fails, logout runs, or session expires;
- when `getGame()` succeeds, set `market` from `{ assets: next.assets, marketAsOf: next.marketAsOf }` so the UI switches atomically to the authenticated projection;
- add `retryMarket()` that issues a new public request and ignores stale completions using a dedicated request counter.

Expose the exact context additions:

```ts
market: MarketProjection | null;
marketStatus: "loading" | "loaded" | "error";
marketError: boolean;
```

and the exact action:

```ts
retryMarket(): Promise<void>;
```

- [ ] **Step 6: Verify Task 2 and commit**

Run:

```bash
pnpm test -- src/client/gameApi.test.ts src/state/GameProvider.test.tsx
pnpm typecheck
git add src/client/gameApi.ts src/client/gameApi.test.ts src/state/GameProvider.tsx src/state/GameProvider.test.tsx
git commit -m "feat: load public market independently"
```

Expected: client and provider suites pass; a failed login does not clear `market`.

### Task 3: Full Guest Shell and Guest Portfolio

**Files:**
- Modify: `src/components/GameApp.tsx`
- Create: `src/components/GuestPortfolioPanel.tsx`
- Create: `src/components/GuestPortfolioPanel.test.tsx`
- Modify: `src/components/MarketPanel.tsx`
- Modify: `src/components/MarketPanel.test.tsx`
- Modify: `src/i18n/strings.ts`
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: `market`, `marketStatus`, `marketError`, `account`, `authStatus`, `ConnectButton`, and `actions.retryMarket()` from Task 2.
- Produces: full signed-out dashboard and guest onboarding panel with no fabricated account metrics.

- [ ] **Step 1: Add failing guest portfolio tests**

Create `GuestPortfolioPanel.test.tsx`. Render it under a locked provider and assert that it contains the connect action and USD 50 billion premise but not `$50,000,000,000.00`, cash balance, PnL, positions, or ranking labels.

```ts
expect(screen.getByText(/连接 INJ Pass.*500 亿|Connect INJ Pass.*50 billion/i)).toBeInTheDocument();
expect(screen.queryByText("$50,000,000,000.00")).not.toBeInTheDocument();
expect(screen.queryByText(/现金余额|Cash balance/)).not.toBeInTheDocument();
```

- [ ] **Step 2: Implement the guest panel and localized copy**

Add bilingual keys for guest title, starting-balance explanation, read-only-market explanation, connect-to-trade text, market unavailable, retry, and public market loading. Implement a focused panel containing `ConnectButton`, a three-step explanation, and no account-derived numbers.

- [ ] **Step 3: Add failing full-shell tests**

In `MarketPanel.test.tsx`, add a signed-out API fixture where `getSession` returns `null` and `getMarket` returns two real quote assets. Assert the market headings, `$12.25`, category/search controls, and guest panel are visible. Assert no `getGame` call occurs.

- [ ] **Step 4: Render market assets independently of account**

In `MarketPanel.tsx`, replace `account?.assets ?? []` with the selected source:

```ts
const assets = account?.assets ?? market?.assets ?? [];
```

Keep held disabled assets only for authenticated accounts. Use the selected assets for product lookup, price display, freshness, categories, search, and sorting.

In `GameApp.tsx`, always render `TopBar`, `FxTicker`, `SessionBar`, and the dashboard grid after initial shell setup. Choose the left panel only by account/authentication state:

```tsx
{authStatus === "authenticated" && account ? <PortfolioPanel /> : <GuestPortfolioPanel />}
<MarketPanel />
```

While public market is loading, retain the shell and show a localized loading state in the market panel. On error, show a retry button invoking `actions.retryMarket()` without removing `GuestPortfolioPanel`.

- [ ] **Step 5: Add minimal responsive styles**

Add `.guest-portfolio`, `.guest-steps`, `.market-load-state`, and `.market-retry` styles using the existing panel spacing, borders, colors, and mobile breakpoints. Do not introduce a second visual system or dependency.

- [ ] **Step 6: Verify Task 3 and commit**

Run:

```bash
pnpm test -- src/components/GuestPortfolioPanel.test.tsx src/components/MarketPanel.test.tsx
pnpm typecheck
git add src/components/GameApp.tsx src/components/GuestPortfolioPanel.tsx src/components/GuestPortfolioPanel.test.tsx src/components/MarketPanel.tsx src/components/MarketPanel.test.tsx src/i18n/strings.ts app/globals.css
git commit -m "feat: render full guest market experience"
```

Expected: locked visitors see real market data and no fabricated account values.

### Task 4: Route Guest Trade Intents Into INJ Pass

**Files:**
- Modify: `src/wallet/InjPassProvider.tsx`
- Modify: `src/wallet/ConnectButton.tsx`
- Create: `src/wallet/useInjPassLogin.ts`
- Create: `src/wallet/useInjPassLogin.test.tsx`
- Modify: `src/components/ProductCard.tsx`
- Modify: `src/components/ProductCard.test.tsx`

**Interfaces:**
- Consumes: existing `useInjPass()` connector and `GameActions.login`.
- Produces: `useInjPassLogin(): { beginLogin(): Promise<boolean>; busy: boolean; error: string | null }`, shared by `ConnectButton` and guest trade controls.

- [ ] **Step 1: Add failing login-flow hook tests**

Test that one call to `beginLogin()` connects, signs the server nonce through the connected wallet signer, and calls `actions.login`; a cancelled connection returns `false`; and concurrent clicks share or reject the active transition without opening two connectors.

- [ ] **Step 2: Extract the shared login flow**

Implement `useInjPassLogin.ts` using `useInjPass()` and `useGame()`. The flow must remain inside the click call stack until `connect()` opens the popup:

```ts
export function useInjPassLogin() {
  const { status, connect } = useInjPass();
  const { actions, pendingCommand } = useGame();
  const beginLogin = useCallback(async () => {
    const connected = await connect();
    if (!connected) return false;
    return actions.login(connected.address, connected.walletName ?? null, async (message) => {
      const signature = await connected.signer.signMessage(message);
      if (!signature) throw new Error("SIGNATURE_REQUIRED");
      return signature;
    });
  }, [actions, connect]);
  return { beginLogin, busy: status === "connecting" || pendingCommand === "login" };
}
```

Refactor `ConnectButton` to call this hook while retaining authenticated disconnect/menu behavior.

- [ ] **Step 3: Add failing guest action tests**

In `ProductCard.test.tsx`, render an active real quote under a locked session. Assert all four buttons are enabled enough to receive a click, each invokes `beginLogin`, no trade ticket opens, and `submitTrade` remains uncalled. Retain existing authenticated quote and settlement tests.

- [ ] **Step 4: Implement guest trade intent behavior**

In `ProductCard`, calculate separate states:

- quote disabled: asset missing/disabled, quote missing/error/stale, or no price;
- authenticated trade disabled: pending command or settlement lock;
- guest controls: enabled only for an active quote and disabled while login is busy.

For signed-out clicks, call `beginLogin()` for buy, buy-max, sell, and close. Do not call `onOpenTicket`, `actions.buyMax`, or `actions.sellAll`. For authenticated clicks, preserve existing behavior and holdings restrictions. Guest sell/close remain visible and act as login invitations even though the guest has no position.

- [ ] **Step 5: Verify Task 4 and commit**

Run:

```bash
pnpm test -- src/wallet/useInjPassLogin.test.tsx src/wallet/ConnectButton.test.tsx src/components/ProductCard.test.tsx app/api/trades/route.test.ts app/api/game/reset/route.test.ts
pnpm typecheck
git add src/wallet/InjPassProvider.tsx src/wallet/ConnectButton.tsx src/wallet/useInjPassLogin.ts src/wallet/useInjPassLogin.test.tsx src/components/ProductCard.tsx src/components/ProductCard.test.tsx
git commit -m "feat: require INJ Pass for guest trade intents"
```

Expected: guest clicks start authentication, never submit trades, and direct mutation routes still return `401`.

### Task 5: End-to-End Regression and Production Readiness

**Files:**
- Modify: `src/components/GameApp.test.tsx` if it exists; otherwise create it.
- Modify: `docs/superpowers/specs/2026-07-20-public-market-preview-design.md` only if implementation reveals a necessary clarification.

**Interfaces:**
- Consumes: completed public API, provider state, guest UI, and login flow.
- Produces: regression evidence that the feature works without weakening server authorization.

- [ ] **Step 1: Add an integrated guest-to-account test**

Render `GameApp` with injectable provider dependencies or a focused shell harness. Start with no session and a populated public market, assert the full guest UI, complete the mocked INJ Pass login, resolve `getGame`, and assert that the guest panel is replaced by exact authoritative account values while the market stays populated.

- [ ] **Step 2: Run focused integration tests**

Run:

```bash
pnpm test -- app/api/market/route.test.ts src/server/market/projection.test.ts src/client/gameApi.test.ts src/state/GameProvider.test.tsx src/components/GuestPortfolioPanel.test.tsx src/components/MarketPanel.test.tsx src/components/ProductCard.test.tsx src/wallet/useInjPassLogin.test.tsx
```

Expected: all focused suites pass.

- [ ] **Step 3: Run the full verification suite**

Run:

```bash
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

Expected: all unit tests pass, database integration tests remain intentionally skipped under the default command, TypeScript has no errors, Next.js production build succeeds, and no whitespace errors are reported.

- [ ] **Step 4: Verify against the real production-shaped database**

With a non-production test database containing the migrated schema and quotes, run:

```bash
pnpm test:integration
```

Expected: the isolated PostgreSQL workflow migrates, seeds, runs all database integration tests, and cleans itself up successfully.

- [ ] **Step 5: Commit final regression coverage**

```bash
git add src/components/GameApp.test.tsx docs/superpowers/specs/2026-07-20-public-market-preview-design.md
git commit -m "test: cover public market guest flow"
```

If the spec did not need clarification, omit it from `git add`. Expected: the working tree is clean after the commit.
