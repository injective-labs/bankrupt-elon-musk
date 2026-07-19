# Task 11 Report

## Status

Complete.

## Implementation

- Consolidated disposable PostgreSQL coverage under `tests/integration/` and added `pnpm test:integration` as its safe entry point.
- The runner always creates a clean PostgreSQL 16 Docker container on a random localhost port, replaces any inherited database URL with its guarded integration-only URL, applies migrations, seeds twice, runs files serially, and removes the container.
- Added authenticated end-to-end coverage for migration state and the exact 160-asset seed, one-time wallet funding, cash preservation on repeat login, atomic trade commit, forced ledger-insert rollback, database-backed reload, reset ledger preservation/history, and server-computed leaderboard P&L.
- Added clean-seed coverage proving 160 assets and zero daily rows after two seed runs, plus post-launch persistence coverage proving strict older-row rejection and same-date stale-run protection.
- Restored concurrency regressions for simultaneous overspend, same-key replay with one debit/ledger, and stable replay plus command-mismatch rejection after a later trade.
- Replaced `.env.example` values with safe variable names only.
- Updated deployment, read-only inspection, reset-disablement, and application-only rollback documentation.

## TDD Evidence

The initial Task 11 cycle exposed fixture errors before reaching green. The findings follow-up then reproduced the missing runner with `pnpm test:integration`, which failed because the command did not exist. After adding the guarded runner/config and restored cases, a fresh runner invocation passed migrations, two seeds, and 12 serial integration tests.

## Verification

All commands used the isolated database at `localhost:55432`; no Supabase instance or real secret was used.

- `pnpm prisma validate` — passed.
- `pnpm prisma generate` — passed.
- `pnpm test:integration` — 2 files passed, 12 tests passed against a fresh disposable container.
- `pnpm test` — 27 files passed and 2 database files skipped as designed; 175 tests passed and 12 skipped.
- `pnpm typecheck` — passed.
- `pnpm build` — passed.
- `git diff --check` — passed.

## Concerns

- Prisma reports that the `package.json#prisma` configuration will be removed in Prisma 7.
- Next build reports that `baseline-browser-mapping` data is more than two months old.
- Docker must be available to run `pnpm test:integration`; the default test suite remains database-independent.
