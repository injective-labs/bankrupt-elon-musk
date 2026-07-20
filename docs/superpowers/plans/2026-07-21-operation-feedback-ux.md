# Operation Feedback UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add immediate pending feedback, contextual success/error card feedback, and accessible global toasts for user operations.

**Architecture:** `GameProvider` emits typed operation events with a unique ID and optional trade receipt. `ProductCard`, `TradeTicket`, and a new `OperationToast` render three synchronized feedback layers from that state. CSS provides restrained animations with reduced-motion fallbacks.

**Tech Stack:** React 19, Next.js 16, TypeScript 5, Vitest, Testing Library, CSS.

## Global Constraints

- Preserve the existing synchronous mutation mutex.
- Do not close a trade ticket on failure.
- Do not introduce an animation dependency.
- Use localized visible pending and result text.
- Support `prefers-reduced-motion`.
- Do not commit until verification passes.

---

### Task 1: Provider Operation Lifecycle

**Files:**
- Modify: `src/state/GameProvider.tsx`
- Modify: `src/state/GameProvider.test.tsx`
- Modify: `src/types/index.ts`

- [ ] Add failing tests for targeted pending trade state, success receipt metadata, error state, dismissal, and unique event IDs.
- [ ] Run `pnpm exec vitest run src/state/GameProvider.test.tsx` and confirm failure.
- [ ] Add `OperationFeedback`, `pendingOperation`, `feedback`, and `dismissFeedback`.
- [ ] Emit pending synchronously and success/error after each operation.
- [ ] Re-run the focused test and confirm success.

### Task 2: Accessible Global Toast

**Files:**
- Create: `src/components/OperationToast.tsx`
- Create: `src/components/OperationToast.test.tsx`
- Modify: `src/components/GameApp.tsx`
- Modify: `src/i18n/strings.ts`

- [ ] Add failing tests for success details, localized errors, close control, and ARIA roles.
- [ ] Run the toast test and confirm failure.
- [ ] Implement the toast and remove the duplicate unstyled global error paragraph.
- [ ] Re-run the toast test and confirm success.

### Task 3: Targeted Card and Ticket Feedback

**Files:**
- Modify: `src/components/ProductCard.tsx`
- Modify: `src/components/ProductCard.test.tsx`
- Modify: `src/components/MarketPanel.tsx`

- [ ] Add failing tests for pending labels, target classes, success close, and failure preservation.
- [ ] Run the card tests and confirm failure.
- [ ] Render initiating-control pending labels and card state classes.
- [ ] Close a matching ticket only after a success event.
- [ ] Re-run card tests and confirm success.

### Task 4: Motion, Layout, and Verification

**Files:**
- Modify: `app/globals.css`

- [ ] Add spinner, sheen, toast, success/error flash, badge pulse, and responsive styles.
- [ ] Add reduced-motion overrides.
- [ ] Run `pnpm test`, `pnpm typecheck`, and `pnpm build`.
- [ ] Inspect the UI in a real browser at desktop and narrow widths.
- [ ] Run `git diff --check` and review the final diff.
