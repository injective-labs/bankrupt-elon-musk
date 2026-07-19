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
