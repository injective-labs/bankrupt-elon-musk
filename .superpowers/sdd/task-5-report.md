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
