# Server-Authoritative Game Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require INJ Pass signature login, make PostgreSQL the sole durable game-data source, persist every trade atomically, store daily post-launch market prices, and remove mechanics absent from the current UI.

**Architecture:** The existing Next.js application remains the only deployed project. Route handlers authenticate an HttpOnly JWT, execute authoritative game operations through focused server services, and persist via Prisma to Supabase PostgreSQL. The React client holds a projection returned by those APIs and never creates or uploads authoritative balances, positions, prices, or P&L.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Prisma 6, Supabase PostgreSQL, INJ Pass connector, viem, jose, Yahoo Finance Chart API, Vitest.

## Global Constraints

- Do not create a separate backend project or deployable service.
- A wallet receives USD 50,000,000,000 exactly once, when its `Player` row is first created.
- A returning wallet must load its database account after signed INJ Pass login.
- A trade is visible as successful only after its database transaction commits.
- The browser never supplies authoritative prices, balances, positions, net worth, or P&L.
- Do not persist financial game state or an anonymous player in `localStorage`.
- Remove leverage, debt, interest, borrowing, LTV, and liquidation from the active product.
- Retain reset for testing behind `ENABLE_GAME_RESET=true`.
- Do not backfill prices. `AssetDailyPrice` starts on rollout day.
- Seed exactly the existing 160 tradable assets.
- Serialize Prisma Decimal values as decimal strings at API boundaries.

---

## File Structure

### New focused modules

- `src/server/http/sessionCookie.ts`: cookie constants and set/clear helpers.
- `src/server/http/errors.ts`: typed API errors and consistent JSON responses.
- `src/server/decimal.ts`: Decimal serialization and validation.
- `src/server/account.ts`: first-login bootstrap and account projection.
- `src/server/trades.ts`: authoritative buy/sell transaction service.
- `src/server/reset.ts`: authenticated test reset transaction.
- `src/server/market/yahoo.ts`: Yahoo response parsing and bounded fetches.
- `src/server/market/refresh.ts`: daily quote persistence and stale-state updates.
- `src/server/leaderboard.ts`: server-computed loss rankings.
- `src/client/gameApi.ts`: typed authenticated client only.
- `src/state/GameProvider.tsx`: async authenticated server projection and UI preferences.
- `prisma/seed.ts`: deterministic 160-asset seed.

### Removed after callers migrate

- `src/state/CloudSyncProvider.tsx`
- `src/state/persistence.ts`
- `src/wallet/anonWallet.ts`
- `src/components/FinancePanel.tsx`
- `src/server/gameState.ts`
- `app/api/state/route.ts`
- old browser-driven `src/game/pricing.ts`
- old `app/api/chart/route.ts` after market refresh coverage passes

---

### Task 1: Add the Test Harness and Stable Domain Contracts

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `vitest.config.ts`
- Create: `src/test/setup.ts`
- Modify: `src/types/index.ts`
- Create: `src/server/decimal.ts`
- Test: `src/server/decimal.test.ts`

**Interfaces:**
- Produces `DecimalString`, `AccountProjection`, `AssetView`, `PositionView`, `TransactionView`, `ApiErrorBody`.
- Produces `decimalToString(value: Prisma.Decimal | string | number): string`.
- Produces `parsePositiveIntegerQuantity(value: unknown): Prisma.Decimal`.

- [ ] **Step 1: Install the test tooling**

Run:

```bash
pnpm add -D vitest @vitest/coverage-v8 tsx
```

Add scripts:

```json
{
  "test": "vitest run",
  "test:watch": "vitest",
  "test:coverage": "vitest run --coverage",
  "typecheck": "tsc --noEmit"
}
```

- [ ] **Step 2: Configure Vitest with the project alias**

Create `vitest.config.ts` using `defineConfig`, `environment: "node"`, `setupFiles: ["./src/test/setup.ts"]`, and alias `@` to `./src`. The setup file restores all mocks after each test.

- [ ] **Step 3: Write failing Decimal boundary tests**

Cover:

```ts
expect(decimalToString(new Prisma.Decimal("50000000000.00000000"))).toBe("50000000000");
expect(parsePositiveIntegerQuantity("12").toString()).toBe("12");
expect(() => parsePositiveIntegerQuantity("1.5")).toThrow("positive integer");
expect(() => parsePositiveIntegerQuantity("0")).toThrow("positive integer");
```

- [ ] **Step 4: Replace legacy financial client types with API projection types**

Keep `Product`, locale, sorting, and sound types temporarily. Add string-decimal response types and remove leverage/debt fields from the replacement account projection. Do not remove `GameState` until the UI migration task, so this task remains independently buildable.

- [ ] **Step 5: Implement Decimal parsing and serialization**

Use `Prisma.Decimal`, reject exponent forms and non-integers for trade quantity, and never convert authoritative values through JavaScript `number`.

- [ ] **Step 6: Run verification and commit**

```bash
pnpm test -- src/server/decimal.test.ts
pnpm typecheck
git add package.json pnpm-lock.yaml vitest.config.ts src/test src/types src/server/decimal.ts
git commit -m "test: add server domain test harness"
```

Expected: tests and typecheck pass.

---

### Task 2: Replace the Prisma Schema and Seed the 160 Assets

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260719_server_authoritative_game/migration.sql`
- Create: `prisma/seed.ts`
- Modify: `package.json`
- Create: `src/data/assetSeed.ts`
- Test: `src/data/assetSeed.test.ts`

**Interfaces:**
- Produces `buildAssetSeed(): AssetSeedRow[]` from the checked-in catalogue.
- Produces Prisma models `Player`, `Position`, `Transaction`, `Asset`, `AssetQuote`, `AssetDailyPrice`, `AuthNonce`, and retained `TradeLog`.

- [ ] **Step 1: Write a failing seed integrity test**

Assert:

```ts
const rows = buildAssetSeed();
expect(rows).toHaveLength(160);
expect(new Set(rows.map((row) => row.id)).size).toBe(160);
expect(rows.every((row) => row.quoteSymbol && row.enabled)).toBe(true);
```

Also snapshot counts: crypto 12, US 38, HK 20, Korea 23, Taiwan 23, Japan 32, metals 5, commodities 7.

- [ ] **Step 2: Implement the deterministic asset seed adapter**

Map `getInvestmentProducts()` plus `getQuoteSymbol()` into database fields. Fail generation if any enabled asset lacks a unique ID, ticker, currency, or Yahoo quote symbol. Preserve current display ordering.

- [ ] **Step 3: Define precise Prisma models**

Use:

```prisma
enum TransactionType { BUY SELL RESET }
enum QuoteStatus { ACTIVE STALE ERROR }

model Player {
  walletAddress String @id
  walletName String?
  cash Decimal @db.Decimal(30, 8)
  lastLoginAt DateTime
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  positions Position[]
  transactions Transaction[]
}
```

Define the remaining models exactly as approved in the design. Add indexes for `(walletAddress, createdAt)`, quote status/date, daily market date, and leaderboard joins.

- [ ] **Step 4: Create and inspect the migration SQL**

The migration must:

- create new catalogue, quote, daily-price, and transaction tables;
- convert existing cash, quantity, and cost basis to Numeric;
- preserve valid Player and Position rows;
- add `lastLoginAt` with a safe initial value;
- remove obsolete Player columns only after preservation statements;
- retain the existing `TradeLog` table unchanged;
- add foreign keys after the Asset seed is available, or make the migration/seed order explicit so existing product IDs do not violate the constraint.

Do not apply this migration to production during implementation.

- [ ] **Step 5: Implement idempotent seed execution**

`prisma/seed.ts` calls `buildAssetSeed()` and upserts all 160 assets without deleting price history. Configure the Prisma seed command in `package.json`.

- [ ] **Step 6: Verify against an isolated/test database and commit**

```bash
pnpm prisma validate
pnpm prisma generate
pnpm test -- src/data/assetSeed.test.ts
pnpm typecheck
git add prisma package.json pnpm-lock.yaml src/data/assetSeed.ts src/data/assetSeed.test.ts
git commit -m "feat: add authoritative game data schema"
```

Expected: Prisma validation succeeds and exactly 160 seed rows pass validation.

---

### Task 3: Complete Signed INJ Pass Authentication and One-Time Funding

**Files:**
- Modify: `src/server/auth.ts`
- Modify: `app/api/auth/verify/route.ts`
- Create: `app/api/auth/session/route.ts`
- Create: `app/api/auth/logout/route.ts`
- Create: `src/server/http/sessionCookie.ts`
- Create: `src/server/http/errors.ts`
- Create: `src/server/account.ts`
- Test: `src/server/account.test.ts`
- Test: `app/api/auth/verify/route.test.ts`

**Interfaces:**
- Produces `authenticateRequest(request: Request): Promise<string>` returning the checksum wallet or throwing 401.
- Produces `loginPlayer(walletAddress: string, walletName?: string | null): Promise<Player>`.
- Produces `SESSION_COOKIE_NAME = "musk_session"`.

- [ ] **Step 1: Write failing one-time funding tests**

Test a repository/service boundary so:

```ts
await loginPlayer(wallet);
await loginPlayer(wallet);
expect(playerCreate).toHaveBeenCalledTimes(1);
expect(current.cash.toString()).toBe("50000000000");
```

Also assert returning login updates `lastLoginAt` and never overwrites cash.

- [ ] **Step 2: Write failing cookie and session tests**

Verify successful signature response sets Secure/HttpOnly/SameSite=Lax/Path=/ cookie; invalid signature sets none; session returns 401 for missing/expired JWT; logout expires the cookie.

- [ ] **Step 3: Implement typed HTTP errors and response mapping**

Create `ApiError(status, code, message, details?)` and `toErrorResponse(error)` so routes do not expose database messages or stack traces.

- [ ] **Step 4: Implement one-time Player bootstrap**

Use an atomic `upsert` whose update branch changes only wallet metadata and login time. The create branch sets the starting balance. Do not perform a preceding `findUnique` followed by `create`, which races on concurrent first login.

- [ ] **Step 5: Store the JWT only in an HttpOnly cookie**

`verify` returns public wallet metadata but not the token body. Require `JWT_SECRET` outside test/development; remove the production fallback secret. Add `authenticateRequest` for all private handlers.

- [ ] **Step 6: Implement session and logout routes**

Session verifies the cookie, checks that Player still exists, and returns wallet metadata. Logout clears the cookie regardless of current validity.

- [ ] **Step 7: Run verification and commit**

```bash
pnpm test -- src/server/account.test.ts app/api/auth/verify/route.test.ts
pnpm typecheck
git add src/server/auth.ts src/server/account.ts src/server/http app/api/auth
git commit -m "feat: require signed wallet game sessions"
```

---

### Task 4: Add Daily Yahoo Market Persistence

**Files:**
- Create: `src/server/market/yahoo.ts`
- Create: `src/server/market/refresh.ts`
- Create: `app/api/cron/refresh-market/route.ts`
- Create: `src/server/market/yahoo.test.ts`
- Create: `src/server/market/refresh.test.ts`
- Create: `vercel.json`

**Interfaces:**
- Produces `fetchDailyBar(symbol): Promise<DailyBar>`.
- Produces `refreshMarket(options?: { now?: Date; concurrency?: number }): Promise<RefreshSummary>`.
- Produces `{ attempted, active, stale, failed, marketDates }` summary.

- [ ] **Step 1: Write failing Yahoo parsing tests**

Use saved inline response fixtures to test latest valid OHLC selection, missing/null closes, currencies, timestamps, and upstream non-200 responses. No test calls the live internet.

- [ ] **Step 2: Write failing persistence tests**

Assert the refresh service:

- upserts one `AssetDailyPrice` per `(assetId, marketDate)`;
- updates `AssetQuote` with the same close and FX snapshot;
- does not create pre-launch rows;
- keeps the last valid price after one asset fails;
- marks failed assets stale/error without rolling back successful assets;
- never overwrites a newer market date with an older upstream response.

- [ ] **Step 3: Implement the Yahoo client**

Move response parsing out of the old browser pricing module. Fetch only server-side, apply a fixed user agent and timeout, and use bounded concurrency rather than 160 simultaneous calls.

- [ ] **Step 4: Implement currency conversion and daily persistence**

Fetch required Yahoo FX pairs once per run. Store the exact `fxRateToUsd` used in both quote and daily row. Apply `quoteMultiplier` before calculating USD price. Use per-asset transactions or independent upserts so a single symbol failure does not abort the run.

- [ ] **Step 5: Protect and schedule the cron route**

Reject requests unless `Authorization` exactly matches `Bearer ${CRON_SECRET}`. Configure one daily Vercel cron invocation after the game's HKT settlement anchor. The route returns only a summary, not secrets or raw upstream payloads.

- [ ] **Step 6: Run verification and commit**

```bash
pnpm test -- src/server/market
pnpm typecheck
git add src/server/market app/api/cron vercel.json
git commit -m "feat: persist daily authoritative market quotes"
```

---

### Task 5: Build the Account Projection and Server-Computed Leaderboard

**Files:**
- Modify: `src/server/account.ts`
- Create: `src/server/leaderboard.ts`
- Create: `app/api/game/route.ts`
- Replace: `app/api/leaderboard/route.ts`
- Test: `src/server/accountProjection.test.ts`
- Test: `src/server/leaderboard.test.ts`

**Interfaces:**
- Produces `getAccountProjection(walletAddress): Promise<AccountProjection>`.
- Produces `getLossLeaderboard(walletAddress, limit): Promise<LeaderboardSnapshot>`.

- [ ] **Step 1: Write failing account projection tests**

Given Decimal cash, positions, and quotes, assert holdings value, net worth, and P&L string values. Verify missing or older-than-seven-day quotes are identified and that no client metric is accepted.

- [ ] **Step 2: Write failing leaderboard tests**

Create fixtures where the ordering differs from stored legacy `Player.pnl`. Assert ranking uses current cash plus positions times authoritative quote and lowest P&L ranks first. Assert masked public addresses and exact caller rank.

- [ ] **Step 3: Implement account projection**

Return database assets in display order, quote status/date, positions, cash, computed metrics, market freshness summary, and settlement lock. Avoid returning internal database IDs that the UI does not need.

- [ ] **Step 4: Implement authenticated `GET /api/game`**

Return 401 without the session cookie. Do not accept a wallet query parameter.

- [ ] **Step 5: Replace the leaderboard snapshot query**

Compute exact rankings on the server from current database state. If Prisma cannot express the aggregation safely with Decimal, use parameter-free/static Prisma SQL with identifiers fixed in code; never concatenate request input.

- [ ] **Step 6: Run verification and commit**

```bash
pnpm test -- src/server/accountProjection.test.ts src/server/leaderboard.test.ts
pnpm typecheck
git add src/server/account.ts src/server/leaderboard.ts app/api/game app/api/leaderboard
git commit -m "feat: serve authoritative account and rankings"
```

---

### Task 6: Implement Atomic Buy, Sell, Buy-Max, and Sell-All

**Files:**
- Create: `src/server/trades.ts`
- Create: `app/api/trades/route.ts`
- Create: `src/server/trades.test.ts`
- Modify: `src/server/http/errors.ts`

**Interfaces:**
- Produces `executeTrade(wallet, command): Promise<AccountProjection>`.
- `TradeCommand` contains `assetId`, `side: "BUY" | "SELL"`, `quantity: string | "MAX"`, and `idempotencyKey`.
- `GET /api/trades?cursor&limit` returns cursor-paginated ledger rows.

- [ ] **Step 1: Write failing accounting tests**

Cover exact Decimal results for buy, weighted cost-basis accumulation, partial sell average-cost reduction, full sell deletion, insufficient cash, insufficient holdings, invalid/fractional quantity, disabled asset, missing quote, quote older than seven days, and settlement lock.

- [ ] **Step 2: Write failing idempotency and concurrency tests**

Assert identical `(wallet, idempotencyKey)` returns the original outcome without a second mutation. Run two simultaneous buys that together exceed cash and assert at most one commits and cash never becomes negative.

- [ ] **Step 3: Implement transaction serialization**

Use a Prisma interactive transaction with serializable isolation and bounded retry for serialization conflicts. Within it, read the authoritative quote and locked/current player state, calculate with Decimal, mutate Player/Position, and insert Transaction. Map exhausted conflicts to 409.

- [ ] **Step 4: Implement MAX semantics on the server**

For BUY `MAX`, compute `floor(cash / usdUnitPrice)`. For SELL `MAX`, use the complete held quantity. The fraction buttons remain client-calculated convenience quantities but are revalidated by the server.

- [ ] **Step 5: Implement route validation and transaction pagination**

Require the JWT cookie and a UUID idempotency key. Cap history page size at 100. Return 422 domain errors without partial writes.

- [ ] **Step 6: Run verification and commit**

```bash
pnpm test -- src/server/trades.test.ts
pnpm typecheck
git add src/server/trades.ts src/server/trades.test.ts src/server/http/errors.ts app/api/trades
git commit -m "feat: execute trades atomically on the server"
```

---

### Task 7: Add the Authenticated Test Reset

**Files:**
- Create: `src/server/reset.ts`
- Create: `app/api/game/reset/route.ts`
- Create: `src/server/reset.test.ts`

**Interfaces:**
- Produces `resetAccount(walletAddress, idempotencyKey): Promise<AccountProjection>`.

- [ ] **Step 1: Write failing reset tests**

Assert disabled reset returns 403 and changes nothing. Enabled reset deletes positions, sets cash to USD 50 billion, adds one immutable RESET row containing cash/position before-and-after values, preserves old ledger rows, and is idempotent.

- [ ] **Step 2: Implement reset in one serializable transaction**

Read `ENABLE_GAME_RESET` on the server only. Do not expose a reset implementation that accepts a wallet address or replacement state from the client.

- [ ] **Step 3: Implement the authenticated route**

Require session and idempotency key, return the new projection only after commit.

- [ ] **Step 4: Run verification and commit**

```bash
pnpm test -- src/server/reset.test.ts
pnpm typecheck
git add src/server/reset.ts src/server/reset.test.ts app/api/game/reset
git commit -m "feat: add authenticated test account reset"
```

---

### Task 8: Replace Client Persistence with Authenticated Server State

**Files:**
- Replace: `src/client/gameApi.ts`
- Replace: `src/state/GameProvider.tsx`
- Modify: `src/wallet/InjPassProvider.tsx`
- Modify: `src/wallet/ConnectButton.tsx`
- Modify: `src/components/GameApp.tsx`
- Delete: `src/state/CloudSyncProvider.tsx`
- Delete: `src/state/persistence.ts`
- Delete: `src/wallet/anonWallet.ts`
- Create: `src/state/GameProvider.test.tsx`
- Modify: `package.json` and `pnpm-lock.yaml` to add jsdom/testing-library if component tests require them

**Interfaces:**
- `gameApi` produces `getSession`, `loginWithSignature`, `logout`, `getGame`, `submitTrade`, `resetGame`, `getTransactions`, and `getLeaderboard`.
- `GameProvider` exposes auth status, account projection, UI-only preferences, async actions, pending command, and last error.

- [ ] **Step 1: Write failing provider behavior tests**

Assert initial state has no USD 50 billion account, valid session loads `/api/game`, missing session remains locked, signed login loads returning data, successful trade replaces projection, failed trade preserves projection, logout clears it, and no `localStorage` method is called.

- [ ] **Step 2: Replace the client API**

Remove `GET/PUT /api/state`, wallet query parameters, full-state uploads, and client metrics. Always use same-origin cookies. Parse error bodies into user-facing error codes.

- [ ] **Step 3: Make INJ Pass connect perform real login**

After connector success, request nonce, sign the returned exact message, verify it, and then load `/api/game`. A connected wallet without successful signature remains unauthenticated and cannot play.

- [ ] **Step 4: Replace GameProvider**

Remove initial financial state, price refresh timers, engine mutation commits, cloud debounce, and persistence. Keep locale/sound/filter/sort in memory. Implement buy/sell/reset as awaited API commands with a generated idempotency UUID.

- [ ] **Step 5: Add locked, loading, authenticated, and expired-session states**

`GameApp` renders a login gate until authentication and account load complete. A 401 during any action clears account state and requests login again.

- [ ] **Step 6: Delete anonymous/cloud persistence files and callers**

Run `rg` to prove no game code calls `localStorage`, `/api/state`, `getOrCreateAnonWallet`, or `CloudSyncProvider`.

- [ ] **Step 7: Run verification and commit**

```bash
pnpm test -- src/state/GameProvider.test.tsx
pnpm typecheck
rg -n "localStorage|/api/state|CloudSyncProvider|getOrCreateAnonWallet" src app
git add -A
git commit -m "feat: load game state only after wallet login"
```

Expected grep result: no active game persistence matches; an explicitly documented non-financial preference exception is not part of this scope and should not be added during this task.

---

### Task 9: Adapt the Existing UI to Server Projections

**Files:**
- Modify: `src/components/TopBar.tsx`
- Modify: `src/components/MarketPanel.tsx`
- Modify: `src/components/ProductCard.tsx`
- Modify: `src/components/PortfolioPanel.tsx`
- Modify: `src/components/ResetDialog.tsx`
- Modify: `src/components/FxTicker.tsx`
- Modify: `src/components/SessionBar.tsx`
- Modify: `src/game/format.ts`
- Modify: `src/i18n/strings.ts`
- Modify: `app/globals.css`
- Test: `src/components/ProductCard.test.tsx`
- Test: `src/components/PortfolioPanel.test.tsx`

**Interfaces:**
- Components consume `AccountProjection` and async GameProvider actions only.
- Formatting accepts decimal strings without precision-losing arithmetic for authoritative totals.

- [ ] **Step 1: Write failing UI tests**

Assert unauthenticated controls are disabled, stale/no-price assets show date/status and cannot trade when too old, pending transactions disable duplicate submission, API errors remain visible, and returned cash/positions render after success.

- [ ] **Step 2: Map database assets to current cards and filters**

Preserve the current UI/UX and 160-asset categories. Replace hard-coded runtime prices with returned AssetQuote fields. Continue using checked-in visual accent/icon metadata only where the database does not contain presentation data.

- [ ] **Step 3: Adapt trade tickets**

Buy, sell, fractions, buy-max, and sell-all submit async commands. Estimates are explicitly estimates; final price comes from the server response. Use `MAX` for buy-max/sell-all so stale client balances cannot determine authoritative quantities.

- [ ] **Step 4: Adapt portfolio and leaderboard**

Render server-computed metrics and ranking. Remove the simulated fallback leaderboard when authenticated database data is available; show an explicit unavailable state on API failure rather than invented player data.

- [ ] **Step 5: Add login/sync/error copy in Chinese and English**

Cover signature required, syncing returning account, insufficient balance, insufficient holdings, settlement pause, stale price, session expired, database failure, and reset disabled.

- [ ] **Step 6: Run verification and commit**

```bash
pnpm test -- src/components
pnpm typecheck
git add src/components src/game/format.ts src/i18n/strings.ts app/globals.css
git commit -m "feat: connect current game UI to authoritative data"
```

---

### Task 10: Remove Legacy Leverage and Browser Pricing Code

**Files:**
- Delete: `src/components/FinancePanel.tsx`
- Replace or split: `src/game/engine.ts`
- Delete: `src/game/pricing.ts`
- Delete: `src/server/gameState.ts`
- Delete: `app/api/state/route.ts`
- Delete: `app/api/chart/route.ts`
- Modify: `src/types/index.ts`
- Modify: `src/data/constants.ts`
- Modify: `src/i18n/strings.ts`
- Modify: `app/globals.css`
- Test: relevant server and component suites

**Interfaces:**
- Retain only pure, non-authoritative display helpers still used by UI; financial mutations live exclusively in server services.

- [ ] **Step 1: Add a failing architecture guard test**

Create a test that scans active `src` and `app` files and fails on the removed identifiers:

```text
leverage, debt, accruedInterest, liquidated, borrowMoney,
repayMoney, settleOneDayInterest, accrueInterest, checkLiquidation
```

Permit occurrences only in the historical design/migration documentation.

- [ ] **Step 2: Remove obsolete actions, types, copy, styles, and files**

Delete finance controls and all hidden financial mechanics. Extract any still-needed pure calculations or mock ticker presentation so deleting the old engine does not change the approved UI.

- [ ] **Step 3: Remove obsolete routes after replacements pass**

Delete client-writeable `/api/state` and browser chart proxy. Confirm no route accepts a wallet-selected replacement `GameState` or client metrics.

- [ ] **Step 4: Run the complete local verification and commit**

```bash
pnpm test
pnpm typecheck
pnpm build
rg -n "leverage|debt|accruedInterest|liquidated|borrowMoney|repayMoney|settleOneDayInterest|accrueInterest|checkLiquidation|/api/state|localStorage" src app
git add -A
git commit -m "refactor: remove unsupported finance mechanics"
```

Expected: tests, typecheck, and production build pass; grep has no active-code matches.

---

### Task 11: Test the Migration and End-to-End Authenticated Game Flow

**Files:**
- Create: `tests/integration/game-flow.test.ts`
- Create: `tests/integration/market-refresh.test.ts`
- Create: `.env.example`
- Modify: `README.md`

**Interfaces:**
- Integration tests consume the public route contracts created above and a disposable PostgreSQL database.

- [ ] **Step 1: Document and configure a disposable test database**

Add `.env.example` with names only, never real secrets:

```dotenv
DATABASE_URL=
JWT_SECRET=
CRON_SECRET=
ENABLE_GAME_RESET=true
NEXT_PUBLIC_INJPASS_EMBED_URL=
```

- [ ] **Step 2: Write the database integration flow**

Using a disposable PostgreSQL schema/database, test:

1. migrate and seed exactly 160 assets;
2. first wallet login creates USD 50 billion once;
3. second login preserves changed cash;
4. market refresh adds only current/post-rollout daily rows;
5. authenticated buy commits Player, Position, and Transaction together;
6. simulated database failure commits none;
7. reload projection equals the database state;
8. reset preserves prior ledger rows;
9. leaderboard ignores attempted client P&L input.

- [ ] **Step 3: Add deployment and recovery documentation**

README must include exact order:

```bash
pnpm install --frozen-lockfile
pnpm prisma migrate deploy
pnpm prisma db seed
pnpm test
pnpm build
```

Document how to inspect quote counts, daily-price counts, and transaction rows; how to disable reset; and how to roll back application deployment without deleting new data.

- [ ] **Step 4: Run full verification and commit**

```bash
pnpm prisma validate
pnpm prisma generate
pnpm test
pnpm typecheck
pnpm build
git diff --check
git add tests .env.example README.md
git commit -m "test: verify authenticated game data flow"
```

---

### Task 12: Apply to the Test Supabase Project and Verify Vercel

**Files:**
- No new source files unless verification exposes a defect.

**Interfaces:**
- Consumes the migration, seed, environment contract, cron route, and built application.

- [ ] **Step 1: Rotate previously shared credentials before rollout**

Generate a new Supabase database password and a high-entropy JWT secret. Do not reuse credentials pasted into chat or committed files.

- [ ] **Step 2: Back up and inspect the target database**

Record current table row counts and take a Supabase backup before destructive column removal. Verify the target is the test project, not an unintended production database.

- [ ] **Step 3: Apply migration and seed**

```bash
pnpm prisma migrate deploy
pnpm prisma db seed
```

Verify `Asset=160`, no pre-launch `AssetDailyPrice`, preserved valid players/positions, and zero new authoritative transactions before user testing.

- [ ] **Step 4: Configure Vercel Production/Preview variables**

Set `DATABASE_URL`, new `JWT_SECRET`, `CRON_SECRET`, `ENABLE_GAME_RESET=true`, and `NEXT_PUBLIC_INJPASS_EMBED_URL`. Redeploy because changed environment variables do not alter an already-built deployment.

- [ ] **Step 5: Run the first market refresh**

Call the protected cron route once, inspect its summary, and verify quote coverage. Do not open trading until required assets have valid `AssetQuote` rows.

- [ ] **Step 6: Perform browser acceptance tests**

Use a new INJ Pass wallet and a returning wallet. Confirm signature login, one-time funding, buy, reload synchronization, sell, transaction history, reset, logout lock, stale-price labeling, and database rows.

- [ ] **Step 7: Production readiness gate**

Before public launch, decide whether to set `ENABLE_GAME_RESET=false`. Run `pnpm test`, `pnpm typecheck`, and `pnpm build` against the final commit and record the deployed commit SHA.

---

## Plan Self-Review

- Every approved requirement maps to at least one task.
- Authentication precedes all account and mutation APIs.
- The plan never introduces a separate backend project.
- Prices are not backfilled and trades never accept client prices.
- Reset remains test-only and auditable.
- Database migration is delayed until unit/build verification and a backup.
- Existing user data is preserved where compatible, while obsolete financial semantics are removed.
- Security includes HttpOnly sessions, server-derived wallet identity, idempotency, Decimal arithmetic, and serialized database mutations.
