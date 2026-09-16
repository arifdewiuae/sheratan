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

## What is in here

| Path | What |
|---|---|
| `hosts/` | A working four-module app in the canonical shape (SPEC §4): customers (T01), new-order (T03), orders (T04), notifications |
| `src/rules.ts` | The three rules, and the exact text the agent is shown |
| `src/detect.ts` | The scanner that finds them and emits the SPEC §8 JSON |
| `src/cases.ts` | The twelve injections |
| `src/tree.ts`, `src/sandbox.ts` | Reading, patching and materialising a run |
| `src/agent.ts` | One turn |
| `src/verify.ts`, `src/cycles.ts` | The verdict, and one thing recorded beside it |
| `test/hosts.test.ts` | The behaviour suite. **The agent never sees this** |
| `test/detect.test.ts` | Proof each rule fires, and does not fire on what merely looks like it |
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

## Deviations from the frozen task set

`Docs/EVAL-TASKS.md` is frozen at `eval-tasks-v1` and does not change. Where
this harness reads it differently, it says so:

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
