# Elon AgentOS Mini-App Bridge Design

## Goal

Make Bankrupt Elon Musk an AgentOS-capable INJ Pass mini-app. A user can mention
`@Bankrupt Elon Musk` in INJ Pass Chat and query the simulated account or execute
an explicit simulated buy or sell without opening the full game UI.

The integration follows the proven INJ Gift mini-app pattern:

1. INJ Pass recognizes the mentioned application and parses a deterministic
   command.
2. INJ Pass loads Elon in a hidden mini-app command runner.
3. The two applications exchange `ready`, `session`, `agent-command`, and
   `agent-command-result` messages over `injpass-miniapp-v1`.
4. Elon executes its own existing server-authoritative game APIs and returns a
   stable structured result.
5. INJ Pass formats that result for Chat.

## Repository Scope

### `bankrupt-elon-musk-next`

- Upgrade `@injpass/cli` from 2.5 to 2.7 or newer.
- Consume the INJ Pass mini-app session through `InjPassMiniAppConnector`.
- Add the AgentOS message bridge, command validation, asset resolution, session
  binding, command execution, and focused tests.
- Reuse the existing game API and server trading implementation.

### `inj-pass-frontend`

- Keep the existing hidden mini-app runner and `@Bankrupt Elon Musk` routing.
- Align the local Elon URL with the actual port.
- Complete deterministic parsing for market, account, portfolio, history,
  ranking, buy, and sell commands.
- Format all Elon command results and stable errors for Chat.
- Add command parsing, routing, correlation, and presentation tests.

### `inj-pass-backend`

No first-version changes. The backend Agent tool registry will not execute Elon
commands. Elon business rules remain owned by the Elon application.

## Existing State

INJ Pass already contains:

- a `bankrupt-elon-musk` mini-app manifest;
- deterministic Elon mention and intent parsing;
- a hidden iframe command runner;
- origin-scoped session and RPC handling;
- preliminary formatting for balance, portfolio, trade, and rank results.

Elon already contains:

- INJ Pass standalone wallet connection and message-signing login;
- `GET /api/market` for public market data;
- `GET /api/game` for the authenticated account projection;
- `GET` and `POST /api/trades` for history and authoritative execution;
- `GET /api/leaderboard` for ranking;
- UUID idempotency validation, serializable transactions, authoritative quotes,
  integer or `MAX` quantities, cash/position checks, and settlement locking.

Elon does not currently understand `injpass-miniapp-v1`, so the existing INJ
Pass hidden runner never receives a result.

## Architecture

INJ Pass is the AgentOS host and session owner. Elon is the command-owning
mini-app.

```text
INJ Pass Chat
  -> deterministic @app command parser
  -> hidden Elon iframe
  -> ready / session / agent-command
  -> Elon Agent Bridge
  -> existing Elon same-origin APIs
  -> existing server-authoritative domain services
  -> agent-command-result
  -> INJ Pass localized Chat formatter
```

The integration does not expose a database service to INJ Pass, duplicate game
rules in the host, or let AgentOS choose a price or post-trade balance.

## Mini-App Session and Identity Binding

Elon creates one `InjPassMiniAppConnector` only when
`InjPassMiniAppConnector.isEmbedded()` is true. The connector derives and
validates the host origin, sends `ready`, stores the latest host session, and
provides an origin-scoped EIP-1193 provider.

Before constructing it, Elon compares `injpass_host_origin` with the origin of
`NEXT_PUBLIC_INJPASS_EMBED_URL`. Production accepts only that exact origin.
Development additionally accepts loopback origins used by the local INJ Pass
host. A query parameter supplied by an arbitrary parent is never sufficient to
make that parent trusted.

The INJ Pass host session identifies the selected wallet but does not by itself
authorize Elon server mutations. Before the first authenticated command in a
new command-runner lifetime, Elon performs a nonce login through the host
provider:

1. Request an Elon login nonce for the session address.
2. Ask the INJ Pass host provider to `personal_sign` the exact nonce message.
3. Submit the address, wallet name, and signature to a dedicated Elon agent
   verification route.
4. Receive a short-lived AgentOS bearer token scoped to Elon game reads and
   simulated trades.
5. Keep the token in iframe memory only and reuse it for later commands in the
   same iframe.

The AgentOS token uses the existing Elon JWT secret, audience
`bankrupt-elon-agentos`, scopes `game:read` and `game:trade`, and a 15-minute
lifetime. Elon game authentication accepts either the existing
standalone `musk_session` cookie or a valid AgentOS bearer token. The bearer
path is required because production Elon runs cross-site inside INJ Pass and a
`SameSite=Lax` cookie is not a reliable hidden-iframe session mechanism.

The token is never placed in a URL, local storage, session storage, a
`postMessage`, a command result, or a log. A host wallet change clears it.

Public market search does not require an authenticated session. Balance,
portfolio, history, rank-with-current-user, buy, and sell do.

The bridge must not trust a wallet address supplied inside an `agent-command`.
It uses only the last validated host `session` and the wallet address returned by
Elon after signature verification.

Standalone Elon continues to use the existing floating INJ Pass connector.
Mini-app mode must not open a nested `/embed` connector or a second wallet flow.

## Command Protocol

The existing envelope remains unchanged:

```ts
interface ElonAgentCommand {
  appId: "bankrupt-elon-musk";
  action:
    | "open"
    | "market"
    | "balance"
    | "portfolio"
    | "history"
    | "rank"
    | "buy"
    | "sell";
  rawText: string;
  language: string;
  params: {
    query?: string;
    asset?: string;
    quantity?: string;
    limit?: number;
  };
}
```

Quantities are decimal strings at the protocol boundary. Elon accepts only a
positive integer string or the exact value `MAX`, matching the existing trade
domain. The parser maps explicit phrases such as “sell all BTC” to `MAX`.

No command may include an execution price, USD amount, cash balance, position
balance, wallet address, or idempotency key. Elon supplies those values.

## Deterministic Intent Rules

- `open`: complete the Chat host handshake without requiring a wallet.
- `market`: search assets by ID, ticker, full name, or category query.
- `balance`: return cash, holdings value, net worth, and P&L.
- `portfolio`: return the current non-zero positions and their authoritative
  market projections.
- `history`: return recent game transactions, with a limit clamped to 1–100.
- `rank`: return the current wallet rank and public top entries.
- `buy` and `sell`: require an asset expression and quantity.

Explicit complete buy and sell commands execute immediately. There is no second
Chat confirmation in version one. Missing or ambiguous input never executes:

- a missing asset returns `missing_asset`;
- a missing quantity returns `missing_quantity`;
- no asset match returns `product_not_found`;
- multiple equally valid matches return `ambiguous_asset` with a bounded list of
  candidates.

## Asset Resolution

Elon resolves assets against `GET /api/market`, using this precedence:

1. exact asset ID, case-insensitive;
2. exact ticker, case-insensitive;
3. exact full name, case-insensitive;
4. normalized full-name match;
5. bounded fuzzy candidates for clarification only.

Only one exact result can proceed to a trade. Category queries and fuzzy
results are read-only and cannot select an arbitrary first asset.

## Command Execution

The Elon bridge owns a focused command executor. It validates the command,
ensures the required session, resolves the asset, creates a UUID idempotency
key for a trade, and calls the existing client API functions.

Mappings:

| Agent action | Existing Elon operation |
| --- | --- |
| `open` | return `app_ready` |
| `market` | `getMarket()` |
| `balance` | `getGame()` |
| `portfolio` | `getGame()` |
| `history` | `getTransactions()` |
| `rank` | `getLeaderboard()` |
| `buy` | `submitTrade({ side: "BUY" })` |
| `sell` | `submitTrade({ side: "SELL" })` |

The command executor returns data-transfer objects only. React lifecycle,
message transport, parsing, API response validation, and result localization
remain separate units.

## Result Protocol

Every accepted command returns exactly one correlated message:

```ts
{
  channel: "injpass-miniapp-v1",
  type: "agent-command-result",
  id: commandId,
  result: {
    ok: boolean,
    key: string,
    data?: Record<string, unknown>,
    message?: string
  }
}
```

Success keys:

- `game_market`
- `game_balance`
- `game_portfolio`
- `game_history`
- `game_rank`
- `game_trade`

Input keys:

- `missing_asset`
- `missing_quantity`
- `ambiguous_asset`
- `product_not_found`

Domain error keys:

- `insufficient_cash`
- `insufficient_position`
- `market_locked`
- `quote_missing`
- `quote_stale`
- `asset_disabled`
- `login_required`
- `session_expired`
- `command_timeout`
- `unknown_error`

`game_trade` returns the authoritative receipt fields needed for Chat: side,
asset ID and display name, requested and executed quantity, authoritative unit
price and USD amount, post-trade cash and position quantity, transaction ID, and
creation time. It never returns secrets, JWTs, raw cookies, database URLs, or
stack traces.

## Message Security and Lifecycle

- Accept messages only when `event.source === window.parent`.
- Require the exact configured INJ Pass host origin.
- Require `channel === "injpass-miniapp-v1"`.
- Require `type === "agent-command"`, a non-empty command ID, and the exact Elon
  app ID.
- Correlate each response with the initiating command ID.
- Permit each command ID to execute only once for the iframe lifetime. Completed
  results are replayed from a bounded cache, while a separate seen-ID set keeps
  evicted IDs from executing again.
- Bound every command to 60 seconds, below the INJ Pass runner’s 180-second
  timeout.
- Remove listeners and pending state on completion, timeout, session change,
  logout, or component teardown.
- A host wallet change invalidates the cached Elon session and forces a new
  signature binding before the next authenticated command.
- A wallet change or logout aborts active fetches, rechecks the session after
  signing and before trade submission, and converts prior result cache entries
  to `session_expired` tombstones so an old command cannot execute for a new
  wallet.

## Error Handling

Protocol failures produce stable, safe results instead of uncaught errors.
Existing `GameApiError` status/code values are normalized into the result keys
above. Unknown server errors produce `unknown_error` without exposing internal
messages in production.

An ambiguous network outcome reuses the same generated idempotency key if the
executor retries the trade within that command. A timeout must not generate a
second command or a second idempotency key automatically. Chat reports that the
user should query history before retrying.

## INJ Pass Changes

The existing host runner remains the only transport. Required changes are:

- set `NEXT_PUBLIC_BANKRUPT_ELON_APP_URL=http://localhost:3002` for the current
  local topology or make the manifest fallback match the documented Elon port;
- represent quantities as strings and recognize explicit `MAX` phrases;
- add `market` and `history` intent parsing;
- add result formatting for market/history, ambiguity, missing input, quote
  failures, timeout, and session failures;
- retain the existing three-minute hidden-runner timeout and correlated result
  handling;
- accept hidden-runner messages only from the exact registered origin and the
  current hidden iframe `contentWindow`;
- do not add an Elon tool to the backend Agent registry in version one.

## Testing

### Elon tests

- mini-app mode and host-origin derivation;
- valid `ready`, `session`, and correlated command/result exchange;
- rejection of wrong source, origin, channel, app ID, and malformed command;
- initial host-session login, cached login reuse, wallet switch, and logout;
- exact asset ID/ticker/name matching and ambiguous candidate handling;
- balance, portfolio, market, history, and rank dispatch;
- buy, sell, and `MAX` dispatch using the existing client API;
- UUID idempotency generation and same-command retry reuse;
- stable mapping for every expected `GameApiError`;
- command timeout and listener cleanup;
- standalone INJ Pass wallet connection remains unchanged.

### INJ Pass tests

- multilingual `@Bankrupt Elon Musk` parsing for every supported action;
- quantities remain strings and “all” maps to `MAX`;
- missing/ambiguous inputs do not become executable trades;
- the registered local/production Elon URL is used by the hidden runner;
- command ID correlation, timeout, abort, and iframe cleanup;
- localized formatting for every success and stable failure key.

### Verification

- focused test suites in both repositories;
- full unit test suites;
- TypeScript checks;
- production builds;
- browser verification with INJ Pass, Elon, and the Elon database running:
  query market, sign in through the host session, query balance and portfolio,
  buy an exact asset, query history, sell it, and verify the visible Elon UI
  shows the same server state.

## Acceptance Criteria

1. `@Bankrupt Elon Musk 查询 TSLA` returns matching authoritative market data.
2. `@Bankrupt Elon Musk 查看余额/持仓/历史/排名` returns data for the current
   INJ Pass wallet.
3. An explicit buy or sell mutates the same Elon account shown by the visible
   game and returns an authoritative receipt.
4. Missing or ambiguous commands never trade.
5. Repeated delivery or a transient retry cannot create a duplicate trade.
6. Wallet switching cannot execute against the previous wallet’s Elon session.
7. Wrong-origin pages cannot send commands or receive session data.
8. Standalone Elon wallet connection and normal UI trading continue to work.
9. INJ Pass backend contains no duplicated Elon trading implementation.

## Non-Goals

- LLM-generated Elon tool calls in the INJ Pass backend.
- Real-money or on-chain asset trading.
- Autonomous trading strategies, scheduled trades, or multi-step portfolio
  optimization.
- Letting AgentOS select an asset or quantity from ambiguous user input.
- Replacing the existing Elon API, database schema, pricing refresh, or wallet
  connector UI.
