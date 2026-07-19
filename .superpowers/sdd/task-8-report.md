# Task 8 Report: Authenticated Server Client State

## Result

- Replaced wallet-address cloud persistence with same-origin cookie session APIs.
- Added exact server nonce-message signing and signature verification before loading `/api/game`.
- Replaced authoritative client financial state with `AccountProjection`; the remaining `GameState` value is a temporary render-only compatibility projection for Task 9 components.
- Added loading, locked, authenticated, and expired authentication states. A 401 action clears the account.
- Made trade/reset actions awaited, single-pending, and UUID-idempotent. Failed commands preserve the previous projection.
- Kept locale, sound, filters, sorting, and temporary leverage selection in memory only.
- Removed cloud sync, browser persistence, anonymous wallet support, and the obsolete state endpoint.

## TDD Evidence

Red run (before implementation):

```text
src/state/GameProvider.test.tsx: 5 failed
```

Green focused run:

```text
pnpm exec vitest run src/state/GameProvider.test.tsx
Test Files  1 passed (1)
Tests       5 passed (5)
```

Required test command:

```text
pnpm test -- src/state/GameProvider.test.tsx
Test Files  20 passed | 2 skipped (22)
Tests       141 passed | 5 skipped (146)
```

## Verification Evidence

```text
pnpm typecheck
exit 0

pnpm build
Compiled successfully; static generation completed; exit 0

rg -n "localStorage|/api/state|CloudSyncProvider|getOrCreateAnonWallet" src app
no matches

git diff --check
no errors
```

The build emits pre-existing Prisma configuration deprecation and stale `baseline-browser-mapping` advisory warnings; neither affects compilation.

## Compatibility Note

Legacy display components still consume a derived numeric `GameState` facade and retain non-server finance controls as inert compatibility methods. Detailed component migration to use decimal `AccountProjection` fields directly belongs to Task 9.
