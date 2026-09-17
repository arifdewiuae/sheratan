# Week 0 — falsification results

**Run 2026-09-16 · `claude-sonnet-5` · [EVAL](EVAL.md) §2.3, [EVAL-TASKS](EVAL-TASKS.md) §5**

> **The self-repair gate is met: 60/60 (100%) against a threshold of 80%.**
>
> The other half of the Week 0 gate — median iterations on ≥ 3 tasks no worse
> than React — **has not been measured.** The project continues on half a gate,
> and this document says which half.

Raw logs for every run — the prompt, the reply and the resulting diff — are in
`packages/eval/results/`. Reproduce with
`pnpm --filter @sheratan/eval selfrepair`.

---

## The question

EVAL §2.3 puts it plainly: *if structured errors with a `fix` field do not
produce one-turn repair, the central premise is wrong and no amount of
framework polish rescues it.*

So: inject a boundary violation into a working app, hand an agent the
checker's JSON and nothing else, allow it exactly one turn, and see whether
the code comes back both legal and still working.

## Method

Twelve cases — three violation classes across four modules of a working app
built in the canonical shape (SPEC §4):

| Code | The violation |
|---|---|
| `SHR-L001` | A module reaches past another module's `index.ts` |
| `SHR-L002` | A view calls an I/O global |
| `SHR-L005` | Effects writes a signal instead of invoking a transition |

Five seeds each. **One turn**: the agent runs with no shell, so it cannot run
the checker and try again, and it never sees the tests. **Pass is both halves**
— the checker reports nothing *and* the app's behaviour suite is still green.

Every injection is behaviour-preserving, proved before the gate ran
(`check:cases`). The gate asks for a *structural* repair; a case that also
broke the app would be scoring the agent on a fault it was never shown.

## Result

| Rule | Passed | Rate |
|---|---|---|
| `SHR-L001` | 20/20 | 100% |
| `SHR-L002` | 20/20 | 100% |
| `SHR-L005` | 20/20 | 100% |
| **All** | **60/60** | **100%** |

Nothing failed either half: no run left a finding behind, no run broke the
behaviour suite, and no run introduced a module cycle. $6.57 and 35 seconds
per run.

## The control, which is the part worth reading

A perfect score against an 80% threshold is not evidence on its own. It is
equally consistent with *"a structured error produces one-turn repair"* and
with *"these violations are easy to spot"*, and the gate as specified cannot
tell those apart. So the same cases were run twice more with less of the
checker's output, everything else identical:

| What the agent was told | Overall | `L001` | `L002` | `L005` |
|---|---|---|---|---|
| **`full`** — code, location, message, `fix`, `docs` | **60/60 (100%)** | 20/20 | 20/20 | 20/20 |
| **`no-fix`** — the same, minus `fix` and `docs` | **36/36 (100%)** | 12/12 | 12/12 | 12/12 |
| **`bare`** — the file name, and nothing else | **31/36 (86%)** | 12/12 | 12/12 | 7/12 |

`L005` under `bare` was then measured again with five seeds and came back
19/20. See below: the effect is real in direction and unpinned in size.

Three things fall out of that, and only one of them flatters the premise.

**Only one rule ever fails, and only without the rule stated.** Every failure
in the `bare` arm was `SHR-L005`, and all five of them. Told only *"something
is wrong in `orders.effects.ts`"*, the agent read the file, decided the problem
was an unrelated stylistic inconsistency, refactored that instead, and left the
actual violation in place. Behaviour survived; the boundary did not. `L001` and
`L002` never failed under any condition.

That fits what SPEC already says about it: *"`SHR-L005` is not a compile-time
guarantee"*. It is also the only one of the three that cannot be deduced from
the file naming convention — `L001` is a wrong import path visible in the tree,
and `L002` is `document` sitting in a file called `.view.ts`. The convention
carries those two on its own, whether or not a checker speaks.

**But the size of that effect is not established, and the first number was
misleading.** 7/12 looked decisive, so the same cell was measured again with
five seeds:

| `SHR-L005` under `bare` | Passed |
|---|---|
| First run, 3 seeds | 7/12 (58%) |
| Re-measured, 5 seeds | 19/20 (95%) |
| Pooled | 26/32 (81%) |

Same model, same prompt, same cases, same day. The direction holds — `L005` is
the only rule that ever fails, and it only fails when the rule is withheld —
but a gap that moves from 58% to 95% on re-measurement is not a gap anyone
should quote. Twelve runs was too few to publish, and the only reason this
document does not contain the 58% figure as a finding is that it was checked.

The consistently hard case is `L005-orders`: 0/3 then 4/5, 4 of 8 pooled. The
other three `L005` hosts are 24/24 under `bare`.

**The `fix` field did nothing measurable.** `no-fix` scored exactly what `full`
scored, 36/36 against 60/60. Whatever produced the repair, it was the code, the
location and the message — not the remedy spelled out after them. EVAL §2.3
names the `fix` field specifically as the thing under test, and on this evidence
that attribution is unsupported. The field may still earn its place with a
weaker model, a harder violation, or a human reader; this run gives no reason
to believe it does.

**The instrument has almost no headroom.** Two of three rules are at ceiling
even with the rule withheld entirely, and the third is at 81%. A gate a 2026
frontier model clears at 100% cannot measure improvement, and re-running it
unchanged in Week 5 (EVAL's plan) will produce 100% again and mean nothing.

## What this supports, and what it does not

**Supported.** Machine-readable boundary errors do produce correct one-turn
repairs, at a rate well past the threshold set before the runtime existed. The
premise that would have closed the project is not falsified.

**Not supported.** That the `fix` field is why — stripping it changed nothing.
Nor is the size of the benefit from naming the rule at all established: it is
one rule, and its margin halved on re-measurement. That Sheratan's enforced
boundaries beat React's training-data advantage — that claim is comparative,
and the comparison arm does not exist. EVAL §2.4's honest confound cuts both
ways: this run has no React arm to be handicapped against.

**Not measured at all.** Median iterations to green on ≥ 3 tasks, versus React
19 + TanStack Query + Zustand. That needs `evalkit`, the hidden Playwright
suites and the control-arm app. Until it exists the Week 0 gate is half-open,
and the right description of this project's status is *"the falsification test
passed; the comparison has not been run"*.

## Limits of this instrument

Set out here rather than left to be found. The longer version is in
`packages/eval/README.md`.

- **It is not `sheratan check`.** That is Week 3. This is a scanner over
  blanked source covering three of the nine layer rules.
- **`SHR-L008` is recorded, not scored.** A repair can satisfy `L001` by
  re-exporting through a neighbour's `index.ts`, which makes two modules name
  each other. Here those edges are `import type` and are erased, so no runtime
  cycle exists — but the harness does not fail a run for one, because the agent
  is never shown that rule. It reports it instead. Zero occurred.
- **The behaviour suite is node + happy-dom, not Playwright.** The assertions
  come from the same hidden-test bullets of T01, T03 and T04, but this sub-eval
  has one arm and asks a narrower question than the task eval does.
- **One model, one day.** Agent performance is a moving baseline; a stale
  number is worse than none (EVAL §2.5).
- **Twelve cases is small,** and the control arms are three seeds, not five.
  The 86% is 31 of 36, and the one cell that moved did not reproduce its own
  margin when measured again.

## What changed because of this

One spec amendment, 2026-09-17. `SHR-L005` — *"effects must not mutate state
directly"* — was the only rule that ever failed to be repaired, and the run
showed why in the injection rather than in the score: the violation **could not
be written** until the state interface was first widened from `Accessor<T>` to
`Signal<T>`, because `Accessor<T>` is `() => T` and has no `.set`. In
`L005-notifications` a repair then removed the write and left the widened
declaration behind — a module that passed the check and was still wrong.

So the check moved to the declaration. `SHR-L010` (SPEC §4) says a `*.state.ts`
exposes only `Accessor` values and transitions; a `Signal` never leaves the
file. That is one declaration per field rather than a dataflow check on every
call site, it makes the write a compile error instead of a finding, and it
covers the view and `index.ts`, which L005 never named. `SHR-L005` stays as the
best-effort backstop, and SPEC §13's caveat now says which half is a guarantee.

Worth stating plainly: this came out of the instrument's *mechanics*, not its
numbers. The `bare` arm's margin is the part of this document that did not
survive re-measurement; this part did not depend on it.

## Next

1. **Build the comparison arm** — `evalkit`, the hidden suites, the React app.
   That is the half of the gate that is still open, and the half the product
   claim actually rests on.
2. **Give the instrument headroom** before Week 5, or it cannot show
   improvement: harder violations, more than one per case, or a weaker model.
3. **Re-run unchanged in Week 5**, as EVAL requires — but reporting the `bare`
   arm alongside, since that is the only column with room to move.
