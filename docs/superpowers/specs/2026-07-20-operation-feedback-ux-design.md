# Operation Feedback UX Design

**Date:** 2026-07-20

## Goal

Make every meaningful operation visibly acknowledge the click, communicate progress, and confirm success or failure. Trading must no longer look unchanged after a successful request.

## Feedback Model

`GameProvider` owns one operation lifecycle:

```text
idle → pending → success | error → dismissed
```

The operation records its kind (`trade`, `reset`, `login`, `logout`, or `refresh`), target asset when applicable, trade side, quantity, and a monotonically increasing event ID. Existing `pendingCommand` remains available for compatibility, while the richer operation state drives targeted visual feedback.

Success and error feedback remain visible for approximately 3.5 seconds and can be manually dismissed. A new operation replaces an older toast. Authentication expiration remains persistent rather than auto-dismissing.

## Layer 1: Immediate Control Feedback

- The clicked trade confirmation button immediately becomes disabled.
- Its label changes to `买入处理中…` or `卖出处理中…` and includes a small spinner.
- Direct actions such as `买爆` and `清仓` show the pending state on the clicked asset card.
- Login, logout, reset, and refresh controls use equivalent operation-specific pending copy.
- Other mutation controls remain disabled during the authoritative request, but only the initiating control receives the spinner and pending label.

This feedback begins synchronously before awaiting the API, so even a fast request visibly acknowledges the click.

## Layer 2: Contextual Card Feedback

- While pending, the target asset card receives a subtle accent outline and progress sheen.
- On success, the trade ticket closes automatically.
- The target card briefly flashes green and its owned badge performs a restrained scale animation.
- On failure, the card briefly flashes red, the ticket remains open, and the entered quantity remains unchanged.
- The card animation is keyed by operation event ID so repeated trades on the same asset retrigger correctly.

Reset success briefly highlights the portfolio panel rather than an asset card. Login success transitions to the authenticated portfolio using the existing view replacement.

## Layer 3: Global Toast

A fixed toast stack appears in the upper-right content area without blocking controls.

Trade success includes:

- `买入成功` or `卖出成功`;
- asset display name or ticker;
- executed quantity;
- USD amount when supplied by `TradeReceipt`.

Other success messages include login completed, account reset, logout completed, and prices refreshed.

Errors use the localized existing error text and a red treatment. The toast has an accessible dismiss button, `role="status"` for success, `role="alert"` for errors, and does not duplicate the current unstyled global error paragraph.

## State and Data Flow

1. The initiating action creates a pending operation synchronously.
2. The UI derives button and card pending states from that operation.
3. A successful trade receipt updates account state and emits a success event with receipt details.
4. The matching open trade ticket closes.
5. The card flash and toast render from the same event.
6. A failed request emits an error event, preserves the ticket, and retains existing account state.
7. A timer dismisses transient feedback; the event ID prevents an old timer from dismissing a newer event.

## Components

- `GameProvider`: operation lifecycle, event IDs, dismissal action, and trade result metadata.
- `OperationToast`: accessible global feedback presentation.
- `ProductCard` and `TradeTicket`: targeted pending labels, ticket close behavior, and card feedback classes.
- `PortfolioPanel`: reset-success highlight.
- `GameShell`: toast host and removal of the duplicate plain error paragraph.
- `globals.css`: spinner, pending sheen, success/error flashes, toast transitions, and reduced-motion overrides.

## Error Behavior

- API failures never close the ticket.
- Quantity input and selected fractions remain intact after failure.
- A failed trade never animates holdings as successful.
- Authentication expiration still clears private state and shows a persistent re-authentication message.
- Repeated clicks remain blocked by the existing synchronous mutex.

## Accessibility and Motion

- Pending copy is visible text, not spinner-only.
- Toast changes are announced through ARIA live regions.
- Focus remains on the initiating control; the toast does not steal focus.
- Color is supplemented by icons and text.
- `prefers-reduced-motion: reduce` disables sheen, pulse, bounce, and slide animations while retaining state colors and labels.

## Testing

- Provider tests cover pending, success, error, replacement, dismissal, and stale timer protection.
- Product card tests verify pending button copy, success auto-close, failure preservation, and targeted card classes.
- Toast tests verify receipt details, localized error text, dismissal, timeout, and ARIA roles.
- Reset and login tests verify operation-specific feedback.
- Existing mutex, exact quantity, account update, authentication, and error tests remain green.
- Production build and browser verification cover desktop and narrow layouts.

## Acceptance Criteria

- Every mutation acknowledges a click immediately.
- Successful trades visibly confirm completion without requiring the user to inspect the balance.
- Failed trades preserve the user's input and clearly explain the failure.
- Feedback identifies the affected asset and operation.
- Repeated actions retrigger feedback reliably.
- Motion remains usable for reduced-motion users.
