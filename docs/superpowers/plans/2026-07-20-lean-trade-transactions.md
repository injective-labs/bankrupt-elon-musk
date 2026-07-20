# Lean Trade Transactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove full account and market projection work from trade/reset transactions, return compact idempotent receipts, and split global market data from private account state.

**Architecture:** PostgreSQL remains authoritative. Serializable mutation transactions touch only `Player`, the relevant sparse `Position`, the target `AssetQuote`, and one immutable `Transaction`; mutation responses are reconstructed from ledger fields. `GET /api/market` owns the global catalogue while `GET /api/game` returns only private account state.

**Tech Stack:** Next.js 16 App Router, TypeScript 5, Prisma 6, PostgreSQL, React 19, Vitest 4.

## Global Constraints

- Preserve sparse `Position` rows and delete zero-quantity positions.
- Do not query the complete asset catalogue inside trade or reset transactions.
- Do not write complete account responses to new `Transaction.resultSnapshot` values.
- Preserve exact decimal arithmetic and JSON string serialization.
- Preserve `(walletAddress, idempotencyKey)` uniqueness and bounded serializable retries.
- Keep historical snapshot rows readable throughout rollout.
- Do not delete or rewrite historical production rows in the first migration.
- Do not create Git commits unless the user explicitly requests them.

---

### Task 1: Compatible Ledger Schema and Receipt Types

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260720_lean_trade_transactions/migration.sql`
- Modify: `src/types/index.ts`
- Test: `src/types/tradeReceipt.test.ts`

**Interfaces:**
- Produces: `TradeReceipt`, `ResetReceipt`, and `AccountState`.
- Produces nullable `Transaction.requestedQuantity`, `Transaction.requestFingerprint`, `commandSnapshot`, and `resultSnapshot`.

- [ ] **Step 1: Write failing receipt shape tests**

Assert that a `TradeReceipt` contains ledger ID, request identity, execution values, before/after cash and position values, market date, and creation time; assert that `AccountState` has no `assets` field.

- [ ] **Step 2: Run the focused test**

Run: `pnpm test -- src/types/tradeReceipt.test.ts`

Expected: FAIL because the new exported types do not exist.

- [ ] **Step 3: Add types and compatible migration**

Add:

```ts
export interface TradeReceipt {
  id: string;
  idempotencyKey: string;
  side: "BUY" | "SELL";
  assetId: string;
  requestedQuantity: string;
  quantity: string;
  usdUnitPrice: string;
  usdAmount: string;
  cashBefore: string;
  cashAfter: string;
  quantityBefore: string;
  quantityAfter: string;
  costBasisBefore: string;
  costBasisAfter: string;
  marketDate: string;
  createdAt: string;
}
```

Define `ResetReceipt` with `id`, `idempotencyKey`, `cashBefore`, `cashAfter`, and `createdAt`. Define `AccountState` as the existing private account fields without `assets` and `marketAsOf`.

The SQL migration must make both JSON columns nullable, add nullable text columns `requestedQuantity` and `requestFingerprint`, and create:

```sql
CREATE INDEX "Transaction_walletAddress_id_idx"
ON "Transaction"("walletAddress", "id");
```

- [ ] **Step 4: Validate schema and focused tests**

Run: `pnpm exec prisma validate && pnpm exec prisma generate && pnpm test -- src/types/tradeReceipt.test.ts`

Expected: schema valid and test PASS.

### Task 2: Compact Idempotent Trade Receipts

**Files:**
- Create: `src/server/tradeReceipt.ts`
- Create: `src/server/tradeReceipt.test.ts`
- Modify: `src/server/trades.ts`
- Modify: `src/server/trades.test.ts`
- Modify: `app/api/trades/route.test.ts`

**Interfaces:**
- Consumes: `TradeReceipt`.
- Produces: `tradeFingerprint(command: TradeCommand): string`.
- Produces: `tradeReceipt(row): TradeReceipt`.
- Changes: `executeTrade(walletAddress, command): Promise<TradeReceipt>`.

- [ ] **Step 1: Write failing serializer and transaction tests**

Cover exact decimal-string serialization, SHA-256 canonicalization of `TRADE|assetId|side|quantity`, same-key replay, mismatched-key rejection, legacy command-snapshot replay, and absence of calls to `getAccountProjectionInTransaction`.

- [ ] **Step 2: Verify RED**

Run: `pnpm test -- src/server/tradeReceipt.test.ts src/server/trades.test.ts app/api/trades/route.test.ts`

Expected: FAIL because receipts are missing and `executeTrade` still returns `AccountProjection`.

- [ ] **Step 3: Implement the receipt serializer**

Serialize exclusively from immutable `Transaction` ledger fields. Validate required BUY/SELL values and throw `INVALID_TRADE_RECEIPT` for malformed legacy data.

- [ ] **Step 4: Slim the transaction**

Remove the account-projection query and `transaction.update({ resultSnapshot })`. On create, write:

```ts
{
  requestedQuantity: command.quantity,
  requestFingerprint: tradeFingerprint(command),
  commandSnapshot: null,
  resultSnapshot: null,
}
```

Return the receipt created from the inserted row. Keep `Serializable`, three bounded `P2034` attempts, unique-key replay, precision checks, and sparse position behavior.

- [ ] **Step 5: Verify GREEN**

Run: `pnpm test -- src/server/tradeReceipt.test.ts src/server/trades.test.ts app/api/trades/route.test.ts`

Expected: all PASS and no full-projection mock is needed.

### Task 3: Lean Reset Receipt

**Files:**
- Create: `src/server/resetReceipt.ts`
- Create: `src/server/resetReceipt.test.ts`
- Modify: `src/server/reset.ts`
- Modify: `src/server/reset.test.ts`
- Modify: `app/api/game/reset/route.test.ts`

**Interfaces:**
- Consumes: `ResetReceipt`.
- Changes: `resetAccount(walletAddress, idempotencyKey): Promise<ResetReceipt>`.

- [ ] **Step 1: Write failing reset tests**

Require reset to read only the player and sparse positions, delete positions, restore starting cash, insert one ledger row, return a receipt, replay safely, and never call account or market projection code.

- [ ] **Step 2: Verify RED**

Run: `pnpm test -- src/server/resetReceipt.test.ts src/server/reset.test.ts app/api/game/reset/route.test.ts`

Expected: FAIL because reset still persists a full projection.

- [ ] **Step 3: Implement compact reset**

Use canonical fingerprint `RESET`, preserve legacy command-snapshot validation, set `resultSnapshot: null`, remove `getAccountProjectionInTransaction`, and return the inserted/reset ledger receipt.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm test -- src/server/resetReceipt.test.ts src/server/reset.test.ts app/api/game/reset/route.test.ts`

Expected: all PASS.

### Task 4: Split Private Account from Global Market

**Files:**
- Modify: `src/server/account.ts`
- Modify: `src/server/accountProjection.test.ts`
- Modify: `app/api/game/route.ts`
- Modify: `app/api/game/route.test.ts`
- Modify: `src/types/index.ts`

**Interfaces:**
- Produces: `getAccountState(walletAddress): Promise<AccountState>`.
- Preserves: `GET /api/market` as the sole full-catalogue projection.

- [ ] **Step 1: Write failing sparse account tests**

Require account reads to query one player with positions joined to each held asset quote plus 50 recent transactions. Assert no `asset.findMany` call and no `assets` response property.

- [ ] **Step 2: Verify RED**

Run: `pnpm test -- src/server/accountProjection.test.ts app/api/game/route.test.ts`

Expected: FAIL because the current account projection queries every enabled asset.

- [ ] **Step 3: Implement `getAccountState`**

Load only held-position quotes, reject missing/stale held-asset data as before, compute totals from sparse positions, and return `AccountState`. Avoid a callback-style interactive transaction for this display read.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm test -- src/server/accountProjection.test.ts app/api/game/route.test.ts`

Expected: all PASS and no global catalogue query occurs.

### Task 5: Apply Receipts in Client State

**Files:**
- Modify: `src/client/gameApi.ts`
- Create: `src/state/applyReceipt.ts`
- Create: `src/state/applyReceipt.test.ts`
- Modify: `src/state/GameProvider.tsx`
- Modify: `src/state/GameProvider.test.tsx`
- Modify: relevant component tests constructing `GameApi`

**Interfaces:**
- Changes: `submitTrade(command): Promise<TradeReceipt>`.
- Changes: `resetGame(idempotencyKey): Promise<ResetReceipt>`.
- Produces: `applyTradeReceipt(account, market, receipt): AccountState`.
- Produces: `applyResetReceipt(account, receipt): AccountState`.

- [ ] **Step 1: Write failing reducer tests**

Cover first buy, additional buy, partial sell, full-sell deletion, cash replacement, totals recomputation using `MarketProjection`, recent-activity prepend, and reset clearing.

- [ ] **Step 2: Verify RED**

Run: `pnpm test -- src/state/applyReceipt.test.ts src/state/GameProvider.test.tsx`

Expected: FAIL because the client expects full account responses.

- [ ] **Step 3: Implement receipt parsing and pure reducers**

Reject malformed receipts at the API boundary. Reducers must update only the changed position and account summary; they must not mutate the market catalogue.

- [ ] **Step 4: Wire provider fallback**

On a valid receipt, update local account state without calling `GET /api/game`. If local receipt application fails validation, perform one reconciliation read while retaining the fact that the mutation committed.

- [ ] **Step 5: Verify GREEN**

Run: `pnpm test -- src/state/applyReceipt.test.ts src/state/GameProvider.test.tsx src/components/ProductCard.test.tsx src/components/PortfolioPanel.test.tsx`

Expected: all PASS.

### Task 6: Integration, Performance Guards, and Deployment Notes

**Files:**
- Modify: `tests/integration/game-flow.test.ts`
- Modify: `docs/superpowers/specs/2026-07-20-lean-trade-transactions-design.md` only if implementation reveals an approved clarification

**Interfaces:**
- Verifies all prior tasks together.

- [ ] **Step 1: Add failing integration assertions**

Assert one ledger row per idempotency key, null snapshots for new mutations, sparse positions, exact receipts, legacy replay, no catalogue query during mutation, and successful lost-response retry.

- [ ] **Step 2: Run integration test**

Run: `pnpm test:integration`

Expected before final fixes: at least one new assertion FAIL; after implementation: PASS.

- [ ] **Step 3: Run full verification**

Run:

```bash
pnpm test
pnpm typecheck
pnpm build
```

Expected: all exit 0 with no new warnings.

- [ ] **Step 4: Inspect the final diff**

Run: `git diff --check && git status --short`

Expected: no whitespace errors; only planned schema, server, client, test, migration, and documentation files changed.

- [ ] **Step 5: Record deployment order**

Apply the compatible migration first, deploy application code second, verify one production trade and idempotent replay, then monitor transaction duration and `INTERNAL_ERROR` counts. Do not run historical snapshot cleanup in this release.
