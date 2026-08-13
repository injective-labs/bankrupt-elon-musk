# Musk Host Wallet Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make embedded Musk adopt the active INJ Pass wallet and clearly separate host connection from explicit Musk game authorization.

**Architecture:** Reuse the existing singleton `InjPassMiniAppConnector` for both AgentOS and visible wallet state. Adapt its EIP-1193 signer to the existing game login interface, keep the standalone connector unchanged, and make the connection control render the correct host-connected/game-locked state.

**Tech Stack:** Next.js 16, React 19, TypeScript, `@injpass/cli` 2.7, Vitest, Testing Library

## Global Constraints

- INJ Pass remains the only source of embedded wallet identity.
- Do not automatically request a signature on page load.
- Preserve the standalone Musk wallet flow.
- Preserve the existing AgentOS command protocol and origin validation.
- Host logout and wallet switches must update visible state.
- Produce one atomic Musk repository commit for this work round.

---

### Task 1: Synchronize the embedded wallet provider

**Files:**
- Modify: `src/wallet/InjPassProvider.tsx`
- Modify: `src/wallet/InjPassProvider.test.tsx`
- Modify: `src/agentos/InjPassAgentBridge.tsx`
- Create: `src/wallet/HostWalletSessionGuard.tsx`
- Create: `src/wallet/HostWalletSessionGuard.test.tsx`
- Modify: `src/state/GameProvider.tsx`
- Modify: `src/state/GameProvider.test.tsx`

**Interfaces:**
- Consume `getElonMiniAppConnector()` and `InjPassMiniAppSession`.
- Preserve `useInjPass()` with `status`, `wallet`, `connect`, `disconnect`, and `signMessage`.
- Embedded `wallet.signer.signMessage(message)` delegates to `personal_sign` on the host EIP-1193 provider.

- [ ] **Step 1: Write failing provider tests**

Add tests that render the provider in embedded mode, dispatch authenticated and unauthenticated host sessions, invoke `connect()` from guest mode, and exercise the adapted signer.

- [ ] **Step 2: Verify RED**

Run `pnpm exec vitest run src/wallet/InjPassProvider.test.tsx` and confirm the authenticated host session is not adopted by the current standalone-only provider.

- [ ] **Step 3: Implement the shared embedded connector path**

Select `getElonMiniAppConnector()` in embedded mode, subscribe to its session, create a structural wallet adapter from authenticated sessions, request host login for guests, and clear state on logout.

The provider must determine embedded mode on the initial render and bound the first session handshake. The page-level guard must hide cookie-backed protected UI before that handshake and synchronously invalidate local game state on a host mismatch before best-effort cookie deletion.

- [ ] **Step 4: Centralize connector cleanup**

Remove `destroyElonMiniAppConnector()` from the AgentOS bridge cleanup and call it from the embedded wallet provider cleanup so both consumers share one live connector.

- [ ] **Step 5: Verify GREEN**

Run `pnpm exec vitest run src/wallet/InjPassProvider.test.tsx src/agentos/InjPassAgentBridge.test.tsx src/wallet/useInjPassLogin.test.tsx` and expect all tests to pass.

### Task 2: Render host-connected authorization state

**Files:**
- Modify: `src/wallet/ConnectButton.tsx`
- Create or modify: `src/wallet/ConnectButton.test.tsx`

**Interfaces:**
- Consume the existing wallet context and `GameProvider` auth state.
- Render `Authorize game` / `授权游戏` when a wallet exists but `authStatus !== "authenticated"`.

- [ ] **Step 1: Write the failing button test**

Mock an authenticated host wallet with a locked game session and assert that the button includes the wallet name and authorization copy while no connect prompt is present.

- [ ] **Step 2: Verify RED**

Run `pnpm exec vitest run src/wallet/ConnectButton.test.tsx` and confirm the current wallet-chip behavior fails the expected explicit authorization state.

- [ ] **Step 3: Implement the authorization button**

When the wallet exists but the game is locked, render a direct button that calls `beginLogin()`. Keep the authenticated account menu and true guest connect button unchanged.

- [ ] **Step 4: Verify GREEN**

Run the focused wallet and component tests and expect zero failures.

### Task 3: Regression verification and delivery

**Files:**
- Verify all files from Tasks 1 and 2.

- [ ] **Step 1: Run affected suites**

Run the wallet, GameProvider, GameApp, AgentOS bridge, API, and component tests.

- [ ] **Step 2: Run static and production checks**

Run `pnpm typecheck`, `pnpm build`, and `git diff --check`. Record the repository's known unrelated ProductCard full-suite baseline separately.

- [ ] **Step 3: Review and create one commit**

Confirm the diff changes no INJ Pass frontend or trading behavior, then commit once with `fix: sync the INJ Pass host wallet`.

- [ ] **Step 4: Integrate and deploy**

Fast-forward Musk `main`, push to `origin/main`, deploy the `bankrupt-elon-musk-next` Vercel production project, and confirm the canonical URL returns HTTP 200.

- [ ] **Step 5: Browser acceptance**

From an authenticated `https://inj-pass-frontend-test.vercel.app` session, open Bankrupt Elon Musk and confirm the embedded UI shows the host wallet plus authorization state instead of `Connect INJ Pass`, with no console errors.
