# Local API Integration Verification Design

## Goal

Make every API route in `bankrupt-elon-musk-next` pass a repeatable local integration verification against a disposable PostgreSQL database. The work is local only; production deployment and production data changes are out of scope.

## Scope

The verification covers all nine route handlers and every exported HTTP method:

- `POST /api/auth/nonce`
- `POST /api/auth/verify`
- `GET /api/auth/session`
- `POST /api/auth/logout`
- `GET /api/game`
- `POST /api/game/reset`
- `GET` and `POST /api/trades`
- `GET /api/leaderboard`
- `GET /api/cron/refresh-market`

The test suite will exercise the routes through their `Request`/`Response` boundary while using the real authentication, service, Prisma, migration, seed, and PostgreSQL layers. External market-provider calls may be replaced with deterministic responses where network behavior is not the subject of the test.

## Test Environment

`scripts/test-integration.sh` remains the single entry point. It creates a uniquely named PostgreSQL 16 container on a random localhost port, rejects any database URL that is not local and test-specific, applies every migration, runs the seed twice to prove idempotency, runs integration tests serially, and removes the container on exit.

Tests must not read or mutate a developer or production database. Test wallets, quotes, transactions, triggers, and environment variables are cleaned up or confined to the disposable database.

## Verification Flow

The primary authenticated flow is:

1. Request a nonce for a deterministic test wallet.
2. Sign the returned message and verify it to create the player and session cookie.
3. Read the session and game projection.
4. Submit a buy, read trade history, and verify persisted cash, position, and ledger state.
5. Read the leaderboard and verify it derives values from server state.
6. Reset the game and verify positions are cleared while the immutable ledger remains.
7. Log out and verify the old session is no longer accepted by routes that require authentication.

The cron flow verifies secret validation and a deterministic successful refresh without relying on live Yahoo availability. Route-level validation tests remain responsible for malformed requests, missing authentication, pagination bounds, and mapped API errors.

## Failure Diagnosis and Fix Policy

The existing integration suite is run unchanged first to establish the baseline. For each failure, the full error response and relevant database state are inspected to locate the failing boundary: request validation, session authentication, domain service, Prisma query, migration/schema, seed data, or response serialization.

No production code is changed until a minimal regression test reproduces the observed failure and fails for the expected reason. Each root cause receives one focused fix. After every fix, the targeted test is rerun before the complete suite.

## Acceptance Criteria

The work is accepted when fresh runs show all of the following:

- Every API route and exported HTTP method is represented in integration or route-level coverage.
- The complete unit/route test suite passes.
- The disposable-PostgreSQL integration suite passes from migrations through cleanup.
- TypeScript type checking passes.
- The production build succeeds.
- No test requires production credentials, production data, or a live external quote service.
- Any remaining intentionally rejected requests return documented 4xx errors rather than unexpected `INTERNAL_ERROR` responses.

## Out of Scope

- Deploying to Vercel or modifying Vercel environment variables.
- Running migrations or seed commands against production.
- Guaranteeing availability of Yahoo Finance or other third-party services.
- Redesigning game rules or unrelated UI behavior.
