# Architecture decisions

One file per decision that cost an argument, has a real trade-off, or would
otherwise be re-litigated every few months. Short-lived or obvious choices go
in the TASKS decisions log instead; a decision here is one a future reader
would want the reasoning for, not just the outcome.

Format: context, the decision, the trade-off accepted, and what would make us
revisit it. Numbered, never renumbered, superseded rather than edited.

| ADR | Decision |
|---|---|
| [0001](0001-supply-chain-verification.md) | Where each supply-chain check runs |
| [0002](0002-immutability-enforcement.md) | Immutability is enforced in three layers |
| [0003](0003-windowed-each-recycles-rows.md) | A windowed `each` recycles rows, and the caller supplies the window |
| [0004](0004-resource-has-no-shared-cache.md) | `resource()` owns its value; `staleAfter` revalidates on a timer |
| [0005](0005-checker-on-typescript-7.md) | The checker targets TypeScript 7's unstable API rather than a second compiler |
