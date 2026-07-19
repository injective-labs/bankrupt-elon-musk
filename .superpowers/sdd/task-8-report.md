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

## Review Follow-up

- Added a request epoch invalidated by login, logout, 401 expiry, and unmount. Restore, login load, refresh, and action responses now mutate state only while their epoch remains current.
- Added a synchronous request-token mutex so same-tick duplicate commands issue one request and only the owning request clears the exposed pending state.
- Preserved exact quantity strings and send `"MAX"` for buy-max/sell-all without client-side financial arithmetic.
- Made restored cookie-session identity and logout available even when no live connector wallet exists; connector disconnect follows successful server logout when applicable.
- Added direct fetch-contract coverage for byte-exact nonce signing, signature hex serialization, same-origin cookie credentials, both API error body shapes, and malformed successful session/account responses.

Follow-up verification:

```text
Focused tests: 3 files passed, 15 tests passed
Full tests: 22 files passed, 2 skipped; 151 tests passed, 5 skipped
pnpm typecheck: exit 0
pnpm build: exit 0
forbidden persistence rg: no matches
git diff --check: no errors
```

### Final auth-transition hardening

- Login and logout now share one synchronous auth-transition lock. A competing transition rejects with `AUTH_TRANSITION_PENDING` before making any cookie-mutating request, and the lock becomes reusable after settlement.
- Logout retains the authenticated account until the server confirms success. Failure preserves the account/session UI, records a retryable error, and prevents connector disconnection.
- Response validation now covers logout (including valid 204), transaction history, and leaderboard payloads, with exact decimal-string checks and nullable wallet names.
- Added deferred login/logout overlap tests in both directions, logout retry-state coverage, connector-retention coverage, and response-contract validation.

Final verification: 20/20 focused tests; 156 passed and 5 skipped in the full suite; typecheck/build exited 0; forbidden persistence scan and `git diff --check` were clean.
