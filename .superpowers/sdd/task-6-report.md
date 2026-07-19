# Task 6 Report: Atomic Buy, Sell, MAX, and Trade History

## Status

Implemented authenticated authoritative trading, exact Decimal accounting, serializable conflict retry, idempotency, server-side MAX semantics, account projection responses, and cursor-paginated history.

## TDD evidence

### RED: trade service absent

`pnpm test -- src/server/trades.test.ts` exited 1 with `Cannot find module '/src/server/trades'`. No trade production module existed. The tests already covered buy/cost accumulation, partial/full sell, insufficient balances, integer validation, asset/quote/freshness/settlement validation, MAX, idempotency, Serializable retry, and pagination.

### GREEN: trade domain

The same command exited 0 with the repository suite green (`77 passed`, two skipped at that checkpoint).

### RED/GREEN: authenticated route

`pnpm vitest run app/api/trades/route.test.ts` first exited 1 with `Cannot find module '/app/api/trades/route'`. After implementation, the focused route/trade/leaderboard run passed 26/26 tests.

### Adjacent review minor

A failing parameterized leaderboard test proved exported limits accepted `NaN`, infinity, zero, negatives, and fractions as invalid SQL limits. `getLossLeaderboard` now exports a finite integer in `[1, 100]`, defaulting invalid input to one.

## PostgreSQL concurrency evidence

With the repository's healthy local PostgreSQL 16 container:

`DATABASE_URL=postgresql://postgres:postgres@localhost:5433/bankrupt_elon RUN_DATABASE_TESTS=1 pnpm vitest run src/server/trades.integration.test.ts`

Exit 0, 1/1 passed. Two simultaneous buys each costing 60 against cash 100 produced exactly one fulfilled trade and persisted cash exactly 40, never negative. The opt-in test owns and cleans its dedicated Player/Asset fixtures.

## Final verification

`git diff --check && pnpm test && pnpm typecheck` exited 0:

- 18 test files passed, 2 opt-in files skipped by default.
- 85 tests passed, 3 skipped.
- `tsc --noEmit` passed.
- `git diff --check` was clean.

## Design notes and concerns

- Every mutation and the idempotency lookup/ledger insert occur inside a Prisma interactive transaction at Serializable isolation. PostgreSQL `P2034` conflicts retry at most three attempts, then map to HTTP 409.
- `(walletAddress, idempotencyKey)` remains database-enforced by the existing unique constraint. A replay skips all mutation and returns the current authoritative account projection.
- BUY MAX uses `floor(cash / usdPrice)` and SELL MAX uses the entire current position. Explicit quantities accept positive integer strings only.
- Partial sells retain total average-cost basis proportionally; full sells delete the Position row.
- The response projection is read immediately after commit, so it is authoritative but may include a later concurrent committed trade; the ledger mutation itself remains atomic and idempotent.
- API errors continue to sanitize `ApiError.details`; Task 6 does not reintroduce the previously closed information-disclosure issue.

## Review follow-up: stable idempotency and storage boundaries

### RED evidence

The follow-up focused suite first failed 12 tests. It demonstrated that future quotes were accepted, replay recomputed the live projection, command mismatches were not rejected, exact idempotency-key `P2002` races were unhandled, oversized quantities reached balance logic, and signed-int64 cursor overflow/`+1` were accepted. A second RED checkpoint showed malformed stored command JSON returned the user-facing key-reuse error instead of the internal snapshot-integrity error.

### Changes

- Added required JSONB `commandSnapshot` and `resultSnapshot` fields to `Transaction` in both `schema.prisma` and the existing not-yet-applied table-creation migration.
- The serializable transaction now creates the ledger row, builds the complete account projection using the same transaction client, stores that projection, and returns it. Replays validate and return the persisted result without querying current account state.
- Reusing a key with any different asset, side, quantity, or key snapshot returns 422 `IDEMPOTENCY_KEY_REUSED`. Malformed command/result JSON fails closed with 500 `INVALID_TRADE_SNAPSHOT`.
- Only a `P2002` whose Prisma target is exactly the Transaction wallet/idempotency unique key is replayed; unrelated unique violations propagate unchanged. `P2034` retains the bounded three-attempt serializable retry.
- Explicit and MAX quantities are checked against `Decimal(30,12)` bounds. All calculated persisted money values are checked against `Decimal(30,8)` range and scale, returning 422 `VALUE_OUT_OF_RANGE` before commit.
- History cursors now require unsigned decimal syntax representing a positive PostgreSQL signed `BIGINT` (`1..9223372036854775807`).
- Shared quote freshness now rejects future UTC market dates as well as dates older than seven UTC calendar days.

### PostgreSQL evidence

The already-migrated local PostgreSQL verification database received nullable test-only copies of the two JSONB columns so it matched the updated client; the checked-in migration itself creates both as required `NOT NULL` columns on the new Transaction table.

`DATABASE_URL=postgresql://postgres:postgres@localhost:5433/bankrupt_elon RUN_DATABASE_TESTS=1 pnpm vitest run src/server/trades.integration.test.ts --reporter=verbose` passed 3/3:

- competing different-key overspending buys commit at most one;
- truly concurrent same-key buys both return the identical snapshot, create one ledger row, and debit cash once;
- replay remains byte-for-byte structurally equal after a later trade, while a changed command with the same key is rejected.

### Fresh final verification

- `pnpm prisma validate`: schema valid.
- `pnpm prisma generate`: Prisma Client generated successfully.
- Focused trade/quote/account/route suite: 39/39 passed.
- `git diff --check && pnpm test && pnpm typecheck && pnpm build`: exit 0; 98 tests passed, 5 opt-in tests skipped by default; production build generated all routes including `/api/trades`.
- Fresh PostgreSQL trade suite after the build: 3/3 passed.

The build emitted only the existing Prisma 7 configuration deprecation and stale `baseline-browser-mapping` metadata notices.
