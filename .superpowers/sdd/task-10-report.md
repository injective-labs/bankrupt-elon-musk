# Task 10 Report: Remove Legacy Finance Mechanics

## Status

Complete. Browser-owned pricing/state paths and the legacy finance mutation model were removed while preserving the server-authoritative account, quote, trade, reset, and leaderboard flows.

## Changes

- Added `architecture/legacy-finance.guard.test.ts`, which scans active TypeScript, TSX, and CSS under `src` and `app` for the forbidden identifiers and browser persistence path.
- Deleted `FinancePanel`, the legacy mutation engine, browser pricing module, server `GameState` adapter, and chart proxy route. The old state route was already absent from the tracked tree and remains absent.
- Split retained pure display behavior into `src/game/productPresentation.ts` and quote-symbol derivation into `src/data/quoteSymbols.ts`.
- Reduced client `GameState` to UI preferences and removed obsolete finance actions, DTO fields, constants, copy, and styles.
- Removed the obsolete leaderboard finance-status field from its type, validator, service response, and test.

## TDD Evidence

- RED: `pnpm test architecture/legacy-finance.guard.test.ts` failed with 130 active-code matches.
- GREEN: the same guard passed after cleanup with zero matches.

## Verification

- `pnpm test`: 27 files passed, 2 skipped; 175 tests passed, 5 skipped.
- `pnpm typecheck`: passed.
- `pnpm build`: passed; generated route manifest contains only the server-authoritative API routes and excludes `/api/chart` and `/api/state`.
- `rg -n "leverage|debt|accruedInterest|liquidated|borrowMoney|repayMoney|settleOneDayInterest|accrueInterest|checkLiquidation|/api/state|localStorage" src app`: no matches.
- `git diff --check`: passed.

## Notes

The build emits existing advisory warnings for deprecated Prisma `package.json#prisma` configuration and stale `baseline-browser-mapping` data; neither affects verification.

## P2 Architecture Guard Follow-up

- Added a reusable active-source scanner covering `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.mts`, `.cts`, and `.css` recursively, without exclusions.
- Added a temporary-directory regression test proving forbidden content in both `.js` and `.mjs` files is detected without placing fixtures in the active application tree.
- TDD RED: the focused test failed because the scanner module did not yet exist.
- TDD GREEN: both the scanner regression and application architecture guard passed (2 tests).
