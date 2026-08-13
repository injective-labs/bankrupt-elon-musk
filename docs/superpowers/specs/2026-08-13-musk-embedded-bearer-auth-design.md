# Musk Embedded Bearer Authentication Design

## Goal

Make the visible Bankrupt Elon Musk game authenticate reliably inside the INJ
Pass cross-origin iframe without depending on third-party cookies, while keeping
the existing cookie session for standalone visits.

## Confirmed failure

Production request logs show the complete failing sequence:

1. `POST /api/auth/nonce` returns `200`.
2. `POST /api/auth/verify` returns `200` and issues `musk_session`.
3. `GET /api/game` returns `401`.

The signature is valid. The failure occurs because `musk_session` is
`SameSite=Lax`, so the browser does not send it from the Musk iframe whose
top-level site is INJ Pass. The UI then incorrectly describes every protected
`401` as an expired INJ Pass session.

## Architecture

Authentication transport is selected by runtime context:

- Standalone Musk continues to call `/api/auth/verify`, store the seven-day
  HttpOnly cookie, and use same-origin cookie requests.
- Embedded Musk calls the existing `/api/auth/agent-verify` endpoint after the
  same nonce signature. It keeps the returned 15-minute, audience-scoped bearer
  token in memory and adds it to game, trade, history, leaderboard, and reset
  requests.
- Public market requests stay anonymous.
- The bearer token is never persisted. Reloading the iframe requires explicit
  game authorization again, while the INJ Pass host wallet remains connected.
- Embedded logout or host-wallet invalidation clears only the in-memory game
  token. Standalone logout continues to clear the cookie.

The default game client becomes a small runtime facade over the existing HTTP
client. AgentOS keeps its existing independent token binding and does not share
tokens with the visible game UI.

## Authorization and errors

The existing agent token scopes remain `game:read` and `game:trade`. Reset is a
game mutation and therefore requires `game:trade` when a bearer is supplied;
cookie authentication remains accepted when no Authorization header is present.

An embedded protected-request `401` clears the in-memory bearer and becomes
`GAME_AUTH_EXPIRED`. The UI says “游戏授权已失效，请重新授权” rather than
claiming that the INJ Pass host session expired. The host wallet chip remains
connected and offers the authorization action again.

## Security

- The Musk backend never trusts an address received only through `postMessage`.
- The wallet proves address ownership by signing the server-created one-time
  nonce.
- Bearer tokens keep the existing audience, scope, and 15-minute expiry checks.
- Explicit Authorization headers never fall back to a cookie.
- No token is placed in localStorage, sessionStorage, URL parameters, or logs.
- Standalone cookie CSRF behavior is unchanged.

## Verification

Automated coverage must prove:

- embedded login uses `/api/auth/agent-verify` and sends its bearer on every
  protected visible-game request;
- standalone login still uses `/api/auth/verify` and cookies;
- embedded logout clears the bearer without calling cookie logout;
- bearer-authenticated reset uses `game:trade`;
- an embedded protected `401` clears the token and reports
  `GAME_AUTH_EXPIRED`;
- the original production sequence cannot recur after successful embedded
  verification.

