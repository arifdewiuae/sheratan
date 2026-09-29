# `@sheratan/eval` — the Week 0 falsification gate

> **The gate:** one-turn self-repair ≥ 80%, measured as 48 of 60 runs
> (EVAL "Gates", EVAL-TASKS §5). **If it fails, the project closes.**

This package answers one question, and it is the question the whole framework
rests on:

> If an agent is handed a structured error with a `fix` field — and nothing
> else, and no second attempt — does it repair the violation correctly first
> time?

Sheratan's argument is that enforced boundaries plus machine-readable errors
beat React's training-data advantage. The self-repair sub-eval isolates that
mechanism from everything else: no task prompt, no docs, no tests, no
iteration loop. EVAL §2.3: *if structured errors with a `fix` field do not
produce one-turn repair, the central premise is wrong and no amount of
framework polish rescues it.*

## Running it

```sh
pnpm --filter @sheratan/eval test          # the detector's own tests
pnpm --filter @sheratan/eval check:cases   # every injection still leaves a working app
pnpm --filter @sheratan/eval selfrepair    # the gate: 12 cases x 5 seeds
pnpm --filter @sheratan/eval report        # the newest run, as a table
pnpm --filter @sheratan/eval suites        # proves the hidden suites (needs a browser)
```

Narrower runs, for working on the harness:

```sh
pnpm --filter @sheratan/eval selfrepair -- --seeds 1
pnpm --filter @sheratan/eval selfrepair -- --case L005-orders
pnpm --filter @sheratan/eval selfrepair -- --model claude-opus-5
```

It spawns the `claude` CLI, so it needs one on the PATH and it costs money.
The full 60 runs are a few dollars. It is deliberately **not** part of
`pnpm check`.

## The control arm

The comparison has two arms, and the second one is a committed application:

```sh
cd packages/eval/controls/react
pnpm install --ignore-workspace     # once, by hand. No eval run installs anything.
```

It is its own pnpm root, so React never enters Sheratan's dependency graph,
and its lockfile is committed on purpose — a control that drifts between runs
invalidates the measurement it exists to provide. A sandbox symlinks the
installed tree.

Without that install, `test/stage.react.test.ts` skips with the command above
rather than failing: CI has no React in it and must not grow one. Everything
else about the arm — the registry, the clean commands, the contamination gate
— is proved without it.

"Clean" for this arm is exactly what EVAL-TASKS §1.2 names: `eslint .` then
`tsc --noEmit`, both at 0. Its own test suite is *not* part of that, because
the table does not name it.

## The hidden suites

The task eval scores an iteration on two things: the arm's own clean commands,
and the hidden suite for that task (EVAL-TASKS §1.4). The suites are the three
Week 0 tasks — **T01, T03 and T04** — written verbatim from §3, one Playwright
spec each, in `suites/`.

They never enter the sandbox. They run from this package, against the origin
the harness serves the arm's app on, so ten iterations of an agent with a
shell cannot read them. The agent is told the **names** of the tests that
failed and never their bodies: the checker speaks in full because a
machine-readable remedy is what SPEC A3 claims, and the suite does not because
an agent that could read the assertions would be writing to them.

**Neutral by construction, and checked.** `test/neutral.test.ts` asserts that
no suite names a framework and that only `suites/harness.ts` names a test-only
surface. The second rule matters more than it looks: `/__control` and
`/__inspect` are reached at `evalkit`'s own address, and a suite that asked for
one at the app's origin would be recorded as tampering — voiding every run it
was scoring.

**Proved before they score anything**, by `pnpm --filter @sheratan/eval suites`:

1. Against the arm's **reference implementation**, every assertion passes, and
   the app is clean by the arm's own definition. A correct app that a hidden
   test fails is a hidden test that would have failed a correct agent.
2. Against that reference with **one thing deliberately broken**, exactly the
   tests that name the break fail — no more and no fewer. A suite that passes
   a broken app is measuring nothing and would report a wash as a result.

The second half is not ceremony. Writing it found a real fault in T04: the
rollback assertion read the badge immediately after the click, which is
satisfied by the value the row started with, before the optimistic update has
even landed — so an app that never rolled anything back passed. A revert
cannot be asserted without first observing the thing being reverted, and the
mutation is what said so.

The Sheratan reference is `hosts/` — §5 already calls it the reference
solution to T01, T03 and T04 — assembled with the shell in
`references/sheratan/`, which adds only what `hosts/` lacks to be a page: an
entry, an `index.html`, the manifests and an HTTP adapter. `hosts/` itself is
untouched, deliberately: it is the tree the self-repair gate measured 60/60
against, and adding a file to it would change what that agent sees.

**References are not arms, and must never be registered as such.** They
contain the `data-testid` hooks the tasks name, and `src/contamination.ts`
runs over every arm in `ARMS` — registering one would hand an agent the
answer, and the gate would say so.

### Both arms, or the instrument is the result

`references/react/` is the same three tasks written in the control arm's stack,
and it exists because a suite proved against one framework is exactly the
instrument that would hand that framework the win. The proof runs over every
reference by default, and the same eleven breaks are required of each:
`test/neutral.test.ts` fails if one arm is proved with a smaller set than the
other, because an assertion nobody has shown would fire for an arm is not an
assertion for that arm.

It paid for itself immediately. Three things the suites exposed, none of which
was visible from the Sheratan side alone:

| Found | What it was |
|---|---|
| Two `GET /api/customers` per page load | `StrictMode` mounts, unmounts and remounts, and the second mount refetches. Three Week 0 assertions count requests, so **every React run would have failed T01 for a dev-mode diagnostic**. Removed from `controls/react` as well — the arm, not the app, was wrong |
| A double-click sent two orders | `disabled={isPending}` is not a lock. TanStack delivers a status change through its batched notifier, so the attribute is true a microtask after `mutate` — later than the second click. A `useRef` latch is the guard that holds |
| The documented optimistic-update recipe fails | Snapshotting the cache entry in `onMutate` and restoring it in `onError` makes one failed write undo a concurrent one. The rollback has to restore **one row**, and the refetch on settle has to wait for the last write |

The first is the one that mattered. It was a systematic bias **against** the
control arm, worth roughly a third of T01's assertions, and it would have made
Sheratan look better for a reason that has nothing to do with framework design.
No suite was changed to accommodate any of it.

`references/react/` borrows `controls/react`'s installed tree, so it needs that
one-time `pnpm install --ignore-workspace` and installs nothing itself. Without
it the proof **says so loudly and names the command** rather than quietly
proving one arm; CI installs it, so the parity claim is checked by something
other than a laptop.

## The other half — the task eval

The gate above is one of two. EVAL's Week 0 gate also asks whether **median
iterations on ≥ 3 tasks is no worse than React**, and that is a different
instrument: an agent with a shell, iterating against a hidden suite until it
converges or runs out of tries (EVAL-TASKS §1.4).

```sh
pnpm --filter @sheratan/eval task -- --task T01 --arm sheratan
pnpm --filter @sheratan/eval task -- --task T01 --arm react --seeds 5
```

One run stands up a sandbox with the arm scaffolded into it, `evalkit` behind
it, the arm's own dev server, and a proxy that makes those last two **one
origin** — because the contract the agent reads promises the base URL is the
origin the page came from, and honouring that per-arm would configure the arms
differently, which §1.1 forbids.

Three properties are worth knowing before reading a number from it:

- **The hidden suite is never in the sandbox.** It runs from this package
  against the app's origin. Ten iterations of an agent with a shell cannot
  read what was never in the directory it was given.
- **The conversation is resumed, not restarted.** Otherwise "three iterations"
  would mean three first attempts.
- **`/__control` and `/__inspect` are unreachable at the app's origin.** The
  hidden tests reach them on `evalkit`'s own URL, so a request for one at the
  app's origin can only be an arm that went looking. It voids the run — over
  HTTP and over a WebSocket upgrade alike.
- **Each arm's documentation is counted before the first seed**, with the
  evaluated model's own counter, and a document over §1.5's budget refuses the
  run rather than warning. Sheratan is at 9,593 tokens and the control at
  9,689, against 10,000.

`--smoke` survives for a task this build has no suite for: it measures cost
and wall-clock and nothing else, prints a banner saying so, and convergence in
it means only that the arm called itself done and the project was clean. The
three Week 0 tasks all have suites, so the gate never needs it — and a task
without one refuses to run rather than quietly producing a number.

## The matrix, which is what the gate is decided on

One task against one arm is a probe. The gate is the grid:

```sh
pnpm --filter @sheratan/eval matrix                        # 3 tasks x 5 seeds x 2 arms
pnpm --filter @sheratan/eval matrix -- --tasks T01 --seeds 1  # the smoke: 2 cells
pnpm --filter @sheratan/eval matrix -- --resume <dir>         # finish it, or reprint it
```

Three things about how it runs, each of which changes what the number means.

- **The two arms of a seed run next to each other.** A grid that did all of
  one arm and then all of the other would put hours between the halves of
  every comparison, and any drift in the model or the service over those hours
  would land entirely on one arm. Paired in time, drift hits both.
- **A run that reached the cap counts as the cap.** Not converging is a
  recorded outcome (§1.4 step 4), and the recording has to reach the number.
  Dropping those runs and taking the median of what is left would reward the
  arm that fails more often: an arm converging twice in five seeds, quickly,
  would read better than one converging five times out of five. The sample is
  censored at ten, which understates a gap rather than inventing one — and
  that makes the single criterion the gate states enough on its own.
- **A voided run is not a slow run.** Tampering means the arm reached for a
  test-only surface; it is excluded, counted and named, because a seed missing
  from a median is something a reader has to be told about.

The arithmetic lives in `src/analysis.ts`, apart from the script that spends
the money, and `test/analysis.test.ts` proves it for nothing — including that
censoring is what decides the verdict rather than how it is presented, and
that a task missing one arm is never read as a tie.

Every cell is written to disk as it finishes, so `--resume` re-runs only what
is missing and a crash on the twenty-fifth run costs one cell rather than
twenty-five. A directory with every cell already in it prints the table and
spends nothing, which is also how a published result is re-read later — and a
resume with a **larger** `--seeds` runs only the seeds that are not there yet.

That last property is the one to be careful with, and the care is not
technical. Widening a grid after looking at it is optional stopping: buy more
seeds only when the answer is unwelcome and the number stops meaning anything.
So the rule is fixed **before** a grid runs and applied whichever way it
leans. For the Week 0 matrix, decided 2026-09-25 with nothing measured but the
smoke: **three** seeds per task per arm is the answer, and a task is widened to
five only if its two medians come out **equal**, because a tie is the one
outcome three seeds genuinely cannot resolve.

Three rather than the five EVAL-TASKS §1.4 asked for, and the reason is cost
rather than method — a cell is a whole agent session, and thirty of them is
four to five hours of one account's usage. The amendment is in §1.4 itself.
What it costs is precision: the median of three moves on a single unlucky run,
so **a margin inside one iteration is a tie at this sample size**, and any
number published from this grid has to say so beside itself.

A probe that scores nothing — `--smoke` on a task with no suite — is **not**
kept in `results/`. That directory is the evidence behind published numbers,
and a run that scores nothing sitting beside runs that do is an invitation to
quote it. Its cost and wall-clock go in TASKS, with the command that
reproduces it.

## What is in here

| Path | What |
|---|---|
| `hosts/` | A working four-module app in the canonical shape (SPEC §4): customers (T01), new-order (T03), orders (T04), notifications |
| `controls/react/` | The control arm's application, and `DOCS.md`, its whole §1.5 documentation budget. Its own pnpm root; see above |
| `src/rules.ts` | The three rules, and the exact text the agent is shown |
| `src/detect.ts` | The scanner that finds them and emits the SPEC §8 JSON |
| `src/cases.ts` | The twelve injections |
| `references/sheratan/` | The shell that turns `hosts/` into a bootable page: entry, `index.html`, manifests, HTTP adapter. A fragment on purpose — it only typechecks once assembled, which the proof does with `sheratan check` |
| `references/react/` | The same three tasks in the control arm's stack, so the suites are proved against both. A whole app, not a shell: there is no shared tree to preserve. Borrows `controls/react`'s `node_modules` |
| `suites/` | The hidden suites (T01, T03, T04) and the one harness that owns both origins |
| `src/suite.ts` | Running one suite against a live stage, and reporting names only |
| `src/reference.ts`, `src/mutations.ts` | The reference app per arm, and the deliberate breaks that prove a suite would notice |
| `src/tree.ts`, `src/sandbox.ts` | Reading, patching and materialising a run |
| `src/agent.ts` | One turn, no shell — the self-repair half |
| `src/verify.ts`, `src/cycles.ts` | The verdict, and one thing recorded beside it |
| `src/frozen.ts` | The task set, read from the frozen document and digest-checked |
| `src/arm.ts`, `src/arms/` | What the harness knows about a stack. An arm is data, so a third one is a directory and a row — `sheratan.ts` and `react.ts` are both about seventy lines, most of it comment |
| `src/session.ts` | A conversation with a shell, resumed across iterations |
| `src/iterate.ts` | EVAL-TASKS §1.4, and nothing else |
| `src/cell.ts` | One cell — one task, one arm, one seed — start to finish, and both files it leaves behind. Shared by `task.ts` and `matrix.ts`, so a probe prices what the matrix runs |
| `src/analysis.ts` | The arithmetic the gate is decided with: median, IQR, censoring at the cap, and the verdict |
| `src/results.ts` | Where a run's logs go, and what the directory is called |
| `src/stage.ts`, `src/proxy.ts` | One run stood up: sandbox, backend, dev server, one origin |
| `src/budget.ts` | EVAL-TASKS §1.5, counted with the model's own counter and refused rather than warned |
| `src/contamination.ts` | The check that no arm is handed a task's DOM hooks, in its docs or its scaffold |
| `test/hosts.test.ts` | The behaviour suite. **The agent never sees this** |
| `test/detect.test.ts` | Proof each rule fires, and does not fire on what merely looks like it |
| `test/neutral.test.ts` | Proof no suite names a framework, and only the harness names a hidden surface |
| `test/analysis.test.ts` | Proof of the sums the gate turns on, for nothing |
| `results/` | Every prompt, reply and diff. Committed (EVAL §2.5) |

## The method, exactly

**Twelve cases.** Three violation classes across four host modules:

| Code | Class |
|---|---|
| `SHR-L001` | A module reaches past another module's `index.ts` |
| `SHR-L002` | A view calls an I/O global |
| `SHR-L005` | Effects writes a signal instead of invoking a transition |

**Five seeds each**, because a single agent run is an anecdote.

**Every injection is behaviour-preserving.** `check:cases` proves it: all
fifteen behaviour assertions pass before the repair as well as after. The gate
asks whether a structured error produces a *structural* repair; a case that
also broke the app would be scoring the agent on a fault it was never shown.

**One turn.** The agent runs with `--restricted`: no shell, so it cannot run
the checker and try again, and the repo's own `CLAUDE.md` and settings are not
loaded. It gets the file tree and the checker JSON. That is all.

**Pass = both halves** (EVAL-TASKS §5): the detector reports nothing *and* the
hidden suite is still green. The suite is copied into the sandbox only after
the turn has ended.

## What this instrument does not do

Stated here rather than discovered by a reader later.

- **It is not `sheratan check`.** That is Week 3 and works over the TypeScript
  compiler API. This is a scanner over blanked source covering three of the
  nine layer rules. Its blind spots are its own: `L005` sees any `.set(` in an
  effects file that is not on a `Set`/`Map` built in that same file, so a
  signal reached by another name is still caught, but an exotic write is not.
- **`SHR-L008` is recorded, not scored.** A repair can satisfy `L001` by
  re-exporting through the neighbour's `index.ts`, which makes the two modules
  name each other. In this app those edges are `import type` and are erased,
  so there is no runtime cycle — but a value import would be one, and the gate
  does not fail a run for it, because the agent is never shown that rule.
  `runtimeCycles()` reports it beside the verdict so the hole is visible.
- **The behaviour suite is node + happy-dom, not Playwright.** EVAL-TASKS §1.1
  specifies browser end-to-end tests for the *task* eval, where two framework
  arms have to be judged by the same instrument. This sub-eval has one arm and
  asks a narrower question — did the repair break the app — so the assertions
  are taken from the same hidden-test bullets and run in-process.
- **One model, one day.** Agent performance is a moving baseline. Every result
  records its model and date, and a stale number is worse than none
  (EVAL §2.5).

## Two things that were not instruments until 2026-09-25

**The budget was never counted.** EVAL-TASKS §1.5 fixed it, SPEC §10 promised
`llms.txt` would fit, TASKS recorded an estimate of "~4.0–4.7k", and nothing
measured anything. The first real count came back at **11,537 tokens**. The
count is the sum of `input_tokens`, `cache_creation_input_tokens` and
`cache_read_input_tokens` — differencing `input_tokens` alone, which is what
the plan said, reads 2 on a cached prompt and would have reported every
document as free.

**`llms.txt` contained the answers.** Its canonical module was a complete,
working **T01** — the same four `data-testid` hooks, the same columns, the same
endpoint — and its list and mutation examples carried three of **T04**'s. Every
testid the document defined belonged to a task. Two of the three Week 0 gate
tasks would have measured recall of the documentation instead of authoring.
`src/contamination.ts` now runs over every arm's documentation *and* its
scaffold, in `pnpm check`. It catches the mechanical form only: the same
example with its hooks renamed is still the answer, so the fix was moving
`llms.txt` onto the `create` template's device-telemetry domain, and the gate
is what stops it coming back.

## Deviations from the frozen task set

`Docs/EVAL-TASKS.md` is frozen at `eval-tasks-v1` and does not change. Where
this harness reads it differently, it says so:

- **The freeze is pinned at §2 onward, not on the whole file.** The whole-file
  digest recorded in TASKS stopped matching, because §1.2's arms table
  legitimately gained the Svelte row on 2026-09-17. Every task prompt, hidden-
  test list, subset, the brownfield base app, §5 and the API contract are
  byte-identical to the tag; `src/frozen.ts` pins that surface and refuses a
  run if it moves.
- **§5 lists the hosts as "the reference solutions to T01, T03 and T04, plus
  the T04 effects file — 4 working files".** A violation class needs a file of
  the right kind to land in (I/O in a view needs a view), so the four hosts are
  four *modules*: T01, T03, T04, and the toast T04's own prompt asks for
  (`data-testid="toast"`), which also gives the other three a neighbour to
  legally import through.
- **§5 says the checker JSON is hand-written in Week 0.** It is generated
  instead, by the same code that judges the submission. That is stricter: a run
  cannot pass because its input happened to be worded well.
- **Week 0 was meant to run against a 200–300 line runtime.** It runs against
  the real one, which is a stronger test of the same hypothesis, not a weaker
  one. The tasks were frozen before any of it existed, which is the property
  that mattered.
