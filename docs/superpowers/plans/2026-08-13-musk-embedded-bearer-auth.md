# Musk Embedded Bearer Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace third-party-cookie authentication in the embedded Musk game with the existing scoped bearer flow and document reusable INJ Pass dApp integration patterns.

**Architecture:** Add a runtime game API facade that delegates standalone calls to the cookie client and embedded calls to an in-memory bearer client. Preserve AgentOS token isolation, extend reset to the combined cookie-or-bearer server authenticator, and distinguish game authorization expiry from INJ Pass host-session expiry.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest, `@injpass/cli`, viem, jose.

## Global Constraints

- Modify only the Bankrupt Elon Musk repository in this work round.
- Keep standalone seven-day cookie authentication unchanged.
- Keep embedded bearer tokens in memory only with the existing 15-minute TTL and scopes.
- Do not trust a host-provided address without nonce-signature verification.
- Produce one final atomic commit after implementation, tests, and documentation.

---

### Task 1: Runtime authentication transport

**Files:**
- Create: `src/client/runtimeGameApi.ts`
- Create: `src/client/runtimeGameApi.test.ts`
- Modify: `src/state/GameProvider.tsx`

**Interfaces:**
- Consumes: existing functions and response types from `src/client/gameApi.ts`.
- Produces: the same `GameApi` method surface used by `GameProvider`, selected through `createRuntimeGameApi({ embedded, transport })`.

- [ ] **Step 1: Write failing embedded-flow tests**

Cover successful nonce signing and `/api/auth/agent-verify`, bearer propagation to game/trade/history/leaderboard/reset, in-memory logout, token clearing on `401`, and `GAME_AUTH_EXPIRED` mapping. Also cover the unchanged standalone cookie path.

- [ ] **Step 2: Verify RED**

Run: `CI=1 node_modules/.bin/vitest run src/client/runtimeGameApi.test.ts --maxWorkers=1`

Expected: FAIL because `runtimeGameApi` does not exist.

- [ ] **Step 3: Implement the facade**

Create a closure-owned `AgentSessionView | null`. Embedded `loginWithSignature`
gets a nonce, signs its exact message, calls `verifyAgentSignature`, validates
the returned wallet, and stores the bearer. Protected methods pass the stored
token to the existing client; missing/expired tokens throw
`GameApiError(401, "GAME_AUTH_EXPIRED", ...)`. Standalone methods delegate
unchanged. Point `GameProvider` at the facade.

- [ ] **Step 4: Verify GREEN**

Run the runtime-client and existing game-client tests and require zero failures.

### Task 2: Reset bearer authorization and user-facing expiry semantics

**Files:**
- Modify: `app/api/game/reset/route.ts`
- Modify: `app/api/game/reset/route.test.ts`
- Modify: `src/components/GameApp.tsx`
- Modify: `src/i18n/strings.ts`
- Modify: `src/components/GameApp.test.tsx`

**Interfaces:**
- Consumes: `authenticateGameRequest(request, "game:trade")` and `lastError` from `useGame()`.
- Produces: reset support for cookie or scoped bearer authentication and distinct embedded authorization-expiry copy.

- [ ] **Step 1: Write failing reset and UI tests**

Assert reset uses `authenticateGameRequest` with `game:trade`, and that
`GAME_AUTH_EXPIRED` renders “游戏授权已失效，请重新授权”.

- [ ] **Step 2: Verify RED**

Run the two focused test files and confirm failures identify the old cookie-only
authenticator and old copy.

- [ ] **Step 3: Implement the minimal route and copy changes**

Use the combined authenticator in reset. Add bilingual
`error.GAME_AUTH_EXPIRED` strings and render `lastError` through `errorText` for
expired game state.

- [ ] **Step 4: Verify GREEN**

Run the route, GameApp, GameProvider, wallet, and AgentOS suites with one worker.

### Task 3: Reusable dApp integration guide

**Files:**
- Create: `docs/INJPASS_DAPP_INTEGRATION_PATTERNS.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: verified implementations in Musk, INJ Gift, Eric Mfer, Omisper, and the AgentOS mini-app bridge.
- Produces: a decision matrix and checklists for future dApps.

- [ ] **Step 1: Document actual patterns**

Compare pure on-chain apps, server-authoritative apps, host-capability apps, and
Chat Agent apps across session source, proof of identity, write authorization,
storage, token/cookie policy, reload behavior, and examples.

- [ ] **Step 2: Add the selection guide**

State when host session alone is enough for UI identity, when every chain write
is self-authenticating, when a backend needs a signed nonce plus scoped bearer,
and why cross-origin mini apps must not depend on third-party cookies.

- [ ] **Step 3: Link the guide from README**

Add a short documentation link without changing product behavior.

### Task 4: Verification, review, integration, and deployment

**Files:** all files changed above.

- [ ] **Step 1: Run focused tests, typecheck, build, and `git diff --check`**

Require all affected tests, TypeScript, production build, and whitespace checks
to pass. Run the full suite and separately identify only pre-existing failures.

- [ ] **Step 2: Review the complete diff**

Verify no bearer persistence, no cookie regression, exact address binding,
correct scopes, and complete documentation.

- [ ] **Step 3: Create one atomic commit**

Commit implementation, tests, design, plan, and guide together with:
`fix: use bearer auth for embedded Musk`.

- [ ] **Step 4: Fast-forward main, push, and deploy production**

Update Musk `main`, push `origin/main`, deploy to Vercel production, and verify
the canonical alias and recent request behavior.

