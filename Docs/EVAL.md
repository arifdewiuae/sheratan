# Sheratan — Eval Suite (draft v0.1)

Two claims, two evals. Both must be reproducible by a stranger in one command,
or they convince no one:

```
bunx sheratan-eval perf
bunx sheratan-eval agent
```

The harness is built once in Week 0 and re-run unchanged in Week 5. Same code,
same frozen tasks, same prompt budget — which is what makes the two numbers
comparable.

Week 0 runs against a **small real runtime** (200–300 lines of signals), not an
empty mock. Empty implementations cannot go green in any way that means "the
app works": either the tests assert against the mock, in which case the metric
is "did the agent fill in a template", or they cannot run at all, in which case
"iterations to green" is undefined.

---

## Part 1 — Performance

### 1.1 Standard benchmark — **not in MVP**

Deferred deliberately. Being listed next to Solid in the Krausest suite is a
year-two credibility project and an upstream-PR lottery; it does not match the
product claim and it competes with the benchmark that does. Kept here so the
decision is recorded, not so it gets done in Week 5.

<details>
<summary>Original plan, for later</summary>


Run the Krausest `js-framework-benchmark` suite: create/update/swap/remove rows,
memory, startup. Do not build a custom variant of it.

Purpose is not to win. Purpose is to be *on the board* next to Solid, Svelte,
Vue and React, in the harness everyone already trusts. Being close to Solid and
far from React is enough; claiming first place invites a teardown.

Report: implementation in the same style as the other entries, PR upstream,
link the upstream results rather than self-published numbers.
</details>

### 1.2 High-frequency benchmark (the differentiator)

Nobody else's benchmark covers this, which is exactly why it is worth building.

| Scenario | Load | Metric |
|---|---|---|
| Ticker flood | 1 signal, 1000 writes/sec | DOM writes/sec (must be ≤ 60), dropped frames |
| Live table | 500 rows, 30% values changing per frame | p95 frame time, long tasks > 50ms |
| Reordering list | 500 rows, 20 swaps per frame | p95 frame time |
| Virtualized history | 100k rows, continuous scroll | p95 frame time, peak memory |
| Multi-stream | 8 concurrent `stream()` sources | p95 frame time, teardown leaks |

Baselines: React 19 + TanStack Query, Vue, Svelte 5, Solid. Same app, same
data feed, same machine, five runs, report median and spread.

The headline number to aim for: **60fps under 1000 msg/sec into a 500-row
table.** One sentence, one screenshot of the frame chart.

### 1.3 Size and cold start

| Metric | Target |
|---|---|
| `core` gzipped | < 10 KB |
| Runtime dependencies | 0 |
| Packages in user `package.json` for a full app | 1 |
| Time from `git clone` to rendered app | no install, no build — serve the folder with any static server |

That last row is a demo, not a number: a video of an app served as plain files
(`python3 -m http.server`) with an empty `node_modules`.

---

## Part 2 — Agent authoring

This is the eval that does not exist yet in the ecosystem, and it is the more
interesting artifact. Even if the framework is archived, this dataset is
publishable.

### 2.1 Method

- **Tasks:** 12 fixed, versioned tasks over the reference app domain, frozen in
  [EVAL-TASKS.md](EVAL-TASKS.md) (`eval-tasks-v1`). Each has
  a hidden test suite plus `sheratan check` (or ESLint + tsc for the control).
  Pass = tests green *and* checker clean.
- **Arms:** Sheratan vs React 19 + TanStack Query + Zustand. Same agent, same
  model, same system prompt budget, same task text.
- **Repetitions:** 5 seeds per task per arm. Agent runs vary enormously;
  a single run is anecdote. Report median and interquartile range.
- **Cap:** 10 iterations per task. Failure to converge is a recorded outcome,
  not a discarded run.
- **Volume, honestly.** 12 tasks × 2 arms × 5 seeds × up to 10 iterations is a
  harness-and-budget problem, not an evening. **Run 6 tasks in the headline
  comparison**; the other 6 stay in the repo as a held-out set. Six tasks with
  five seeds beats twelve tasks with one, which is a table of anecdotes.
- **Prompt budget is a controlled variable, fixed before the first run.** Both
  arms get the same token budget of documentation in context. Sheratan getting
  the full `llms.txt` while React gets a blank system prompt would measure
  "docs in context", not enforced boundaries. Write the budget down now so it
  cannot be "fixed" after seeing results.
- **Tasks are frozen this week**, before any runtime exists. Tasks written
  after seeing the framework are tasks that flatter it. One todo-with-a-form is
  the most overfitted agent task in existence — it must not be the only one.

### 2.2 Metrics

| Metric | Why it matters |
|---|---|
| Iterations to green | The core hypothesis: correction loop quality beats prior familiarity |
| First-attempt pass rate | Does the agent get it right cold |
| Layer violations per task | Does enforcement actually change what gets written |
| Tokens consumed to green | The economic argument, and the one buyers care about |
| Wall-clock to green | What the developer experiences |
| Non-convergence rate | The failure mode that matters most |

### 2.3 Self-repair sub-eval — **this is the Week 0 gate**

Inject a deliberate violation into a working file — I/O in a view, a direct
state mutation from effects, a cross-module deep import. Hand the agent only
the structured checker output. Measure: fixed correctly in one turn, yes or no.

This isolates the mechanism from everything else. If structured errors with a
`fix` field do not produce one-turn repair, the central premise is wrong and no
amount of framework polish rescues it.

### 2.4 Honest confound

React has years of training data; Sheratan has none. This advantages React and
must be stated in the writeup, in the README, and on the slide.

That is the point of the experiment rather than a flaw in it: the claim is that
*enforced boundaries plus machine-readable errors outweigh a training-data
advantage*. If Sheratan wins despite the handicap, the result is strong. If it
loses, `llms.txt` and the Skill are what get iterated — and if it still loses
after that, the premise is dead and Week 0 saved a year.

Do not dress this up. The first competent reader will spot it, and pre-empting
it is worth more than the numbers.

### 2.5 Publication

- Raw logs of every run committed to the repo.
- `sheratan-eval agent --arm react` runs the control, so a skeptic can reproduce
  the comparison rather than take it on faith.
- Results table in the README with model name and date. Re-run on each major
  model release; agent performance is a moving baseline and a stale number is
  worse than none.

---

## Gates

| When | Gate | If failed |
|---|---|---|
| Week 0 | One-turn self-repair ≥ 80%, and median iterations on ≥3 tasks no worse than React — measured against a small **real** signal runtime, not an empty mock | Stop. Cost: 3 days. |
| Week 1 | 500-row reordering within 2× of Solid | Fix reconciliation before anything else |
| Week 2 | Correct and leak-free first: 1000 mount/unmount cycles leave zero live subscriptions | Fix ownership before measuring anything |
| Week 2–3 | 60fps under 1000 msg/sec, once keyed reconciliation is real | Scheduler or renderer is wrong; the headline claim dies |
| Week 5 | Self-repair ≥ 80% in one turn | Ship, but lead with performance, not the AI claim |

---

## Scope discipline

The eval is an instrument, not a product. Timebox: 2 days in Week 0, 2 days in
Week 5. If the harness starts growing features, it is eating the framework.

Deliberately out of scope: SSR benchmarks, hydration metrics, Lighthouse
scores, a public leaderboard site, multi-model comparison matrices.
