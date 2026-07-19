# Task 3 Report: Signed INJ Pass Authentication and One-Time Funding

## Scope

Implemented the Task 3 authentication boundary without changing downstream game UI or game APIs:

- Atomic player login/bootstrap with starting cash only on the `create` branch.
- Signed JWT stored only in the `musk_session` HttpOnly cookie.
- Cookie authentication helper for future private APIs.
- Session inspection and unconditional logout routes.
- Typed API errors with sanitized fallback responses.
- Production/runtime JWT secret enforcement outside explicit test/development environments.

## RED evidence

Tests were created before the production modules/routes.

Initial focused run:

```text
pnpm exec vitest run src/server/account.test.ts app/api/auth/verify/route.test.ts

FAIL src/server/account.test.ts
Cannot find module '/src/server/account'

FAIL app/api/auth/verify/route.test.ts
Cannot find module '/app/api/auth/session/route'

Test Files 2 failed
```

This was the expected feature-missing failure: `account.ts`, session route, and logout route did not yet exist. A preliminary test-harness hoisting error was corrected before accepting the red result so the recorded failure represented missing behavior rather than a broken mock.

## GREEN evidence

Minimal implementation added:

- `loginPlayer()` uses a single Prisma `player.upsert`.
- `create.cash` is `50000000000`; `update` contains only optional wallet metadata and `lastLoginAt`.
- Verify returns `{ walletAddress, walletName }`, never a token field.
- Successful verification sets `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/` and a seven-day lifetime.
- Invalid signatures set no cookie and do not bootstrap a player.
- `authenticateRequest()` reads only `musk_session`, verifies the JWT, and returns a checksum address or throws a typed 401.
- Session checks that the referenced Player still exists.
- Logout clears the session cookie with `Max-Age=0` regardless of validity.
- Unknown exceptions map to a generic 500 response without database messages or stacks.

Focused green run:

```text
Test Files 2 passed (2)
Tests 8 passed (8)
```

## Final verification

Commands run after implementation and self-review:

```text
git diff --check
pnpm test -- src/server/account.test.ts app/api/auth/verify/route.test.ts
pnpm typecheck
```

Results before commit:

- `git diff --check`: clean.
- Full Vitest invocation: 5 test files passed, 17 tests passed.
- TypeScript: `tsc --noEmit` exited successfully.

## Self-review

- Confirmed there is no `findUnique`/`create` race in first-login funding.
- Confirmed the upsert update branch has no `cash` field.
- Confirmed returning login refreshes `lastLoginAt` and conditionally updates `walletName`.
- Confirmed JWT resolution has no fallback outside explicit `test` and `development` modes.
- Confirmed the token is absent from the verify JSON response.
- Confirmed cookie attributes are centralized and consistent for set/clear.
- Confirmed session derives wallet identity from the cookie rather than request body, query, or bearer header.
- Confirmed unknown errors use a generic response and do not serialize exception messages/stacks.
- Confirmed no downstream game UI files were changed.

## Concerns / follow-up boundary

- The existing client still expects the legacy token-shaped verify response and bearer-oriented state APIs. The brief explicitly prohibited unrelated downstream game UI changes; wiring the client and converting private game handlers belongs to the later task that adopts `authenticateRequest()`.
- Secure cookies are intentionally always enabled, satisfying production hardening and the route contract. Plain HTTP local browser testing therefore needs HTTPS or an environment-specific proxy; automated route tests are unaffected.
