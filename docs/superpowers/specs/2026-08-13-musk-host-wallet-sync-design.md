# Musk Host Wallet Sync Design

## Goal

When Bankrupt Elon Musk runs inside INJ Pass, it must adopt the wallet session already selected by the INJ Pass host. An authenticated host such as `hello_1` must not be shown as disconnected inside the game.

## Source of Truth

INJ Pass owns the embedded wallet session and sends it over `injpass-miniapp-v1`. The Musk mini app must use the existing `InjPassMiniAppConnector` as the source of the address, wallet name, chain, signing provider, wallet switches, and logout events. It must not create a second floating `InjPassConnector` while embedded.

Standalone Musk keeps its current floating connector behavior.

## User States

The UI distinguishes wallet connection from game authorization:

1. Host guest: show `Connect INJ Pass`; clicking requests login from the host and waits for an authenticated session.
2. Host wallet connected but Musk game not authorized: show the host wallet name/address with `Authorize game`; clicking requests the existing Musk nonce signature through the host provider.
3. Game authorized: show the authenticated Musk account chip and portfolio.

Opening an embedded app must not request a signature automatically. A signature remains an explicit user action. Host wallet switches and logout immediately replace or clear the displayed wallet. A previously authenticated Musk cookie for another wallet must never override the current host wallet identity.

## Components

- `src/agentos/host.ts` remains the single owner/factory for the shared embedded connector.
- `src/wallet/InjPassProvider.tsx` selects the embedded connector when `InjPassMiniAppConnector.isEmbedded()` is true, subscribes to host sessions, adapts `personal_sign` results to the byte signer used by the game API, requests host login when needed, and preserves the standalone connector path.
- `src/wallet/HostWalletSessionGuard.tsx` hides cookie-backed protected UI until the first host session is known and synchronously invalidates local game state when the host logs out or changes to another wallet.
- `src/state/GameProvider.tsx` exposes a host-invalidation action that locks the local account before attempting best-effort cookie deletion, so a failed logout request cannot leave stale trading state usable.
- `src/agentos/InjPassAgentBridge.tsx` consumes the shared connector but no longer destroys it independently.
- `src/wallet/ConnectButton.tsx` renders a distinct authorization action when a host wallet is connected but the game session is still locked.

## Session and Error Handling

- Only sessions with `authenticated: true` and a non-empty address become connected wallets.
- An unauthenticated host session clears the embedded wallet UI.
- Login waits for a later authenticated host session with a bounded timeout and cleans up its listener.
- The initial host-session handshake is bounded; before it resolves, embedded protected UI is replaced with a neutral synchronization state.
- Invalid signing responses fail without creating a Musk game session.
- Host wallet identity takes precedence over a stale Musk cookie in the visible connection control; protected game state continues to require the existing Musk signature/session checks.
- A host mismatch immediately clears the in-memory game account even if the logout endpoint fails. A later authorization for the new host wallet overwrites any stale cookie.
- Connector cleanup is centralized in the wallet provider so the AgentOS bridge and UI cannot destroy each other's shared connector.

## Verification

- Provider tests prove automatic adoption, host logout, host-login waiting, and exact signing RPC parameters.
- Button tests prove `wallet connected / game locked` renders `Authorize game`, not `Connect INJ Pass`.
- Existing AgentOS tests prove command behavior remains intact.
- Type checking, production build, and focused/full test suites run before deployment.
- Browser acceptance uses an authenticated INJ Pass test session and confirms the Musk iframe displays the host wallet rather than a connect prompt.

## Scope

This changes only the Musk repository. It does not change the INJ Pass host protocol, AgentOS commands, simulated asset trading rules, database schema, or Vercel host allowlist.
