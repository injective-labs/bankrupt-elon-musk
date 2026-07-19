# Server-Authoritative Game Data Design

**Date:** 2026-07-19

## Objective

Refactor the game so an INJ Pass signature-authenticated wallet is required before play, Supabase PostgreSQL is the sole durable source of player and market data, every trade commits to the database before the UI reports success, and the implementation contains only the cash-based mechanics represented by the current UI/UX.

The implementation remains inside the existing Next.js project and Vercel deployment. It does not introduce a separate backend service or project.

## Product Rules

- A player must connect INJ Pass and prove wallet ownership by signing a nonce.
- A wallet receives USD 50,000,000,000 only when its `Player` row is created for the first time.
- Returning wallets load their existing cash, positions, transactions, and computed metrics.
- Supabase PostgreSQL is authoritative. React state is only an in-memory view of server responses.
- The app must not persist cash, positions, transactions, prices, or anonymous game accounts in `localStorage`.
- A trade is shown as successful only after its database transaction commits.
- The client submits trade intent only; it never supplies an authoritative price, balance, position, net worth, or P&L.
- Leverage, debt, borrowing, interest, LTV, liquidation, and their hidden state are removed.
- Reset remains available for testing and is controlled by `ENABLE_GAME_RESET=true`.

## Authentication and Session

The existing nonce/signature flow is retained and completed:

1. The client connects INJ Pass and obtains a wallet address.
2. `POST /api/auth/nonce` creates a one-time challenge.
3. The wallet signs the exact challenge.
4. `POST /api/auth/verify` verifies the signature and issues a seven-day JWT in a Secure, HttpOnly, SameSite=Lax cookie.
5. Verification creates the `Player` with the starting balance if it does not exist; otherwise it updates `walletName` and `lastLoginAt` without changing the balance.
6. `GET /api/auth/session` restores a valid cookie session and returns the authenticated wallet identity.
7. `POST /api/auth/logout` clears the cookie and the client clears private in-memory state.

All private APIs derive the wallet address from the verified cookie. They never trust a wallet address supplied in a query string or request body.

## Database Model

Monetary values use PostgreSQL `Numeric` through Prisma `Decimal`, not floating point. Money uses `Decimal(30,8)` and prices, rates, and quantities use `Decimal(30,12)`.

### Player

- `walletAddress` primary key
- `walletName`
- `cash`
- `createdAt`
- `updatedAt`
- `lastLoginAt`

The old debt, interest, liquidation, leverage, client-supplied net-worth snapshot, and UI preference fields are removed.

### Position

- `id`
- `walletAddress` foreign key to `Player`
- `assetId` foreign key to `Asset`
- `quantity`
- `costBasis`
- `createdAt`
- `updatedAt`
- unique constraint on `(walletAddress, assetId)`

Positions with zero quantity are deleted.

### Transaction

An immutable ledger containing `BUY`, `SELL`, and `RESET` entries:

- `id`
- `walletAddress`
- `idempotencyKey`, unique with `walletAddress`
- `type`
- nullable `assetId` for reset entries
- `quantity`
- `nativePrice`
- `currency`
- `fxRateToUsd`
- `usdUnitPrice`
- `usdAmount`
- `cashBefore`, `cashAfter`
- `quantityBefore`, `quantityAfter`
- `costBasisBefore`, `costBasisAfter`
- nullable `marketDate`
- `createdAt`

The legacy text `TradeLog` is retained temporarily as unmigrated historical information but receives no new writes.

### Asset

The current 160 tradable frontend assets are seeded into the database:

- `id`
- `ticker`
- `quoteSymbol`
- `nameZh`, `nameEn`
- `assetClass`, `subCategory`
- `currency`, `unit`
- `quoteMultiplier`
- `enabled`
- `displayOrder`
- timestamps

The database asset catalogue becomes the runtime source of truth. The checked-in catalogue remains the deterministic seed source.

### AssetQuote

One latest quote per asset:

- `assetId` primary key
- `nativePrice`
- `currency`
- `fxRateToUsd`
- `usdPrice`
- `marketDate`
- `source`
- `status`: `ACTIVE`, `STALE`, or `ERROR`
- `fetchedAt`, `updatedAt`

### AssetDailyPrice

Daily history begins on deployment of this version; there is no backfill:

- `id`
- `assetId`
- `marketDate`
- nullable `open`, `high`, `low`
- `close`
- `currency`
- `fxRateToUsd`
- `usdClose`
- `source`
- `fetchedAt`
- unique constraint on `(assetId, marketDate)`

Repeated refreshes for the same asset and market date use upsert and do not add duplicates.

## API Boundaries

### Authentication

- `POST /api/auth/nonce`
- `POST /api/auth/verify`
- `GET /api/auth/session`
- `POST /api/auth/logout`

### Game

- `GET /api/game` returns the authenticated player, positions, server-computed metrics, asset catalogue, quote freshness summary, and current market lock state.
- `POST /api/trades` accepts `assetId`, `side`, positive integer `quantity`, and an idempotency key.
- `GET /api/trades` returns cursor-paginated immutable transaction history.
- `POST /api/game/reset` resets the authenticated account only when `ENABLE_GAME_RESET=true`.
- `GET /api/leaderboard` returns server-computed loss rankings and the caller's rank.

Decimal values are serialized as strings at API boundaries.

## Trade Execution

A trade runs as one database transaction and locks or otherwise serializes mutation of the authenticated player's account:

1. Verify session and settlement window.
2. Validate that the asset is enabled and the quantity is a positive integer.
3. Read the authoritative `AssetQuote` and enforce quote freshness.
4. Read the player and position.
5. Validate sufficient cash or position quantity.
6. Calculate the trade with Prisma Decimal arithmetic.
7. Update `Player` and `Position`.
8. Insert the immutable `Transaction` entry.
9. Commit and return a fresh account projection.

The unique idempotency key prevents duplicate execution. The UI disables the submitting control, but server-side idempotency and transaction serialization remain authoritative.

Buy calculations increase cost basis by USD notional. Sell calculations use average cost. Selling the full quantity deletes the position. Net worth is cash plus current USD position value; total P&L is net worth minus USD 50,000,000,000 for the current test game.

Reset deletes all positions, sets cash to the starting balance, and adds a `RESET` transaction with before/after values. Historical transactions remain. Before production, reset can be disabled by setting `ENABLE_GAME_RESET=false`.

## Market Data

Yahoo Finance remains the upstream source. Only server code contacts it.

A protected route in the same application, `GET /api/cron/refresh-market`, requires `Authorization: Bearer <CRON_SECRET>` and runs once daily. It reads enabled assets, fetches quotes in bounded batches, resolves currency conversion, upserts `AssetDailyPrice`, and updates `AssetQuote`.

No pre-launch history is requested or stored. Each asset records the latest completed market date returned by Yahoo, which may differ across exchanges and time zones.

Failure of one quote does not abort successful assets. The last valid quote remains, its state becomes stale/error, and the failure is reported. Quotes no older than seven calendar days remain tradable and visibly show their market date; older or nonexistent quotes block trades. Weekends and exchange holidays therefore use the most recent valid close.

The browser no longer fans out 160 `/api/chart` requests. The old public chart proxy is removed or made internal once the scheduled refresh path is operating.

## Client State and UX

The initial game view is locked and contains no locally-created USD 50 billion balance. It presents the INJ Pass login action and explains that signature login is required.

After authentication, the client requests `/api/game` and displays only returned account data. During a trade, the relevant control is disabled. Success replaces the in-memory account projection with the API response; failure preserves the previous projection and shows a specific message.

The anonymous wallet, debounced full-state cloud upload, cloud/local merge logic, and game `localStorage` persistence are removed. UI-only language, sound, filters, and sorting may reset on reload in this scope; they are not mixed into authoritative financial state.

The visible mechanics retained are cash buy, buy-max, sell, sell-all, quantity fractions, search, categories, sorting, portfolio, P&L, loss leaderboard, settlement window, language, sound, and test reset.

## Leaderboard

The service computes rankings from database cash, positions, and authoritative latest quotes. The client cannot submit P&L or net worth. Lowest P&L ranks first. The response includes the top rows and the authenticated player's rank.

For the current catalogue size, exact query-time computation is acceptable. A later materialized snapshot may be introduced only if measured performance requires it.

## Error Contract

- `401`: missing or expired authenticated session
- `403`: reset disabled or operation forbidden
- `404`: asset does not exist
- `409`: idempotency or concurrent-state conflict
- `422`: invalid quantity, insufficient cash/position, stale quote, or settlement lock
- `503`: database or market dependency unavailable

Failed mutations never change the displayed financial state. Retrying the same idempotency key never executes a second trade.

## Migration and Deployment

The migration preserves existing players' cash and valid positions while discarding obsolete leverage/debt semantics from the new model. It creates the new tables, constraints, indexes, and Decimal columns, and seeds exactly the current 160 tradable assets. Legacy text logs remain available but disconnected from the new ledger.

Required Vercel variables:

- `DATABASE_URL`
- `JWT_SECRET`
- `CRON_SECRET`
- `ENABLE_GAME_RESET=true` during testing
- `NEXT_PUBLIC_INJPASS_EMBED_URL`

No browser-visible Supabase URL or publishable key is required because the browser does not access the database directly.

## Verification

Automated tests cover authentication gates, one-time initial funding, returning-wallet restoration, protected APIs, buy/sell accounting, insufficient funds/positions, buy-max and sell-all server calculation, idempotency, concurrent mutation safety, quote freshness, settlement lock, immutable transactions, reset, daily quote upsert, partial upstream failure, server-computed leaderboard, reload synchronization, logout clearing, and removal of local game persistence and leverage concepts.

Deployment verification includes applying the migration to the test Supabase project, seeding 160 assets, running the first non-backfill market refresh, signing in with a new and returning INJ Pass wallet, executing and reloading a trade, checking its ledger row, and confirming a failed database write never appears as a successful UI trade.
