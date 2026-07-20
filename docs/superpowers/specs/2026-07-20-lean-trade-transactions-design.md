# Lean Trade Transactions and Split Read Models Design

**Date:** 2026-07-20

## Objective

Eliminate production trade timeouts and repeated full-catalogue work by making account mutations touch only the rows required for that mutation. Keep the global market catalogue separate from private player state, retain sparse positions, and return compact idempotent receipts from mutation endpoints.

This design replaces the current pattern in which every trade and reset queries the full 160-asset catalogue, reads recent history, builds an entire account projection inside a serializable transaction, and stores that projection in `Transaction.resultSnapshot`.

## Design Principles

- `Asset`, `AssetQuote`, and `AssetDailyPrice` are global market data shared by every player.
- `Position` remains sparse: a row exists only while a player owns a non-zero quantity of an asset.
- A mutation transaction reads and writes only the player, the target asset and quote, the target position, and the new transaction ledger row.
- Market catalogue reads never run inside account mutation transactions.
- Mutation responses are compact receipts, not complete account projections.
- Idempotent retries return the original receipt without executing the mutation again.
- The browser maintains its existing market projection and applies the returned account delta immediately.
- Full account reads are reconciliation operations, not a mandatory second half of every mutation.

## Data Ownership

### Global Market Data

The following tables remain shared and are never duplicated per user:

- `Asset`: identity, labels, category, unit, enabled state, and display order.
- `AssetQuote`: one latest authoritative quote per asset.
- `AssetDailyPrice`: append-only daily market history.

`GET /api/market` remains the source of the complete public market projection. It may use HTTP cache revalidation appropriate to the quote refresh schedule because it contains no player data.

### Private Player Data

- `Player` stores wallet identity, wallet name, cash, login time, and timestamps.
- `Position` stores only non-zero holdings.
- `Transaction` stores immutable trade or reset facts and idempotency metadata.

`GET /api/game` becomes a private account-state endpoint. It returns cash, sparse positions, computed account totals, recent transactions, reset state, and timestamps. It no longer returns the full asset catalogue.

For position valuation, the account query joins quotes only for assets present in the player's sparse positions. It does not scan all 160 assets.

## Transaction Ledger Changes

`Transaction` remains the durable ledger and source for exact mutation receipts. Existing monetary and before/after columns are sufficient for most receipt fields.

Add nullable migration-compatible fields:

- `requestedQuantity`: the exact normalized request value, including `MAX`.
- `requestFingerprint`: SHA-256 of the canonical mutation identity.

For a trade, the canonical identity is:

```text
TRADE|<assetId>|<side>|<requestedQuantity>
```

For a reset, the canonical identity is:

```text
RESET
```

The existing unique constraint on `(walletAddress, idempotencyKey)` remains the authoritative duplicate-execution guard.

`commandSnapshot` and `resultSnapshot` become nullable for backward compatibility. New trades do not write either JSON field. Existing rows remain readable during rollout. New resets may retain a compact reset-audit payload in `commandSnapshot` during the compatibility phase, but they must not write a full account projection to `resultSnapshot`.

After the new code has been stable and legacy replay has been verified, a separate cleanup migration may null historical full response snapshots and later remove the obsolete JSON columns. Historical cleanup is intentionally not part of the first production migration.

Add an index on `(walletAddress, id)` to match cursor history queries ordered by transaction ID. Keep `(walletAddress, createdAt)` only if another measured query still uses it.

The legacy `TradeLog` table receives no writes. Its removal is a separate cleanup after confirming no reporting or migration process consumes it.

## Trade Receipt Contract

`POST /api/trades` returns a `TradeReceipt`:

```ts
interface TradeReceipt {
  id: string;
  idempotencyKey: string;
  side: "BUY" | "SELL";
  assetId: string;
  requestedQuantity: string | "MAX";
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

Decimal and bigint values remain JSON strings. A replay returns the same receipt fields from the immutable ledger row. The contract does not expose whether the response came from first execution or replay because that distinction does not change client behavior.

`POST /api/game/reset` similarly returns a compact `ResetReceipt` containing transaction ID, idempotency key, cash before and after, reset timestamp, and the empty resulting positions state.

## Lean Trade Transaction

The serializable transaction performs only mutation-critical work:

1. Look up `(walletAddress, idempotencyKey)`.
2. If found, compare the canonical request fingerprint and return the stored receipt; reject a mismatched request.
3. Verify the settlement window.
4. Read the player.
5. Read the requested asset and its current quote.
6. Read only the player's position for the requested asset.
7. Validate quote freshness, quantity, cash, holdings, and decimal bounds.
8. Compute all before/after values.
9. Update the one `Position` row, create it for a first buy, or delete it after a full sell.
10. Update `Player.cash`.
11. Insert one immutable `Transaction` row with receipt fields and idempotency metadata.
12. Commit and return the receipt.

The transaction does not:

- query all assets;
- query unrelated positions;
- query the latest 50 transactions;
- calculate the complete account projection;
- write `resultSnapshot`;
- call external APIs.

`Serializable` isolation and bounded `P2034` retries remain because two concurrent trades must not spend the same cash or sell the same holding. A modest explicit timeout may remain as defense in depth, but performance must come from reducing transaction work rather than increasing the timeout.

## Idempotency and Concurrent Requests

The client creates one idempotency key per user intent and reuses it when retrying an ambiguous network failure.

- Same wallet, same key, same fingerprint: return the existing receipt.
- Same wallet, same key, different fingerprint: return `422 IDEMPOTENCY_KEY_REUSED`.
- Concurrent inserts with the same key: the unique constraint permits one commit; the loser reads and returns the committed receipt.
- Serializable write conflict: retry the complete transaction up to three times.
- Exhausted conflict retries: return `409 TRADE_CONFLICT`.

Legacy rows without `requestFingerprint` use `commandSnapshot` to compare the original request and reconstruct a compact receipt from ledger columns. Malformed legacy JSON produces the existing explicit snapshot error rather than re-executing a mutation.

## Split Read Models

### `GET /api/market`

Returns the global `MarketProjection`:

- all visible assets;
- latest quote and quote status;
- display metadata;
- aggregate `marketAsOf`.

This endpoint is public, contains no wallet information, and is independently cacheable.

### `GET /api/game`

Returns a private `AccountState`:

```ts
interface AccountState {
  walletAddress: string;
  walletName: string | null;
  cash: string;
  holdingsValue: string;
  netWorth: string;
  pnl: string;
  positions: PositionView[];
  recentTransactions: TransactionView[];
  settlementLocked: boolean;
  resetEnabled: boolean;
  updatedAt: string;
}
```

`AccountState` deliberately has no `assets` or `marketAsOf`. The UI combines it with `MarketProjection`, which it already loads for guest and authenticated views.

The account query reads:

- one player;
- that player's sparse positions joined to their assets' latest quotes;
- up to 50 recent transactions.

It does not need an interactive transaction for ordinary display. If a consistent read is required, use a short database batch transaction rather than a callback that performs application work while holding an interactive transaction open.

## Client Mutation Flow

1. The client already holds `MarketProjection` and `AccountState`.
2. It submits a trade command with a new idempotency key.
3. On receipt, it replaces `cash` with `cashAfter`.
4. It updates, inserts, or removes only the receipt's `assetId` position.
5. It recalculates account totals from sparse positions and the locally held authoritative market projection.
6. It prepends the receipt to recent activity.
7. It keeps the market catalogue unchanged.

The client does not automatically call `GET /api/game` after every successful mutation. It reconciles on page load, authentication restoration, explicit refresh, or an ambiguous failure where the outcome must be recovered by retrying the same idempotency key.

If applying a receipt locally fails validation, the client performs one account reconciliation request and reports the mutation as committed rather than incorrectly showing it as failed.

## Reset Flow

Reset uses the same lean boundary:

1. Check the feature flag and idempotency key.
2. Read the player and only that player's sparse positions.
3. Delete those positions.
4. Restore starting cash.
5. Insert one `RESET` ledger row.
6. Commit and return `ResetReceipt`.

It does not query the market catalogue or build and persist a full account projection. The client applies the known reset result directly: starting cash, no positions, zero holdings value, starting net worth, and a prepended reset activity row.

## Error Handling

- Validation, stale quotes, insufficient cash, insufficient holdings, and settlement lock fail before writes.
- Any database error inside the transaction rolls back all account changes.
- A committed mutation remains successful even if later client reconciliation fails.
- API errors preserve the existing structured `{ error: { code, message } }` contract.
- Unexpected database errors are logged server-side with request context but do not expose credentials, SQL, or internal stack traces to the browser.
- The UI distinguishes a rejected trade from a committed trade whose display reconciliation is pending.

## Migration and Rollout

### Phase 1: Compatible Schema

1. Make `commandSnapshot` and `resultSnapshot` nullable.
2. Add nullable `requestedQuantity` and `requestFingerprint`.
3. Add `(walletAddress, id)` history index.
4. Generate the Prisma client and deploy schema changes before code that relies on them.

This migration does not delete or rewrite historical rows.

### Phase 2: Lean Server and Client

1. Introduce receipt serializers and legacy replay compatibility.
2. Replace trade and reset full-projection responses with compact receipts.
3. Remove full account projection work from mutation transactions.
4. Split authenticated account state from the global market projection.
5. Update client state to apply receipts locally.

### Phase 3: Observe

Measure:

- transaction duration;
- total `/api/trades` duration;
- database queries per trade;
- `INTERNAL_ERROR` count;
- `P2034` retry count;
- average transaction row size;
- receipt reconciliation fallback count.

Success requires no closed-transaction timeout errors and no duplicate executions.

### Phase 4: Optional Cleanup

After compatibility is no longer needed:

- null or archive historical full `resultSnapshot` values;
- drop obsolete JSON columns in a later migration;
- remove `TradeLog` after confirming it has no consumers;
- remove redundant indexes only after examining production query plans.

## Testing Strategy

### Unit Tests

- Receipt serialization preserves exact decimal strings and bigint IDs.
- BUY, SELL, BUY MAX, partial sell, and full sell update only the target position.
- Full sell deletes the zero position.
- New transactions do not write full snapshots.
- Exact idempotent replay returns the same receipt without account writes.
- Reusing a key with a different command fails.
- Legacy snapshot rows replay without a second mutation.
- Receipt application updates only cash, the changed position, totals, and recent activity.
- Reset applies starting cash and clears positions without market reads.

### Transaction Tests

- All player, position, and ledger writes commit together.
- A forced failure after a player update rolls back the cash change.
- Concurrent buys cannot overspend.
- Concurrent sells cannot produce a negative position.
- Concurrent duplicate idempotency keys produce one ledger row.
- Bounded serializable retries still work.
- Mutation transactions never call the full market or account projection functions.

### API and Integration Tests

- `POST /api/trades` returns `TradeReceipt`, not `AccountProjection`.
- `POST /api/game/reset` returns `ResetReceipt`.
- `GET /api/game` excludes the asset catalogue.
- `GET /api/market` remains the sole complete market-catalogue response.
- A full authenticated flow loads market once, trades, updates UI from the receipt, and does not issue a second full-market query.
- Retrying after a simulated lost response returns the original receipt and creates no duplicate trade.
- Existing production-style legacy transactions remain readable.

### Performance Acceptance

- A trade performs no full-catalogue query.
- A trade writes no full account JSON snapshot.
- The number of database operations is independent of the 160-asset catalogue size.
- A user with one held asset reads and modifies only that position during a trade.
- Production transaction duration remains comfortably below the Prisma interactive transaction timeout under normal database latency.

## Out of Scope

- Changing quote providers or the daily refresh schedule.
- Precomputing the leaderboard.
- Deleting historical snapshots during the first rollout.
- Replacing PostgreSQL or Prisma.
- Adding a message queue or separate backend service.

## Acceptance Criteria

The redesign is complete when:

- production trades no longer fail with closed or expired Prisma transaction IDs;
- trade and reset transactions contain no complete account projection query;
- new transaction rows contain no full market or account response snapshot;
- positions remain sparse and zero holdings are deleted;
- the market catalogue is loaded through the shared market endpoint rather than copied into private mutation responses;
- repeated requests with the same idempotency key remain safe and deterministic;
- the UI updates immediately from compact receipts and reconciles safely when required;
- focused, integration, typecheck, and production build verification pass.
