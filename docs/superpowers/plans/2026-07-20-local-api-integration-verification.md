# Local API Integration Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove every local API method works against a disposable migrated and seeded PostgreSQL database, and fix any reproduced `INTERNAL_ERROR` at its root cause.

**Architecture:** Keep `scripts/test-integration.sh` as the isolated database harness and extend `tests/integration/game-flow.test.ts` into the complete authenticated HTTP-boundary flow. Route unit tests continue to own malformed-input branches; integration tests own authentication, persistence, serialization, and cross-route behavior. External Yahoo responses are deterministic in tests.

**Tech Stack:** Next.js 16 Route Handlers, TypeScript 5, Vitest 4, Prisma 6, PostgreSQL 16, viem, jose, Docker.

## Global Constraints

- Local testing only; do not deploy or modify Vercel configuration.
- Never connect integration tests to a developer or production database.
- Run every migration and seed twice in the disposable database.
- Write and observe a failing regression test before changing production code.
- Do not require live Yahoo Finance availability.

---

### Task 1: Establish the unchanged baseline and route coverage map

**Files:**
- Inspect: `app/api/**/route.ts`
- Inspect: `app/api/**/*.test.ts`
- Inspect: `tests/integration/game-flow.test.ts`
- Inspect: `tests/integration/market-refresh.test.ts`
- Inspect: `scripts/test-integration.sh`

**Interfaces:**
- Consumes: `pnpm test`, `pnpm test:integration`, and all exported Route Handler methods.
- Produces: A recorded method-to-test map and the exact failing test/error response, if any.

- [ ] **Step 1: Run the complete existing unit and route suite**

Run: `pnpm test`

Expected: Exit 0, or a named failing test with its full assertion/stack trace recorded before any edit.

- [ ] **Step 2: Run the disposable PostgreSQL integration suite unchanged**

Run: `pnpm test:integration`

Expected: The harness starts a uniquely named PostgreSQL container, applies `0_init`, `20260719_server_authoritative_game`, and `20260719_trade_snapshots`, seeds twice, runs the database tests, and removes the container. Any failure must identify its route, status, JSON error, and database boundary.

- [ ] **Step 3: Build the route coverage map**

Run:

```bash
for file in $(find app/api -name 'route.ts' | sort); do
  printf '%s: ' "$file"
  rg -o 'export async function (GET|POST|PUT|DELETE|PATCH)' "$file" | sed 's/export async function //' | paste -sd, -
done
```

Expected methods: nonce POST, verify POST, session GET, logout POST, game GET, reset POST, trades GET/POST, leaderboard GET, and refresh-market GET.

### Task 2: Add the missing authenticated lifecycle coverage

**Files:**
- Modify: `tests/integration/game-flow.test.ts`
- Test: `tests/integration/game-flow.test.ts`

**Interfaces:**
- Consumes: `GET` from `app/api/auth/session/route.ts`, `POST` from `app/api/auth/logout/route.ts`, the `Set-Cookie` returned by verify, and the authenticated game route.
- Produces: Integration coverage proving verify creates a usable cookie, session exposes the wallet, logout expires it, and an unauthenticated game request returns 401.

- [ ] **Step 1: Write the failing lifecycle test**

Add imports for session and logout. Add one test that requests a fresh nonce, signs it, calls verify, extracts `musk_session` from `set-cookie`, calls session with that cookie, calls logout, and finally calls game without a cookie. Assert verify/session/logout statuses are 200, the session wallet matches `account.address`, logout emits an expired `musk_session`, and game returns `401` with `error.code === "UNAUTHORIZED"`.

- [ ] **Step 2: Run the focused integration test and verify RED when coverage exposes a defect**

Run: `pnpm test:integration -- --runInBand` is not supported by the shell wrapper; instead temporarily focus with `pnpm vitest run --config vitest.integration.config.ts -t "creates, reads, and clears the authenticated session"` using the disposable `DATABASE_URL` printed by the harness only while its container is active. Prefer running the whole `pnpm test:integration` if no persistent harness is active.

Expected: The new assertion fails only if the real lifecycle is broken. If it passes immediately, retain it as missing integration coverage and make no production change.

- [ ] **Step 3: Apply a minimal production fix only for a reproduced defect**

Modify exactly the failing boundary among `src/server/session.ts`, `src/server/auth.ts`, `src/server/http/sessionCookie.ts`, or the corresponding auth route. Preserve the established cookie name `musk_session`, JWT subject wallet address, and 401 `UNAUTHORIZED` contract.

- [ ] **Step 4: Rerun the disposable integration suite**

Run: `pnpm test:integration`

Expected: The lifecycle test passes and existing database tests remain green.

- [ ] **Step 5: Commit the lifecycle coverage and any required fix**

```bash
git add tests/integration/game-flow.test.ts src/server/session.ts src/server/auth.ts src/server/http/sessionCookie.ts app/api/auth
git commit -m "test: cover authenticated API lifecycle"
```

Only add production paths that actually changed.

### Task 3: Cover every remaining route method, including deterministic cron refresh

**Files:**
- Modify: `tests/integration/game-flow.test.ts`
- Modify if a defect is reproduced: `app/api/cron/refresh-market/route.ts`
- Modify if a defect is reproduced: `src/server/market/refresh.ts`
- Test: `tests/integration/game-flow.test.ts`
- Test: `tests/integration/market-refresh.test.ts`

**Interfaces:**
- Consumes: real game GET, trades POST/GET, leaderboard GET, reset POST, and refresh-market GET; `CRON_SECRET`; deterministic market fetch behavior already used by `tests/integration/market-refresh.test.ts`.
- Produces: At least one successful or intentional 4xx assertion for every exported API method, with no unexpected 500 response.

- [ ] **Step 1: Add explicit method coverage assertions**

Extend the integration flow so successful login is followed by game GET, buy POST, history GET, leaderboard GET, reset POST, and logout POST. Assert each success status is 200 and assert the persisted Player, Position, and Transaction state after trade and reset. Add an unauthorized refresh request expecting 401/403 according to the route contract and an authorized deterministic refresh test using `Authorization: Bearer ${process.env.CRON_SECRET}`.

- [ ] **Step 2: Verify the new assertions expose real failures before production edits**

Run: `pnpm test:integration`

Expected: Any defect appears as a specific route status/JSON mismatch. A newly added assertion that passes documents already-correct behavior and does not justify production changes.

- [ ] **Step 3: Trace and fix each reproduced 500 one boundary at a time**

For a failing route, inspect `await response.json()` plus the matching Prisma query and migrated table/column. Add the smallest focused regression assertion, rerun to observe the same failure, then change only the originating service/route/migration code. Do not convert database errors into false 200 responses; expected client errors must remain explicit 4xx API errors.

- [ ] **Step 4: Rerun focused and full integration tests after each fix**

Run: `pnpm test:integration`

Expected: All integration tests pass, migrations and both seed runs succeed, and the container is removed.

- [ ] **Step 5: Commit complete route integration coverage**

```bash
git add tests/integration/game-flow.test.ts tests/integration/market-refresh.test.ts app/api/cron/refresh-market/route.ts src/server/market/refresh.ts
git commit -m "test: verify every game API route locally"
```

Only add production paths that actually changed.

### Task 4: Final quality gate

**Files:**
- Verify: all tracked project files
- Update only if test commands changed: `README.md`

**Interfaces:**
- Consumes: completed route coverage and any minimal root-cause fixes.
- Produces: fresh evidence for unit tests, database integration tests, type checking, and production build.

- [ ] **Step 1: Run unit and route tests**

Run: `pnpm test`

Expected: Exit 0 with zero failed tests.

- [ ] **Step 2: Run the isolated database integration suite from scratch**

Run: `pnpm test:integration`

Expected: Exit 0 with zero failed tests and successful cleanup.

- [ ] **Step 3: Run static type checking**

Run: `pnpm typecheck`

Expected: Exit 0 with no TypeScript errors.

- [ ] **Step 4: Run the production build**

Run: `pnpm build`

Expected: Exit 0 and Next.js lists all API routes without compilation or prerender errors.

- [ ] **Step 5: Verify the final diff and route matrix**

Run: `git diff --check && git status --short`

Expected: No whitespace errors; only intended tests, fixes, and documentation are modified.

- [ ] **Step 6: Commit final documentation only if needed**

```bash
git add README.md docs/superpowers/plans/2026-07-20-local-api-integration-verification.md
git commit -m "docs: document local API verification"
```

Do not create this commit if README did not change and the plan is already committed.
