# Task 9 Report: Authoritative UI Projections

## Implemented

- Market cards now come from `AccountProjection.assets`; checked-in product metadata is used only for presentation accents, descriptions, and marks.
- Quote price, status, currency, and market date are rendered from server asset views. Missing, errored, stale, disabled, unauthenticated, settlement-locked, and pending states cannot trade.
- Quantity tickets submit async provider actions, label client calculations as estimates, retain visible API errors, and prevent duplicate submission.
- Buy-max and sell-all call the provider `MAX` actions without deriving authoritative quantities from client cash or holdings.
- Portfolio totals, positions, market values, and P/L render server decimal strings with no `Number` conversion for authoritative money displays.
- Leaderboard ranking is loaded from the API; failures render an explicit unavailable state and no simulated players.
- The activity ticker uses returned transactions instead of simulated server activity.
- Reset/session/auth states and API failures have bilingual copy.

## TDD Evidence

- RED: `pnpm test -- src/components/ProductCard.test.tsx src/components/PortfolioPanel.test.tsx` — 7 new tests failed against the legacy UI for the expected missing behaviors.
- GREEN: `pnpm exec vitest run src/components/ProductCard.test.tsx src/components/PortfolioPanel.test.tsx` — 7/7 passed.

## Verification

- `pnpm test -- src/components` — 24 files passed, 2 skipped; 163 tests passed, 5 skipped.
- `pnpm typecheck` — passed.
- `pnpm build` — passed, including static page generation (12/12).
- `git diff --check` — passed.

## Notes

- Build output includes existing informational warnings for deprecated `package.json#prisma` configuration and stale `baseline-browser-mapping` data; neither affects the successful build.
- Legacy engine remains present for Task 10, but authoritative totals, positions, quote eligibility, ranking, activity, and max commands no longer depend on its simulated fallbacks.
