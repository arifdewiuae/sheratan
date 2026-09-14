# Sheratan — Eval Task Set v1

> **Status: FROZEN — v1, 2026-09-14.** Approved by the owner and tagged
> `eval-tasks-v1`; the SHA-256 of this file is recorded in `Docs/TASKS.md`.
> After the tag, this file changes only by a new version (`v2`), never in place,
> and every published result names the version it ran against.
>
> Written 2026-09-14, **before any runtime exists** (EVAL §2.1). Nothing here
> may be edited after seeing a Sheratan run.

---

## 1. Rules of the set

### 1.1 Framework-neutral by construction

Every task is specified as **observable product behaviour**, never as an API.
The hidden tests are browser end-to-end tests (Playwright) that talk only to:

- the **DOM**, through `data-testid` hooks named in the task prompt, and
- the shared **fake backend** (§1.3), through its control and inspection API.

The same hidden suite runs unchanged against both arms. A test that would need
to know which framework it is testing is a bug in the test.

### 1.2 Arms

| Arm | Stack | "Checker clean" means |
|---|---|---|
| **Sheratan** | `sheratan create` scaffold, Sheratan docs in context | `sheratan check` → 0 errors |
| **Control** | Vite + React 19 + TanStack Query v5 + Zustand, same scaffold shape | `eslint` (recommended + react-hooks) and `tsc --noEmit` → 0 errors |

Pass for a task = **all hidden tests green AND checker clean**.

### 1.3 Fake backend (`evalkit`)

One deterministic server used by every task and both arms. Built in Week 0,
frozen with the harness.

- **HTTP** under `/api/*`: customers, orders, session. Seeded fixture data.
- **WebSocket** `/ws/prices`: seeded price generator, configurable rate.
- **Control API** (`/__control/*`, tests only): set latency per route, fail the
  next N requests with a status, reverse response order, drop the socket,
  expire the session, reset.
- **Inspection API** (`/__inspect/*`, tests only): requests received, requests
  aborted by the client before response, currently open socket subscriptions.

Agents may read the public `/api` and `/ws` contract (§5). They never see the
control or inspection API, or the tests.

### 1.4 Iteration protocol

1. The agent works with a shell and file edits. It may run the dev server,
   its own tests and the checker/linter as often as it likes.
2. When the agent declares the task done, the harness runs the hidden suite
   and the checker. **That is one iteration.**
3. On failure the agent receives: the full checker/linter output, and the
   **names** of failing hidden tests (not their bodies).
4. Cap: **10 iterations.** Not converging is a recorded outcome.
5. 5 seeds per task per arm. Report median and IQR (EVAL §2.1–2.2).

### 1.5 Prompt budget — fixed now

- **8,000 tokens of documentation per arm**, counted with the evaluated
  model's own token counter, identical system prompt otherwise.
- Sheratan arm: `llms.txt` (≤ 8,000 by SPEC §10).
- Control arm: a curated 8,000-token document covering TanStack Query,
  Zustand, and the project's folder conventions, written **before** the first
  run and committed with the harness.
- Model, model version and date are recorded per run; both arms use the same.

### 1.6 Tags

- **parity** — the control arm has a mature, idiomatic answer (a library or
  React itself). Sheratan should not lose these.
- **differentiator** — SPEC claims a specific advantage here (live data,
  ownership, atomic transitions, cross-module signals).
- **greenfield** — starts from the scaffold. **brownfield** — starts from the
  base app (§4).

Balance: **7 parity, 5 differentiator.** The set leans away from the claim on
purpose.

---

## 2. Headline, held-out and Week 0 subsets — fixed now

| Subset | Tasks | Selection rule |
|---|---|---|
| **Headline (6)** | T01, T03, T04, T05, T07, T10 | 3 parity + 3 differentiator; covers read, write and live data; ≥ 1 brownfield |
| **Held-out (6)** | T02, T06, T08, T09, T11, T12 | Everything else. Not run for the headline; reported separately if run at all |
| **Week 0 gate (3)** | T01, T03, T04 | Headline tasks only; all **parity**; all solvable with signals, templates and plain `fetch` in effects (no `resource`, `stream` or router), so the 200–300-line runtime is sufficient |

The Week 0 trio is deliberately the least flattering choice: three tasks where
React is strongest and Sheratan's differentiators don't apply.

---

## 3. Tasks

Each prompt block is the **verbatim text the agent receives**, after the shared
system prompt and the budgeted docs.

---

### T01 — Customer list with loading and error states
`parity` · `greenfield` · headline · Week 0

> Build a Customers page at the app root. Fetch `GET /api/customers` and show
> the results in a table with columns Name, Company and Country
> (`data-testid="customer-row"` per row). While loading, show
> `data-testid="loading"`. If the request fails, show
> `data-testid="error"` with a Retry button (`data-testid="retry"`) that
> fetches again. Only one of loading, error or the table is visible at a time.

Hidden tests:
- With 800 ms latency, `loading` is visible before rows appear, then disappears.
- Renders exactly the fixture's 25 rows, in server order, with correct cells.
- Next request fails with 500 → `error` shown, no rows, no `loading`.
- Retry after a failure → exactly one new request, then rows render.
- Never two of `loading` / `error` / table visible in the same frame (DOM sampled on every mutation).

---

### T02 — Search with out-of-order responses
`parity` · `greenfield` · held-out

> Add a search box (`data-testid="search"`) above the customers table. Typing
> filters via `GET /api/customers?q=<text>`. The table must always show the
> results for the text currently in the box. Don't send a request for an empty
> box — show all customers instead.

Hidden tests:
- Server reverses response order; typing `a`, `ab`, `abc` quickly → final rows match `abc`, and rows for `a` or `ab` never render after `abc`'s arrive.
- Superseded in-flight requests are aborted (inspection: aborted count ≥ 1 in the race scenario).
- Clearing the box shows all 25 customers with no request for `q=`.

---

### T03 — Create order form with validation
`parity` · `greenfield` · headline · Week 0

> Add a New Order form (`data-testid="order-form"`) with Customer (select from
> `/api/customers`), Quantity (integer 1–1000) and Note (optional, max 200
> chars). Submit with `POST /api/orders`. Show a field error under each invalid
> field (`data-testid="error-<field>"`) before sending. Disable the submit
> button (`data-testid="submit"`) while the request is pending. If the server
> returns 422 with `{ errors: { field: message } }`, show those messages on the
> matching fields. On success, clear the form and show
> `data-testid="created"` containing the new order id.

Hidden tests:
- Invalid quantity (0, 1001, 2.5, empty) → field error, no request sent.
- Valid submit → exactly one POST with the correct body; submit disabled until response.
- Double-click submit → still exactly one POST.
- Server 422 on `quantity` → server message shown under quantity; other fields keep their values.
- Success → form reset, `created` shows the id from the response.

---

### T04 — Optimistic status toggle with rollback
`parity` · `greenfield` · headline · Week 0

> Show the orders list from `GET /api/orders` (`data-testid="order-row"`), each
> with a status badge (`data-testid="status"`) and a Mark Shipped button
> (`data-testid="ship"`). Clicking it must update the badge to `shipped`
> immediately, then send `PATCH /api/orders/:id {status:"shipped"}`. If the
> request fails, put the badge back to its previous value and show
> `data-testid="toast"` with the server's error message.

Hidden tests:
- Badge reads `shipped` before the PATCH response arrives (800 ms latency).
- PATCH fails with 409 → badge reverts to the original status; toast shows the message.
- Two different orders shipped concurrently, one fails → only that one reverts.
- After success, reloading the list shows `shipped` (no stale overwrite from an earlier list response).

---

### T05 — Live price ticker with connection status
`differentiator` · `greenfield` · headline

> Build a Prices panel. Subscribe to `ws://…/ws/prices` (message format in the
> API contract). Show one row per symbol (`data-testid="price-<SYMBOL>"`) with
> the last price and change since the first price you received. Show a
> connection indicator (`data-testid="conn"`) reading `live`, `reconnecting`
> or `stale`. Reconnect automatically with backoff when the socket drops. Mark
> it `stale` if no message arrives for 3 seconds while connected.

Hidden tests:
- At 1,000 msg/s across 20 symbols for 10 s, then paused: every row shows the server's last price within 250 ms of the pause.
- During the flood, text updates per row stay ≤ 70 per second (MutationObserver count). The screen can't show more; writing more is wasted work.
- Server drops the socket → `conn` shows `reconnecting` within 1 s, then `live` after it recovers; exactly one open subscription afterwards.
- Server stays connected but silent for 3 s → `stale`.

---

### T06 — Order detail panel on the dashboard
`parity` · `greenfield` · held-out

> Clicking an order row (`data-testid="order-row"`) opens a detail panel
> (`data-testid="order-detail"`) beside the list on the same page, loading
> `GET /api/orders/:id`. Clicking another row replaces the panel's content.
> While loading, the panel shows `data-testid="detail-loading"`; if the order
> doesn't exist (404), it shows `data-testid="not-found"`. A Close button
> (`data-testid="close-detail"`) hides the panel. No URL changes are needed.

Hidden tests:
- Click order 7 → panel shows order 7's fields; the list stays visible and interactive.
- Click orders 1 → 2 → 3 quickly (1 s latency) → panel shows order 3 only; earlier requests aborted (inspection).
- Close the panel while its request is in flight → the request is aborted and nothing renders afterwards.
- Order 9999 → `not-found`, no error state elsewhere on the page.
- Open, close, reopen the same order → panel content correct each time.

---

### T07 — Session expiry across independent features
`differentiator` · `greenfield` · headline

> The app has three independent features on one page: Customers (T01-style
> list), Orders (list refreshed every 5 s) and Prices (live socket). Any
> `/api/*` response of 401, or a `session_expired` socket message, means the
> session is over. When that happens, everywhere at once: show
> `data-testid="session-expired"`, stop the Orders refresh, close the price
> socket, and disable every action button. A Sign In button
> (`data-testid="sign-in"`) calls `POST /api/session` and resumes all three
> features.

Hidden tests:
- Expire the session via a 401 on the Orders refresh → banner visible; within 6 s no further `/api/orders` requests; open socket subscriptions = 0.
- Expire via socket message → same end state.
- Sign In → one POST; Orders refresh resumes; exactly one socket subscription; buttons enabled.
- Repeating expire/sign-in 5 times leaves exactly one refresh timer and one subscription (request rate and inspection count).

---

### T08 — Live 500-row table: sort, filter, selection
`differentiator` · `greenfield` · held-out

> Show all 500 instruments from `GET /api/instruments` in a table
> (`data-testid="inst-row"`), with prices updated live from `/ws/prices`.
> Clicking a column header sorts by it (toggle asc/desc). A filter box
> (`data-testid="filter"`) matches symbol or name. Clicking a row selects it
> (`aria-selected="true"`); selection survives price updates, sorting and
> filtering.

Hidden tests:
- Sort by price desc under a 500 msg/s feed → after pausing, order is correct.
- Selected row stays selected through 10 s of updates and a re-sort.
- Filter to 3 rows → updates for filtered-out symbols cause no row mutations.
- Row DOM nodes are reused across price updates (node identity preserved for unchanged keys).

---

### T09 — Cached pagination
`parity` · `brownfield` · held-out

> The orders list currently loads everything at once. Change it to pages of 20
> with Next/Previous buttons (`data-testid="next"`, `data-testid="prev"`)
> using `GET /api/orders?page=N`. Going back to a page you've seen in the last
> 30 seconds must show it instantly and refresh it in the background. After
> 30 seconds, show a loading state instead.

Hidden tests:
- Page 1 → 2 → 1 within 30 s → page 1 rows visible with no `loading`, and one background request made.
- Background refresh returns changed data → rows update in place.
- Page 1 → wait 31 s (clock control) → page 1 shows `loading` first.
- Rapid Next ×3 → only the final page's rows render.

---

### T10 — Fix a subscription leak (bug report only)
`differentiator` · `brownfield` · headline

> Users report that after opening and closing the price detail panel many
> times, the app gets slower and the network tab shows more and more socket
> traffic. Find and fix the cause. Don't change how the panel looks or behaves.

Base app: the detail panel (`data-testid="price-detail"`, toggled by
`data-testid="toggle-detail"`) subscribes to a symbol channel on open and fails
to unsubscribe on close. The planted bug is behaviourally identical in both
arms' base apps (§4).

Hidden tests:
- Open/close the panel 50 times → inspection shows ≤ 1 open symbol subscription.
- Panel still shows live prices when open.
- All pre-existing base-app tests still pass.

---

### T11 — Fix inconsistent totals (bug report only)
`differentiator` · `brownfield` · held-out

> Users see the order total in the header briefly show a wrong number right
> after the dashboard loads, then correct itself. Fix it so the header total
> is never wrong.

Base app: orders and discounts are fetched in parallel and applied to state in
two separate updates, so the header renders a total with orders but without
discounts for one frame.

Hidden tests:
- DOM sampled on every mutation from navigation to settled: the header total always equals Σ(order) − Σ(discount) of the data then shown, or is absent.
- 20 reloads with randomized per-route latency → zero inconsistent samples.
- All pre-existing base-app tests still pass.

---

### T12 — Accessible edit-notes dialog
`parity` · `greenfield` · held-out

> Each customer row gets an Edit Notes button (`data-testid="edit-notes"`)
> that opens a modal dialog with a textarea and Save / Cancel. It must be
> keyboard accessible: focus moves into the dialog on open, Tab stays inside
> it, Escape closes it, and focus returns to the button that opened it. Save
> sends `PUT /api/customers/:id/notes` and closes on success; on failure it
> stays open with `data-testid="dialog-error"`.

Hidden tests:
- Open via keyboard → focus is in the textarea; Tab ×10 never leaves the dialog.
- Escape closes; focus returns to the originating button.
- Save → one PUT with the text; dialog closes; reopening shows the saved text.
- PUT fails → dialog stays open, error shown, text preserved.
- axe-core: no violations in the open dialog.

---

## 4. Brownfield base app

T09, T10 and T11 start from a small base app: Customers, Orders and Prices,
roughly T01 + T04 + T05.

- The **base app's behaviour is frozen now** by its own test suite
  (`base.spec.ts`), written alongside the task tests.
- The **control arm base app** is written in Week 0.
- The **Sheratan arm base app** can only be written once the runtime exists.
  Before any brownfield run it must pass `base.spec.ts` and `sheratan check`,
  and reproduce the planted bug under the T10 and T11 tests.

**Known risk, stated rather than hidden:** the Sheratan base app is written
after the runtime, by people who know the runtime. The frozen behavioural suite
and identical planted-bug tests are the mitigation. Both base apps are
committed and published with the results.

---

## 5. Self-repair sub-eval — the Week 0 gate (EVAL §2.3)

- **Host files:** the reference solutions to T01, T03 and T04, plus the T04
  effects file — 4 working files.
- **Violation classes (3):** I/O inside a view; direct state write from
  effects; deep import of another module's internals.
- **Cases:** 3 classes × 4 hosts = **12 cases**, × 5 seeds = **60 runs**.
- **Input to the agent:** the file tree and the structured checker JSON only
  (hand-written in Week 0, in the SPEC §8 shape). No task prompt, no docs
  beyond the budget.
- **Pass (per run):** after exactly one turn, the checker is clean **and** the
  host task's hidden tests still pass.
- **Gate:** ≥ 48 / 60 (80%).

---

## 6. API contract (visible to agents)

Committed with the harness as `evalkit/CONTRACT.md` and included in every
task's context **outside** the doc budget, identically for both arms:
resource shapes for customers, orders, instruments, session; error body
`{ error: string }` and 422 body `{ errors: Record<string,string> }`; socket
messages `{ type: "price", symbol, price, ts }` and
`{ type: "session_expired" }`.

---

## 7. Decisions at freeze

Owner decisions taken before the tag, 2026-09-14.

- **Doc budget:** 8,000 tokens per arm (§1.5).
- **No router in either arm.** The set measures a single-page heavy dashboard;
  T06 is an in-page detail panel, not a route. The control stack stays exactly
  as EVAL §2.1 defines it. Consequence, stated: Sheratan's core routing
  (`location`, `match()`, `navigate()`) is not evaluated by this set.
- **Clock control for T09:** Playwright's clock API; both arms may read time
  only through `Date` / `performance`.
- **T05 update-rate assertion (≤ 70 text writes/s per row) is kept** as a
  declared differentiator. Results tables mark it as such, so a reader can
  discount it.
- **Headline and Week 0 subsets** confirmed as listed in §2.
