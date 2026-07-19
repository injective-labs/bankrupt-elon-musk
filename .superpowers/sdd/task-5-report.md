# Task 5 Report: Account Projection and Authoritative Leaderboard

## RED evidence

- `pnpm test -- src/server/accountProjection.test.ts src/server/leaderboard.test.ts`
  - Failed because `getAccountProjection` was absent and `src/server/leaderboard.ts` did not exist.
- `pnpm exec vitest run src/server/leaderboard.test.ts`
  - The stale-quote safety test resolved a ranking instead of rejecting it, proving the freshness guard was missing.

## GREEN evidence

- Added exact Decimal-string projection tests for cash, holdings value, net worth, P&L, positions, missing quotes, and quotes older than seven days.
- Added server-ranking tests proving legacy `Player.pnl` fixture values are ignored, current `AssetQuote` values determine order, public addresses are masked, caller rank is exact outside the top limit, and stale held-position quotes block publication.
- Added route tests proving `/api/game` uses only the authenticated cookie wallet and `/api/leaderboard` derives optional caller identity only from a verified cookie.
- Focused route/server suite: 53 tests passed, 2 skipped.

## Final verification

- `pnpm test -- src/server/accountProjection.test.ts src/server/leaderboard.test.ts`
  - 54 passed, 2 skipped; exit 0.
- `pnpm typecheck`
  - exit 0.
- `git diff --check`
  - exit 0.

## Concerns / decisions

- The leaderboard refuses to publish (503 `MARKET_DATA_UNAVAILABLE`) when any non-zero held position lacks a quote or its market date is older than seven days. This avoids silently treating an unpriced asset as zero.
- Ranking currently loads normalized players/positions/quotes and performs Decimal arithmetic in the Node process. This is exact and avoids unsafe numeric SQL coercion, but a future high-volume deployment may need a fixed, parameterized SQL/CTE implementation plus pagination.
- Existing UI formatting converts the caller's Decimal-string P&L to `number` only at the display boundary; no client-derived value feeds ranking or persistence.

## Review follow-up

### Additional RED evidence

- The new shared quote-freshness suite initially failed because no UTC calendar-date helper existed.
- Projection snapshot, disabled-held-asset, and invalid-held-quote tests failed against the original three independent reads and enabled-only catalogue query.
- SQL leaderboard tests failed against the original unbounded `player.findMany` implementation.
- The stale quote policy regression initially resolved a leaderboard instead of returning `MARKET_DATA_UNAVAILABLE`.

### Changes

- Added `isQuoteFresh`, using UTC calendar-day arithmetic: age 7 is valid, age 8 is stale, and future dates remain valid independent of wall-clock time and host timezone.
- Account projection now reads player/positions, the enabled-or-held asset set with quotes, and recent transactions inside one interactive Prisma transaction at `RepeatableRead` isolation.
- Disabled assets remain valued while held. Any non-zero holding with a missing, non-ACTIVE, or calendar-stale quote produces 503 rather than partial metrics.
- Replaced unbounded Node loading/sorting with two fixed Prisma tagged-SQL statements in a repeatable-read snapshot: a stale/invalid held-quote precheck and a Decimal-safe aggregate/window query returning only the top limit plus the caller. The SQL freshness boundary derives the calendar date explicitly in UTC rather than inheriting the database session timezone.
- Ranking uses PostgreSQL `RANK()` over P&L only, giving conventional competition ranks (`1, 1, 3`) for ties; `ROW_NUMBER()` is used separately only to bound and deterministically order the public top list.

### Final follow-up verification

- Focused: `pnpm exec vitest run src/server/quoteFreshness.test.ts src/server/accountProjection.test.ts src/server/leaderboard.test.ts` — 15 passed.
- Full: `pnpm test` — 64 passed, 2 skipped.
- `pnpm typecheck` — exit 0.
- `pnpm build` — production build completed, all routes generated, exit 0.
- `git diff --check` — exit 0.

### Remaining concerns

- SQL behavior is covered by strong tagged-query contract tests; database integration remains dependent on the repository's configured PostgreSQL test environment.
- The build emits existing Prisma-configuration deprecation and `baseline-browser-mapping` age warnings; neither affects build success.
