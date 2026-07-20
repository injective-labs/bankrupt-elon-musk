# Public Market Preview Design

## Goal

Let visitors understand and explore the game before authenticating. An unauthenticated visitor sees the complete market using real authoritative quotes from Supabase, but cannot create an account state, position, or transaction until INJ Pass authentication succeeds.

## User Experience

The unauthenticated page keeps the full game shell: brand header, market clock, category filters, search, sorting, and all 160 asset cards. Asset cards show the latest database-backed USD price, quote date, and freshness state.

The portfolio column becomes a guest onboarding panel instead of showing a simulated balance. It explains that connecting INJ Pass creates or restores the wallet's game account and grants the one-time USD 50 billion starting balance for a new wallet. It contains the primary connection action and a concise explanation of the game. It must not show a fabricated cash balance, position, profit, transaction history, or leaderboard rank.

Buy, buy-max, sell, and close controls remain visible on asset cards so visitors can understand the available actions. Activating any of them while unauthenticated immediately starts the existing INJ Pass connection flow. It does not open a quantity dialog, mutate browser storage, or call a trade endpoint.

After successful authentication, the client loads the wallet's authoritative account projection and replaces the guest panel with the existing cash, holdings, PnL, positions, activity, reset, and leaderboard experience. A returning wallet receives its existing database state.

## Public Market API

Add an unauthenticated, read-only `GET /api/market` endpoint. It returns only public market information:

- asset identity and display metadata;
- enabled state and display order;
- latest USD price;
- quote status and market date;
- aggregate `marketAsOf` time.

The endpoint queries `Asset` and `AssetQuote` through the server-side Prisma client. It never exposes wallet addresses, players, positions, transactions, authentication nonces, reset metadata, or internal database credentials.

The response uses a dedicated public market projection rather than reusing or fabricating an `AccountProjection`. This keeps market data independent from authenticated account data and prevents guest state from accidentally becoming tradeable state.

## Data Flow and Authority

For an unauthenticated session:

1. Session restoration reports that no authenticated cookie is available.
2. The client requests `GET /api/market`.
3. The server reads `Asset` and `AssetQuote` from Supabase.
4. The client renders the full market and the guest onboarding panel.
5. A trade control starts INJ Pass authentication.

For an authenticated session:

1. Session restoration verifies the HttpOnly JWT cookie.
2. The client requests `GET /api/game`.
3. The server returns the wallet's account, positions, transactions, and authoritative market projection.
4. Trade controls submit to authenticated `POST /api/trades` as they do today.

The database remains authoritative. No guest account, quote, holding, or transaction is stored in `localStorage`. The preview never uses mock prices. Market refresh continues to populate `AssetQuote` and `AssetDailyPrice`; the preview only reads the latest stored quote.

## Authorization Boundaries

`GET /api/market` is intentionally public and read-only. Existing account and mutation endpoints remain protected:

- `GET /api/game` requires an authenticated wallet session;
- `POST /api/trades` requires an authenticated wallet session;
- `POST /api/game/reset` requires an authenticated wallet session and the reset feature gate;
- authentication nonce and verification rules remain unchanged.

Disabling or redirecting guest controls in the browser is a usability feature, not the security boundary. Direct unauthenticated requests to mutation endpoints must continue returning `401`.

## Quote States and Failures

The public market endpoint returns enabled assets even when a quote is missing. The UI handles quote conditions explicitly:

- active: show the real stored price and market date;
- stale: show the last stored price with a stale warning;
- missing or error: show that the quote is unavailable and do not imply a price.

Guest interaction still opens authentication for assets with active quotes. Missing or errored assets remain visibly unavailable. After authentication, server-side trade validation remains responsible for rejecting missing, invalid, or stale quotes.

If the public market request fails, the page retains its shell and guest connection action, displays a localized market-unavailable message, and offers a retry. Closing or failing the INJ Pass popup returns the visitor to the same populated guest market without clearing it. A successful login replaces guest data only after the authoritative account request succeeds.

## Client State

The client state distinguishes a public market projection from an authenticated account projection. Public market loading is permitted while authentication is loading or unauthenticated. Account loading remains tied to a verified session.

Shared market presentation receives asset data through a narrow selector so the same market grid can render either the public projection or the authenticated projection without inventing account fields. Account-only components render either the guest onboarding panel or authenticated portfolio components according to authentication state.

## Testing and Acceptance Criteria

Automated tests cover:

- `GET /api/market` succeeds without a session and returns only the public schema;
- real `AssetQuote` values and freshness states are projected correctly;
- database errors produce the defined error response;
- unauthenticated rendering includes the complete market and excludes fabricated account values;
- all guest trade controls initiate INJ Pass connection and do not call the trade API;
- unauthenticated direct trade and reset calls still return `401`;
- successful authentication replaces the guest panel with the restored authoritative account;
- missing, stale, and failed quotes render their explicit states;
- a failed or cancelled connection does not remove already loaded public market data.

The feature is complete when a signed-out production visitor can browse the 160 real database-backed assets, understand the USD 50 billion starting premise, and is required to authenticate before any account or transaction is created.
