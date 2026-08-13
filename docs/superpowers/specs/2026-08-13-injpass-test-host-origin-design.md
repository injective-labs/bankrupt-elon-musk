# INJ Pass Test Host Origin Design

## Goal

Allow the deployed Bankrupt Elon Musk mini-app to run inside the official INJ Pass test frontend without weakening its production parent-origin validation.

## Current Failure

The Musk deployment uses `NEXT_PUBLIC_INJPASS_EMBED_URL=https://www.injpass.com/embed`. The AgentOS bridge therefore trusts only `https://www.injpass.com`. When `https://inj-pass-frontend-test.vercel.app` opens the mini-app, the claimed host origin is rejected with `Untrusted INJ Pass host origin`.

## Design

Keep the origin derived from `NEXT_PUBLIC_INJPASS_EMBED_URL` trusted by default. Add `NEXT_PUBLIC_INJPASS_ALLOWED_HOST_ORIGINS` as an optional comma-separated list of additional explicit HTTP(S) origins or URLs.

Production accepts a parent only when its exact origin matches either the embed URL origin or one configured additional origin. Development retains the existing HTTP loopback exception. Invalid configured URLs or non-HTTP(S) schemes fail closed.

For the deployed Musk Vercel project, configure:

```text
NEXT_PUBLIC_INJPASS_ALLOWED_HOST_ORIGINS=https://inj-pass-frontend-test.vercel.app
```

The existing `NEXT_PUBLIC_INJPASS_EMBED_URL=https://www.injpass.com/embed` remains unchanged, so the formal INJ Pass host and standalone wallet connector continue to work.

## Scope

The change affects only mini-app parent-origin validation and its configuration documentation. It does not change the AgentOS command protocol, wallet permissions, authentication tokens, simulated trading, database, or INJ Pass frontend.

## Verification

- A regression test proves the test frontend is rejected without the explicit allowlist and accepted with it.
- Tests prove unknown and malformed production origins remain rejected.
- Run focused AgentOS tests, the relevant full suite baseline, type checking, linting, and the production build.
- Deploy Musk after adding the Vercel production variable, then verify the iframe inside `inj-pass-frontend-test.vercel.app` loads from `bankrupt-elon-musk-next.vercel.app` without an origin-trust error.
