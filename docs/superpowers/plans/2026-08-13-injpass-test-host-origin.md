# INJ Pass Test Host Origin Implementation Plan

> **For agentic workers:** Execute this plan task-by-task using test-driven development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permit the official INJ Pass test frontend to host the Musk AgentOS mini-app through an explicit production allowlist while keeping all other origins rejected.

**Architecture:** Extend the existing origin authority in `src/agentos/host.ts`; do not add a second validation path. The embed URL origin remains mandatory and trusted, while one optional environment variable contributes additional exact origins.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest, Vercel

## Global Constraints

- Preserve `NEXT_PUBLIC_INJPASS_EMBED_URL=https://www.injpass.com/embed` in the deployed environment.
- Add only `https://inj-pass-frontend-test.vercel.app` to the extra Vercel production allowlist.
- Accept only exact HTTP(S) origins and fail closed on malformed configuration.
- Do not change AgentOS commands, authentication, game behavior, or database behavior.
- Produce one atomic Musk repository commit for design, plan, tests, implementation, and documentation.

---

### Task 1: Add the explicit parent-origin allowlist

**Files:**
- Modify: `src/agentos/host.test.ts`
- Modify: `src/agentos/host.ts`
- Modify: `.env.example`
- Modify: `README.md`
- Create: `docs/superpowers/specs/2026-08-13-injpass-test-host-origin-design.md`
- Create: `docs/superpowers/plans/2026-08-13-injpass-test-host-origin.md`

**Interfaces:**
- Extend `trustedInjPassHostOrigin(locationHref, nodeEnv, embedUrl, allowedHostOrigins?)`.
- Extend `getElonMiniAppConnector(locationHref?, nodeEnv?, embedUrl?, allowedHostOrigins?)`.
- `allowedHostOrigins` is an optional comma-separated string of exact HTTP(S) origins or URLs.

- [ ] **Step 1: Add failing production-origin tests**

Test that `https://inj-pass-frontend-test.vercel.app` is rejected without an additional allowlist, accepted when explicitly listed, and that malformed/non-HTTP configuration is rejected.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm test -- src/agentos/host.test.ts`

Expected: the explicit test-host acceptance case fails because the function does not yet consume a fourth argument.

- [ ] **Step 3: Implement the minimal exact-origin parser and validation**

Parse the embed URL and comma-separated additional entries into a set of normalized origins. Require `http:` or `https:` schemes. Compare the claimed parent origin to the set before applying the existing development-loopback exception.

- [ ] **Step 4: Document configuration**

Add the optional variable to `.env.example` and explain its exact-origin, comma-separated semantics in the AgentOS section of `README.md`.

- [ ] **Step 5: Verify locally**

Run:

```bash
pnpm test -- src/agentos/host.test.ts src/agentos/InjPassAgentBridge.test.tsx
pnpm typecheck
pnpm exec eslint src/agentos/host.ts src/agentos/host.test.ts
pnpm build
git diff --check
```

Expected: all commands exit 0, apart from the repository's already documented unrelated full-suite ProductCard baseline when the complete suite is sampled.

- [ ] **Step 6: Commit, integrate, configure, and deploy**

Create one commit `fix: trust the INJ Pass test host`, fast-forward it into Musk `main`, push, add the production allowlist variable to `bankrupt-elon-musk-next`, and deploy that Vercel project.

- [ ] **Step 7: Browser acceptance test**

Open Bankrupt Elon Musk from `https://inj-pass-frontend-test.vercel.app`, assert the iframe URL uses `bankrupt-elon-musk-next.vercel.app`, and confirm the console no longer reports `Untrusted INJ Pass host origin`.
