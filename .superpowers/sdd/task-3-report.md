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

## Follow-up security review fixes

Review identified five gaps after the initial commit. They were addressed test-first in a follow-up change.

### Follow-up RED evidence

The focused command was:

```text
pnpm exec vitest run app/api/state/route.test.ts src/server/auth.test.ts src/server/http/sessionCookie.test.ts src/server/http/errors.test.ts
```

The first behavior run produced 7 expected failures:

- Legacy state GET returned 200 instead of 503 and PUT returned 400 instead of 503.
- Concurrent signed nonce replay reached the old unconditional `delete` path rather than conditional `deleteMany`.
- A nonce deletion failure was swallowed instead of propagated.
- Development and test cookies incorrectly contained `Secure`.
- `ApiError.details` was serialized into the public response.

### Follow-up GREEN changes

- Retired both GET and PUT `/api/state` paths with a fixed 503 `GAME_STATE_API_RETIRED` response. The route no longer imports wallet, game-state, or database persistence code.
- Changed nonce consumption to conditional `deleteMany` over checksum wallet, exact nonce, and `expiresAt > now`; JWT issuance occurs only for `count === 1`, and deletion errors propagate.
- Made cookie `secure` dynamic: true only for `NODE_ENV=production`, false for test/development. Other attributes remain HttpOnly, SameSite=Lax, and Path=/.
- Removed `ApiError.details` from public serialization while retaining typed code/message responses.
- Added real cryptographic coverage using a viem private-key account and signature, real JOSE tokens for expiry and wrong-secret rejection, actual cookie parsing, and checksum normalization.
- Preserved the existing account service seam tests proving atomic upsert, create-only starting cash, and no cash mutation on returning login.

Focused follow-up result:

```text
Test Files 5 passed (5)
Tests 15 passed (15)
```

### Follow-up full verification

```text
git diff --check
pnpm test
pnpm typecheck
```

Results:

- Diff check clean.
- Full suite: 9 test files passed, 26 tests passed.
- TypeScript: `tsc --noEmit` exited successfully.

### Updated concern

- The prior note that cookies were always Secure is superseded: Secure is now production-only, so local HTTP development works while production remains hardened.
- Legacy state synchronization now receives an intentional 503 until the authenticated authoritative game APIs replace it; this closes the unauthenticated overwrite window rather than retaining insecure compatibility.
