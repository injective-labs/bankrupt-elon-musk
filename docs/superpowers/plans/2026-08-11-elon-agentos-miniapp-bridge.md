# Elon AgentOS Mini-App Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Let INJ Pass Chat execute deterministic `@Bankrupt Elon Musk` market, account, history, ranking, buy, and sell commands through the existing `injpass-miniapp-v1` hidden mini-app runner.

**Architecture:** INJ Pass remains the AgentOS host and sends validated `session` plus `agent-command` messages to a hidden Elon iframe. Elon binds the host wallet to a 15-minute bearer session through its existing signature login, dispatches commands into its existing same-origin APIs, and returns one correlated `agent-command-result`; the Elon server remains authoritative for identity, prices, balances, positions, settlement locks, and idempotency.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest, `@injpass/cli` 2.7, viem, jose, Prisma/PostgreSQL.

## Global Constraints

- Simulated Elon assets only; no real-money or on-chain trade execution.
- Use `injpass-miniapp-v1`; do not introduce a second host protocol.
- Production trusts only the exact origin derived from `NEXT_PUBLIC_INJPASS_EMBED_URL`; development may additionally trust loopback origins.
- Agent JWT audience is `bankrupt-elon-agentos`, scopes are `game:read` and `game:trade`, and lifetime is 15 minutes.
- Agent access tokens stay in iframe memory and never enter URLs, storage, `postMessage`, logs, or command results.
- Explicit complete trades execute immediately; missing or ambiguous input never trades.
- Quantities are positive integer strings or `MAX`.
- All trade prices and receipts come from the existing Elon server.
- Preserve standalone Elon wallet connection and UI behavior.
- Do not modify `inj-pass-backend` for version one.
- Do not create intermediate commits; make only final repository commits after all verification passes.

---

## File Structure

### `bankrupt-elon-musk-next`

- `src/agentos/protocol.ts`: command/result types, runtime command parsing, stable result keys.
- `src/agentos/host.ts`: embedded-mode detection, exact host-origin validation, mini-app connector lifecycle.
- `src/agentos/api.ts`: in-memory agent token binding and authenticated API calls using existing response validators.
- `src/agentos/assets.ts`: deterministic asset matching and ambiguity candidates.
- `src/agentos/execute.ts`: action dispatcher and error normalization.
- `src/agentos/InjPassAgentBridge.tsx`: React message lifecycle and one-result-per-command correlation.
- `app/api/auth/agent-verify/route.ts`: signature verification plus short-lived audience/scoped bearer issuance.
- `src/server/auth.ts`: distinct agent token issue/verify and cookie-or-bearer request authentication.
- Existing API routes: switch protected game/trade/session/rank identity reads to the combined authentication helper where needed.
- `src/components/GameApp.tsx`: mount the bridge once without nesting the standalone connector.
- Focused `*.test.ts(x)` files alongside each new unit.

### `inj-pass-frontend`

- `src/services/mini-app-commands.ts`: Elon command grammar, string quantities, `MAX`, market/history actions, result formatting.
- `scripts/test-mini-app-commands.ts`: deterministic command and formatting coverage.
- `src/config/mini-apps.ts`: local Elon port alignment.
- `.env.example` and `.env.local.example`: documented Elon local URL.
- Existing hidden runner remains unchanged unless a failing correlation/lifecycle test exposes a required repair.

---

### Task 1: Upgrade the Connector and Add the Typed Elon Protocol

**Files:**
- Modify: `bankrupt-elon-musk-next/package.json`
- Modify: `bankrupt-elon-musk-next/pnpm-lock.yaml`
- Create: `bankrupt-elon-musk-next/src/agentos/protocol.ts`
- Create: `bankrupt-elon-musk-next/src/agentos/protocol.test.ts`

**Interfaces:**
- Consumes: `injpass-miniapp-v1` envelopes from the existing INJ Pass runner.
- Produces: `parseElonAgentCommand(value): ElonAgentCommand | null`, `ElonAgentResult`, and `ELON_AGENT_CHANNEL` for all later Elon tasks.

- [x] **Step 1: Write failing protocol validation tests**

Cover exact app ID, allowed actions, object params, string quantities, `MAX`, numeric limits, and rejection of wallet address, price, amount, and idempotency fields. The essential assertions are:

```ts
expect(parseElonAgentCommand({
  appId: "bankrupt-elon-musk",
  action: "buy",
  params: { asset: "TSLA", quantity: "100" },
})).toEqual({
  appId: "bankrupt-elon-musk",
  action: "buy",
  rawText: "",
  language: "en",
  params: { asset: "TSLA", quantity: "100" },
});
expect(parseElonAgentCommand({
  appId: "bankrupt-elon-musk",
  action: "buy",
  params: { asset: "TSLA", quantity: 100 },
})).toBeNull();
expect(parseElonAgentCommand({
  appId: "bankrupt-elon-musk",
  action: "buy",
  params: { asset: "TSLA", quantity: "100", usdUnitPrice: "1" },
})).toBeNull();
```

- [x] **Step 2: Run the focused test and verify the missing module fails**

Run: `pnpm test -- src/agentos/protocol.test.ts`

Expected: FAIL because `src/agentos/protocol.ts` does not exist.

- [x] **Step 3: Implement the protocol module**

Define these exact public types and parser:

```ts
export const ELON_AGENT_CHANNEL = "injpass-miniapp-v1";
export type ElonAgentAction = "market" | "balance" | "portfolio" | "history" | "rank" | "buy" | "sell";
export interface ElonAgentCommand {
  appId: "bankrupt-elon-musk";
  action: ElonAgentAction;
  rawText: string;
  language: string;
  params: { query?: string; asset?: string; quantity?: string; limit?: number };
}
export interface ElonAgentResult {
  ok: boolean;
  key: string;
  data?: Record<string, unknown>;
  message?: string;
}
export function parseElonAgentCommand(value: unknown): ElonAgentCommand | null;
```

Use an allowlist for every top-level and param key. Clamp `limit` only in execution; parsing accepts finite numbers and rejects non-numbers. Accept trade quantities only when `/^(?:MAX|[1-9]\d*)$/` matches.

- [x] **Step 4: Upgrade `@injpass/cli` and run the focused test**

Run: `pnpm add @injpass/cli@2.7.0`

Run: `pnpm test -- src/agentos/protocol.test.ts && pnpm typecheck`

Expected: PASS and the lockfile resolves `@injpass/cli@2.7.0`.

---

### Task 2: Add Exact Host-Origin Validation and Connector Lifecycle

**Files:**
- Create: `bankrupt-elon-musk-next/src/agentos/host.ts`
- Create: `bankrupt-elon-musk-next/src/agentos/host.test.ts`

**Interfaces:**
- Consumes: `NEXT_PUBLIC_INJPASS_EMBED_URL`, browser query parameters, and `InjPassMiniAppConnector`.
- Produces: `trustedInjPassHostOrigin(location, nodeEnv, embedUrl)`, `getElonMiniAppConnector()`, and `destroyElonMiniAppConnector()`.

- [x] **Step 1: Write failing origin and lifecycle tests**

Tests must prove:

```ts
expect(trustedInjPassHostOrigin(
  "https://elon.example/?injpass_miniapp=1&injpass_host_origin=https%3A%2F%2Finjpass.com",
  "production",
  "https://injpass.com/embed",
)).toBe("https://injpass.com");
expect(() => trustedInjPassHostOrigin(
  "https://elon.example/?injpass_miniapp=1&injpass_host_origin=https%3A%2F%2Fevil.example",
  "production",
  "https://injpass.com/embed",
)).toThrow("Untrusted INJ Pass host origin");
expect(trustedInjPassHostOrigin(
  "http://localhost:3002/?injpass_miniapp=1&injpass_host_origin=http%3A%2F%2Flocalhost%3A3000",
  "development",
  "http://localhost:3000/embed",
)).toBe("http://localhost:3000");
```

Mock `InjPassMiniAppConnector` and verify repeated getters share one connector, while destroy calls `destroy()` once and permits recreation.

- [x] **Step 2: Run the focused test and verify failure**

Run: `pnpm test -- src/agentos/host.test.ts`

Expected: FAIL because the host module does not exist.

- [x] **Step 3: Implement origin validation and connector ownership**

Parse both origins with `new URL`. In production require exact equality. In development allow exact equality plus `http:` loopback hostnames `localhost`, `127.0.0.1`, and `::1`. Construct:

```ts
connector = new InjPassMiniAppConnector({ hostOrigin });
```

Only return a connector when `InjPassMiniAppConnector.isEmbedded()` is true. Keep one module-level instance and destroy it during bridge teardown.

- [x] **Step 4: Run tests and typecheck**

Run: `pnpm test -- src/agentos/host.test.ts && pnpm typecheck`

Expected: PASS.

---

### Task 3: Add Short-Lived Agent Authentication

**Files:**
- Modify: `bankrupt-elon-musk-next/src/server/auth.ts`
- Create: `bankrupt-elon-musk-next/app/api/auth/agent-verify/route.ts`
- Create: `bankrupt-elon-musk-next/app/api/auth/agent-verify/route.test.ts`
- Modify: `bankrupt-elon-musk-next/src/server/auth.test.ts`
- Modify: `bankrupt-elon-musk-next/app/api/game/route.ts`
- Modify: `bankrupt-elon-musk-next/app/api/trades/route.ts`
- Modify: `bankrupt-elon-musk-next/app/api/leaderboard/route.ts`

**Interfaces:**
- Consumes: existing nonce records, `verifyMessage`, `JWT_SECRET`, cookie sessions, and `Authorization: Bearer`.
- Produces: `verifyAndIssueAgentToken(address, signature)`, `verifyAgentToken(token)`, `authenticateGameRequest(request, requiredScope)`, and `POST /api/auth/agent-verify`.

- [x] **Step 1: Write failing token and route tests**

Assert the token has subject equal to the checksum wallet, audience `bankrupt-elon-agentos`, scopes `game:read game:trade`, and an expiry no more than 900 seconds after issuance. Assert a normal cookie JWT is rejected by `verifyAgentToken`, an agent token is rejected by normal `verifyToken`, missing scope returns 403, and an explicitly supplied valid bearer token takes precedence over a stale cookie from another wallet.

Route success must return only:

```ts
{
  walletAddress: wallet,
  walletName: "alice.inj",
  accessToken: "agent.jwt",
  expiresIn: 900,
}
```

It must set no cookie. Invalid signatures return 401 and no token.

- [x] **Step 2: Run focused tests and verify failure**

Run: `pnpm test -- src/server/auth.test.ts app/api/auth/agent-verify/route.test.ts`

Expected: FAIL because agent token functions and the route are missing.

- [x] **Step 3: Implement distinct agent JWT issuance and verification**

Use jose claims:

```ts
const AGENT_AUDIENCE = "bankrupt-elon-agentos";
const AGENT_TTL_SECONDS = 15 * 60;
const AGENT_SCOPES = ["game:read", "game:trade"] as const;
```

Issue with `.setAudience(AGENT_AUDIENCE)`, `.setExpirationTime("15m")`, and a `scope` string. Verify with `jwtVerify(token, jwtSecret(), { audience: AGENT_AUDIENCE })`. Update normal token verification to reject any token carrying the AgentOS audience.

`authenticateGameRequest` first checks whether the request explicitly supplies an `Authorization` header. When present, it must be exactly one `Bearer <token>` value; verify its audience and requested scope and do not fall back to a cookie. When the header is absent, honor the existing standalone cookie. This prevents a stale standalone cookie from selecting a different wallet inside the AgentOS iframe. Throw `ApiError(401, "UNAUTHORIZED", ...)` for invalid auth and `ApiError(403, "INSUFFICIENT_SCOPE", ...)` for missing scope.

- [x] **Step 4: Implement the route and protected-route integration**

The new route validates address/signature, calls `verifyAndIssueAgentToken`, upserts the player through `loginPlayer`, and returns the public metadata plus token. Use `game:read` for game GET, trade history GET, and optional leaderboard identity; use `game:trade` for trade POST. Preserve public market and public leaderboard behavior.

- [x] **Step 5: Run auth and route tests**

Run: `pnpm test -- src/server/auth.test.ts app/api/auth/agent-verify/route.test.ts app/api/game/route.test.ts app/api/trades/route.test.ts`

Expected: PASS for both cookie and bearer callers.

---

### Task 4: Add the In-Memory Agent API Client and Asset Resolver

**Files:**
- Modify: `bankrupt-elon-musk-next/src/client/gameApi.ts`
- Modify: `bankrupt-elon-musk-next/src/client/gameApi.test.ts`
- Create: `bankrupt-elon-musk-next/src/agentos/api.ts`
- Create: `bankrupt-elon-musk-next/src/agentos/api.test.ts`
- Create: `bankrupt-elon-musk-next/src/agentos/assets.ts`
- Create: `bankrupt-elon-musk-next/src/agentos/assets.test.ts`

**Interfaces:**
- Consumes: host EIP-1193 `personal_sign`, current host session, and existing validated game API response decoders.
- Produces: `ElonAgentApi`, `createElonAgentApi(provider)`, `clearAgentSession()`, and `resolveElonAsset(assets, input)`.

- [x] **Step 1: Write failing agent client tests**

Verify the first protected call requests nonce, calls:

```ts
provider.request({
  method: "personal_sign",
  params: [stringToHex(message), walletAddress],
});
```

then posts signature to `/api/auth/agent-verify`, stores the returned token only in the object instance, and sends `Authorization: Bearer agent.jwt` on game/trade/history/rank requests. A second call for the same address must reuse the token; wallet address change or 401 must clear it and rebind once.

- [x] **Step 2: Write failing asset-resolution tests**

Cover exact ID, ticker, full name, case-insensitivity, normalized whitespace, no match, and ambiguity. The interface is:

```ts
export type AssetResolution =
  | { kind: "exact"; asset: AssetView }
  | { kind: "missing" }
  | { kind: "ambiguous"; candidates: AssetView[] };
export function resolveElonAsset(assets: AssetView[], input: string): AssetResolution;
```

Never choose the first fuzzy candidate.

- [x] **Step 3: Run focused tests and verify failure**

Run: `pnpm test -- src/agentos/api.test.ts src/agentos/assets.test.ts`

Expected: FAIL because both modules are missing.

- [x] **Step 4: Expose reusable validated client requests**

Refactor `gameApi.ts` so the existing response validators remain the single validation boundary and request functions accept an optional authorization token without changing current callers. Preserve `credentials: "same-origin"`; add the bearer header only when a token is supplied.

- [x] **Step 5: Implement the agent API and asset resolver**

Keep token/address/expiry in closure memory. Do not use browser storage. Clamp history limit to 1–100. Generate trade UUIDs through `crypto.randomUUID()` inside the command executor, not from the host command.

- [x] **Step 6: Run focused tests and typecheck**

Run: `pnpm test -- src/client/gameApi.test.ts src/agentos/api.test.ts src/agentos/assets.test.ts && pnpm typecheck`

Expected: PASS.

---

### Task 5: Implement Elon Command Execution and Error Mapping

**Files:**
- Create: `bankrupt-elon-musk-next/src/agentos/execute.ts`
- Create: `bankrupt-elon-musk-next/src/agentos/execute.test.ts`

**Interfaces:**
- Consumes: `ElonAgentCommand`, `ElonAgentApi`, `resolveElonAsset`, and `GameApiError`.
- Produces: `executeElonAgentCommand(command, dependencies): Promise<ElonAgentResult>`.

- [x] **Step 1: Write failing dispatcher tests**

Cover every action, missing asset, missing quantity, ambiguity, `MAX`, history limit, UUID creation, authoritative receipt fields, and stable error mapping. Verify buy uses `side: "BUY"`, sell uses `side: "SELL"`, and the command cannot inject an idempotency key.

Map current server codes exactly:

```ts
const ERROR_KEYS: Record<string, string> = {
  INSUFFICIENT_CASH: "insufficient_cash",
  INSUFFICIENT_HOLDINGS: "insufficient_position",
  SETTLEMENT_LOCKED: "market_locked",
  QUOTE_MISSING: "quote_missing",
  QUOTE_STALE: "quote_stale",
  ASSET_DISABLED: "asset_disabled",
  UNAUTHORIZED: "session_expired",
};
```

- [x] **Step 2: Run the focused test and verify failure**

Run: `pnpm test -- src/agentos/execute.test.ts`

Expected: FAIL because `execute.ts` does not exist.

- [x] **Step 3: Implement the dispatcher**

Keep query transformations small and deterministic. `game_balance` returns cash, holdings value, net worth, and P&L. `game_portfolio` joins positions to authoritative asset projections. `game_market` returns at most ten matching public assets. `game_trade` returns only the receipt and asset display fields listed in the design.

Catch `GameApiError` and return the stable key. Return `unknown_error` with a generic production-safe message for all other errors.

- [x] **Step 4: Run focused tests and typecheck**

Run: `pnpm test -- src/agentos/execute.test.ts && pnpm typecheck`

Expected: PASS.

---

### Task 6: Mount the Correlated Agent Bridge

**Files:**
- Create: `bankrupt-elon-musk-next/src/agentos/InjPassAgentBridge.tsx`
- Create: `bankrupt-elon-musk-next/src/agentos/InjPassAgentBridge.test.tsx`
- Modify: `bankrupt-elon-musk-next/src/components/GameApp.tsx`

**Interfaces:**
- Consumes: connector session/provider, typed command parser, and command executor.
- Produces: one origin-scoped `agent-command-result` per accepted command ID and no visible UI.

- [x] **Step 1: Write failing bridge tests**

Use jsdom message events to prove:

- embedded mode posts `ready` through the connector;
- valid source/origin/channel/app ID executes once and responds once;
- wrong source, origin, channel, app ID, malformed command, and duplicate active ID are ignored;
- a 60-second timeout returns `command_timeout` once;
- wallet switch clears the agent token;
- unmount removes listeners and destroys the connector;
- standalone mode renders nothing and does not instantiate a connector.

- [x] **Step 2: Run the focused test and verify failure**

Run: `pnpm test -- src/agentos/InjPassAgentBridge.test.tsx`

Expected: FAIL because the component is missing.

- [x] **Step 3: Implement the component**

Mount one effect, track active command IDs in a `Set`, and race execution with a 60-second timeout. Post with:

```ts
window.parent.postMessage({
  channel: ELON_AGENT_CHANNEL,
  type: "agent-command-result",
  id,
  result,
}, trustedOrigin);
```

Use the connector’s current session as the only wallet identity. On session address change call `clearAgentSession()`. Cleanup must remove the event listener, clear pending IDs, and destroy the connector.

- [x] **Step 4: Mount once and run focused tests**

Render `<InjPassAgentBridge />` alongside `<GameShell />` inside the existing providers. The bridge itself must remain invisible and must not invoke the standalone `InjPassProvider` connector.

Run: `pnpm test -- src/agentos/InjPassAgentBridge.test.tsx src/wallet/InjPassProvider.test.tsx && pnpm typecheck`

Expected: PASS.

---

### Task 7: Complete INJ Pass Elon Parsing, URLs, and Result Copy

**Files:**
- Modify: `inj-pass-frontend/src/services/mini-app-commands.ts`
- Modify: `inj-pass-frontend/scripts/test-mini-app-commands.ts`
- Modify: `inj-pass-frontend/src/config/mini-apps.ts`
- Modify: `inj-pass-frontend/.env.example`
- Modify: `inj-pass-frontend/.env.local.example`

**Interfaces:**
- Consumes: user Chat text and `ElonAgentResult` keys.
- Produces: the exact `ElonAgentCommand` protocol and localized Chat output.

- [x] **Step 1: Add failing deterministic parser assertions**

Add cases for Chinese and English market, balance, portfolio, history, rank, buy, sell, and sell-all commands. Assert quantities are strings:

```ts
assert.deepEqual(
  parseMiniAppAgentCommand("@Bankrupt Elon Musk 买入 100 股 TSLA", "zh-Hans")?.params,
  { product: "TSLA", quantity: "100" },
);
assert.equal(
  parseMiniAppAgentCommand("@Bankrupt Elon Musk sell all BTC", "en")?.params.quantity,
  "MAX",
);
```

Add formatter assertions for `game_market`, `game_history`, `ambiguous_asset`, `missing_asset`, `missing_quantity`, quote errors, session expiration, and command timeout.

- [x] **Step 2: Run the command script and verify failure**

Run: `pnpm test-mini-app-commands`

Expected: FAIL on string quantity, `MAX`, market/history, or missing result copy.

- [x] **Step 3: Implement parser and formatter changes**

Change command quantity type from `number` to `string`. Parse explicit all/max phrases before numeric extraction. Add `market` and `history` actions before the fallback `open`. Keep multilingual patterns bounded and deterministic. Never infer a missing asset or quantity.

Format `game_balance` with P&L rather than the nonexistent debt field. Bound market/history/candidate output to ten entries.

- [x] **Step 4: Align local URL configuration**

Set the Elon manifest development fallback to `http://localhost:3002` and add:

```dotenv
NEXT_PUBLIC_BANKRUPT_ELON_APP_URL=http://localhost:3002
```

to both example files. Do not change the production fallback.

- [x] **Step 5: Run focused INJ Pass verification**

Run: `pnpm test-mini-app-commands && pnpm test -- src/services/mini-app-config.test.ts && pnpm lint`

Expected: PASS with no formatting or type errors.

---

### Task 8: Full Verification, Browser Flow, Documentation, and Final Commits

**Files:**
- Modify: `bankrupt-elon-musk-next/README.md`
- Modify: `bankrupt-elon-musk-next/docs/superpowers/specs/2026-08-11-elon-agentos-miniapp-bridge-design.md` only if implementation evidence requires a factual correction.
- Modify: `bankrupt-elon-musk-next/docs/superpowers/plans/2026-08-11-elon-agentos-miniapp-bridge.md` checkbox statuses as tasks complete.

**Interfaces:**
- Consumes: completed implementation in both repositories.
- Produces: verified local/production configuration instructions and final atomic repository history.

- [x] **Step 1: Document the AgentOS flow**

Add README instructions for the three local services, exact ports, `NEXT_PUBLIC_BANKRUPT_ELON_APP_URL`, supported `@Bankrupt Elon Musk` examples, the 15-minute in-memory binding, and the fact that simulation prices remain server-authoritative.

- [x] **Step 2: Run full Elon verification**

Run:

```bash
pnpm test
pnpm typecheck
pnpm build
```

Expected: all tests pass, TypeScript exits 0, and Next production build succeeds.

- [x] **Step 3: Run full INJ Pass frontend verification**

Run:

```bash
pnpm test
pnpm test-mini-app-commands
pnpm lint
pnpm build
```

Expected: all tests pass and production build succeeds.

- [ ] **Step 4: Run browser end-to-end verification**

Start INJ Pass frontend on 3000 with its backend on 3001, Elon on 3002, and the Elon PostgreSQL database on 5433. In a real browser verify:

1. `@Bankrupt Elon Musk 查询 TSLA` returns market data.
2. Balance and portfolio bind the current INJ Pass wallet once.
3. `买入 1 TSLA` returns an authoritative receipt.
4. History contains the same transaction ID.
5. `卖出全部 TSLA` returns an authoritative receipt.
6. The visible Elon UI shows the same final server state.
7. An ambiguous asset phrase returns candidates and creates no transaction.

Not run in this implementation worktree: ports 3000, 3001, 3002, and 5433 had
no local services listening, so a wallet-backed browser transaction could not
be exercised without provisioning external runtime state. Protocol, route,
component, and production-build coverage were run instead.

- [x] **Step 5: Audit diffs and secrets**

Run `git diff --check`, inspect both `git diff --stat` outputs, verify no real token, private key, JWT, database URL, or generated browser artifact is staged, and confirm unrelated user files remain untouched.

- [x] **Step 6: Create final commits only after all checks pass**

Create at most one final commit in each affected repository because a Git commit cannot span repositories:

```bash
git -C bankrupt-elon-musk-next add <reviewed Elon files>
git -C bankrupt-elon-musk-next commit -m "feat: add AgentOS mini-app commands"
git -C inj-pass-frontend add <reviewed INJ Pass files>
git -C inj-pass-frontend commit -m "feat: route Elon AgentOS commands"
```

Do not amend, squash, or rewrite existing commits.
