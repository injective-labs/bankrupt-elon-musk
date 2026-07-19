# Task 11 Report

## Status

Complete.

## Implementation

- Consolidated disposable PostgreSQL coverage under `tests/integration/`.
- Added authenticated end-to-end coverage for migration state and the exact 160-asset seed, one-time wallet funding, cash preservation on repeat login, atomic trade commit, forced ledger-insert rollback, database-backed reload, reset ledger preservation/history, and server-computed leaderboard P&L.
- Added post-launch market persistence coverage proving that no historical rows are backfilled and that an older refresh cannot create an older daily row after rollout.
- Replaced `.env.example` values with safe variable names only.
- Updated deployment, read-only inspection, reset-disablement, and application-only rollback documentation.

## TDD Evidence

The first focused run against the isolated `injpass-task11-pg` PostgreSQL 16 container failed all six game-flow cases because the test referenced a non-seeded asset. After changing the fixture to the seeded `bitcoin-coin` asset, the remaining login test failed because the nonce route contract requires a JSON POST body. Correcting that route request made the focused integration run pass: 2 files, 8 tests.

## Verification

All commands used the isolated database at `localhost:55432`; no Supabase instance or real secret was used.

- `pnpm prisma validate` — passed.
- `pnpm prisma generate` — passed.
- `RUN_DATABASE_TESTS=1 pnpm test` — 29 files passed, 183 tests passed.
- `pnpm typecheck` — passed.
- `pnpm build` — passed.
- `git diff --check` — passed.

## Concerns

- Prisma reports that the `package.json#prisma` configuration will be removed in Prisma 7.
- Next build reports that `baseline-browser-mapping` data is more than two months old.
- Database integration tests remain opt-in through `RUN_DATABASE_TESTS=1` so the default suite does not require PostgreSQL; CI should provision a disposable database, migrate and seed it, and set that flag.
