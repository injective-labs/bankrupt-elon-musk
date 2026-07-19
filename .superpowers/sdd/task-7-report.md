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
