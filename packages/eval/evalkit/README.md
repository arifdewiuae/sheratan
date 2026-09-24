# `evalkit` — the deterministic fake backend

One server, used by every task and both arms (EVAL-TASKS §1.3). It exists so
that two arms are measured against exactly the same latency, the same failures
and the same numbers, and so a task that depends on a race can be made to race
on purpose rather than by luck.

```sh
pnpm --filter @sheratan/eval evalkit        # port 5178, or $EVALKIT_PORT
pnpm --filter @sheratan/eval test           # this suite, and the self-repair one
```

Unlike the rest of `packages/eval`, **this suite runs inside `pnpm check`**.
The harness spawns agents and costs money, so it stays out; a backend that
quietly stopped reversing responses would invalidate every number measured
after it, so it does not.

## Four surfaces, and who may see them

| Prefix | Who | What |
|---|---|---|
| `/api/*` | the app under test | customers, orders, session, instruments — `CONTRACT.md` |
| `/ws/prices` | the app under test | the seeded price feed |
| `/__control/*` | hidden tests only | latency, failures, response order, socket drops, session expiry, tick rate, reset |
| `/__inspect/*` | hidden tests only | requests received, requests abandoned, open sockets, drafts accepted, orders as they stand |

`CONTRACT.md` is handed to agents with every task, **outside** the documentation
budget and identically for both arms (EVAL-TASKS §6). The control and
inspection surfaces are named in no prompt and in no document an agent
receives.

## Control

`POST /__control/<command>`, JSON body, `204` on success.

| Command | Body | Effect |
|---|---|---|
| `latency` | `{ route, ms }` | that route waits `ms` before answering |
| `fail` | `{ route, status, message?, errors?, times? }` | the next `times` calls (default 1) are refused; `errors` makes a 422 carry field errors |
| `reverse` | `{ route }` | later calls answer *before* earlier ones |
| `drop` | — | closes every open price socket |
| `expire` | — | every route answers 401, and open sockets are told |
| `rate` | `{ rate }` | price ticks per second |
| `reset` | — | every knob, counter, order and price back to the start |

`route` is one of `customers`, `orders`, `createOrder`, `shipOrder`, `session`.

## Inspection

`GET /__inspect/<report>`.

| Report | Answers |
|---|---|
| `requests` | calls taken per route, refused ones included |
| `aborted` | calls whose caller gave up before the answer was written |
| `sockets` | `{ open, pushed }` |
| `drafts` | bodies `POST /api/orders` accepted, in order |
| `orders` | the orders as they now stand |
| `all` | all of the above, plus `sessionExpired` |

## What determinism means here

- **Fixture data is fixed.** 25 customers, 3 orders, 3 instruments, always the
  same, always in the same order.
- **The price walk is seeded**, and it advances **only while somebody is
  listening**. A timer ticking against an empty room would mean an app that
  connected a second later saw different numbers, and the seed would buy
  nothing.
- **`reset` puts everything back**, including the walk and the tick counter, so
  the same seed replays the same prices.
- **Reversal is by arrival order**, not by timing luck: the first caller waits
  longest. Beyond four in flight it stops adding delay, which is stated rather
  than hidden because a test racing more than four requests would silently get
  ties.

## Why the WebSocket framing is hand-written

`src/frames.ts` is about a hundred lines of RFC 6455 — enough to complete a
handshake, write text frames and notice a close. A library would be one more
dependency in a repository whose entire supply-chain policy (`minimumReleaseAge`,
`trustPolicy`, blocked lifecycle scripts) exists to avoid exactly that, for code
that never has to change again.

It is verified two ways: `prices.test.ts` reads it with Node's own WebSocket
client, and it was checked by hand against Chromium 153, Firefox 155 and
WebKit 26.6, which all read the same three frames with identical prices. The
browser check becomes a committed test when Playwright joins this package with
the hidden suites.
