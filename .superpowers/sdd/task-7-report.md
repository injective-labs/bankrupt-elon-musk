# Task 7 Report: Authenticated Test Account Reset

## Status

Implemented an environment-gated, authenticated, serializable, and idempotent account reset. It removes all positions, restores cash to USD 50 billion, preserves prior ledger history, appends one immutable `RESET` ledger row using the existing transaction snapshot columns, and returns the stable committed projection.

## TDD evidence

- RED: `pnpm test -- src/server/reset.test.ts` failed because `src/server/reset.ts` did not exist.
- RED: `pnpm vitest run app/api/game/reset/route.test.ts` failed because the authenticated route did not exist.
- RED follow-up: malformed persisted reset result JSON containing `cash: "NaN"` replayed successfully before snapshot validation was hardened.
- GREEN: focused service and route suite passes 10/10 tests.

## Behavior and design

- `ENABLE_GAME_RESET` must equal the exact server-side string `true`; otherwise reset fails with 403 before a database transaction or write.
- The route authenticates first and passes only the session wallet plus a validated UUID idempotency key. Client-provided wallet, cash, and positions are ignored.
- Reset runs at `Serializable` isolation with at most three retries for Prisma `P2034` conflicts.
- The `(walletAddress, idempotencyKey)` ledger uniqueness constraint provides idempotency. Exact-key `P2002` races replay the stored projection; unrelated unique violations are not swallowed.
- The RESET ledger row stores cash before/after, aggregate position quantity before/after, and aggregate cost basis before/after in the current `Transaction` columns. `usdAmount` is zero because reset is not a purchase or sale.
- Existing transactions are never deleted. The ledger row is inserted before creating the result projection, and that projection is persisted for stable replay.
- Persisted command/result JSON is validated before replay and fails closed with `INVALID_RESET_SNAPSHOT` when malformed.

## Verification

- `pnpm vitest run src/server/reset.test.ts app/api/game/reset/route.test.ts`: 10 passed.
- `pnpm typecheck`: exit 0.
- `git diff --check`: exit 0.

## Concern

- Because the existing ledger schema has scalar position snapshot columns, a whole-account reset records aggregate quantity and aggregate cost basis rather than a per-asset breakdown. The full before-state is not accepted from the client, and historical BUY/SELL rows remain available for audit reconstruction.

## Review follow-up: lossless audit and semantic replay validation

### RED evidence

- The near-limit multi-position test failed because the implementation summed all position quantities and cost bases into scalar Decimal columns, producing values beyond their database precision and losing per-asset identity.
- The versioned audit replay initially failed because only the old `{ type: "RESET" }` command shape was accepted.
- Semantic replay cases for a wrong wallet, non-starting cash, residual positions, and inconsistent holdings/net-worth/P&L demonstrated the need to bind validation to the requested account and canonical reset state.
- A malformed included RESET transaction demonstrated that replay also needs reset-row semantics, including a null asset and canonical `cashAfter`.

### Changes

- RESET now writes zero to `quantityBefore`, `quantityAfter`, `costBasisBefore`, and `costBasisAfter`, explicitly marking the scalar position columns as not applicable.
- `commandSnapshot` is versioned as `{ kind: "RESET", version: 1, idempotencyKey, positionsBefore }`. Every pre-reset position records `assetId`, fixed-notation exact quantity, and fixed-notation exact cost basis. Positions are read in stable asset order.
- Replay validates the complete audit shape while command identity remains RESET plus the idempotency key; it does not compare live positions after reset.
- Result replay now requires the requested wallet, cash and net worth of USD 50 billion, zero holdings and P&L, and no positions. Any included RESET row must have a null asset and canonical `cashAfter`.
- Reset result snapshots enrich RESET rows with canonical `cashAfter` only inside the stable stored JSON, avoiding a broad public trade-history type/API change.

### Fresh verification

- Focused reset service/route suite: 16/16 passed.
- Full suite: 122 passed, 5 opt-in tests skipped.
- `pnpm typecheck`: exit 0.
- `pnpm build`: production build completed and generated `/api/game/reset`; exit 0.
- `git diff --check`: exit 0.

The earlier aggregate-scalar concern was superseded by the final follow-up below; `positionsBefore` remains the lossless per-asset audit record.

## Final review follow-up: nullable fields and bounded audit parsing

### RED evidence

- The ledger assertion failed because RESET still wrote Decimal zero into asset-specific quantity and cost-basis columns instead of SQL null.
- Boundary cases showed that negative values, precision/scale overflow, empty or oversized asset IDs, duplicate/out-of-order assets, and audits larger than the 160-item catalogue limit were accepted.
- A valid BUY command found under the same wallet/idempotency key returned the internal malformed-reset error instead of the public key-reuse error.

### Changes

- RESET now writes null for all four asset-specific quantity/cost-basis before/after fields.
- `positionsBefore` parsing fails closed above 160 items. Asset IDs must be nonempty, at most 128 characters, unique, and strictly ascending.
- Quantity and cost-basis strings must be canonical fixed decimal notation, nonnegative, and fit their exact `Decimal(30,12)` and `Decimal(30,8)` integer/scale bounds. Exponents, NaN, signs, leading zeros, redundant trailing fractional zeros, overflows, and excessive scales are rejected.
- Generated audits are explicitly sorted by asset ID and serialized with canonical fixed notation before the same validator accepts them.
- Replay classifies structurally valid BUY/SELL commands and other non-RESET command kinds as 422 `IDEMPOTENCY_KEY_REUSED` before RESET parsing. A differing idempotency identity also returns 422; malformed snapshots that claim to be RESET continue to fail closed with 500 `INVALID_RESET_SNAPSHOT`. The same behavior applies after an exact-key P2002 race.

### Fresh final verification

- Focused reset service/route suite: 32/32 passed.
- Full suite: 138 passed, 5 opt-in tests skipped.
- `pnpm typecheck`: exit 0.
- `pnpm build`: production build completed successfully, including `/api/game/reset`.
- `git diff --check`: exit 0.
