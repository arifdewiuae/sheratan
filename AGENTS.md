# AGENTS.md

Instructions for anyone changing this repository, human or agent. `CLAUDE.md`
points here. When a rule below disagrees with what the code does, the code is
wrong or the rule gets amended in the same change, never silently ignored.

## What this is

Sheratan is a frontend framework with one legal way to structure an app,
enforced by a checker with machine-readable fixes, plus async and live data in
the core. It's pre-release: `packages/core` holds the runtime, and the checker
and CLI aren't written yet.

**Source of truth, in order:**
1. `Docs/SPEC.md`
2. `Docs/EVAL.md`
3. `Docs/TASKS.md`

If code needs to diverge from SPEC, amend SPEC first (or in the same PR) and
log the decision in TASKS "Decisions log". If you find a contradiction between
docs, add it to TASKS "Spec gaps".

The design axioms in SPEC §3 override convenience:
- **A1:** one way to do each thing.
- **A2:** fail loudly and early.
- **A3:** machine-readable errors.
- **A4:** zero runtime dependencies.
- **A5:** the API fits on one screen.

## Commands

```sh
pnpm install --frozen-lockfile   # never npm or yarn; the lockfile is pnpm-lock.yaml
pnpm check                       # everything CI runs, in CI order — must be green before a PR
pnpm lint                        # eslint, zero warnings allowed
pnpm typecheck                   # tsc (TypeScript 7) per package
pnpm build                       # emit dist/ per package
pnpm test                        # node:test
pnpm coverage                    # tests + coverage gate (fails below threshold)
pnpm security                    # pnpm audit + registry signature verification
```

Single test file: `node --test packages/core/test/html.test.ts`.
Toolchain: Node from `.nvmrc`; pnpm from `packageManager` in `package.json`.

## Repository map

| Path | What |
|---|---|
| `packages/core/src/` | Runtime: reactive graph (`reactive`), templates and `each`/`render` (`html`), public entry (`index`), test-only entry (`internal`) |
| `packages/core/test/` | `node:test` suites; DOM via happy-dom |
| `tooling/eslint-config/` | The one ESLint config. Owns the TypeScript 6 copy typescript-eslint needs (see Toolchain) |
| `Docs/` | SPEC, EVAL, EVAL-TASKS, TASKS, brand identity |
| `llms.txt` | The API as an agent should learn it. Updated with every public API change |
| `site/` | Static landing page (GitHub Pages, deployed from `main`) |
| `.github/workflows/` | `ci.yml` (every push/PR, daily audit), `pages.yml` (site deploy) |

## Git and PRs

- `develop` is the default branch. `main` receives releases only, and the site deploys from it.
- **Every change goes through a PR into `develop`.** No direct commits to either branch.
- Branch names: `feat/…`, `fix/…`, `refactor/…`, `chore/…`, `docs/…`. One concern per PR; stack PRs when a change splits into reviewable steps.
- A PR is mergeable when CI is green and the description states what changed, why, and how it was verified.
- Commit subjects are imperative and scoped, as in the existing history ("Core: …", "Spec: …").

## Toolchain decisions

- **TypeScript 7** (native Go compiler, `typescript@7`) compiles and typechecks everything.
- **TypeScript 6.0 lives only in `tooling/eslint-config`.** typescript-eslint's type-aware rules need the JavaScript compiler API, which TS 7 doesn't expose. pnpm's isolated layout keeps that copy private to the lint package.
  - Remove it once typescript-eslint supports TS 7.
  - Until then, `tsconfig.base.json` uses only options that behave identically in both.
- **pnpm**, for supply-chain safety. The settings live in `pnpm-workspace.yaml`; don't relax them without a TASKS decision entry:
  - dependency lifecycle scripts are blocked (`strictDepBuilds`, empty `allowBuilds`)
  - `minimumReleaseAge` is 3 days
  - `trustPolicy: no-downgrade`
  - `blockExoticSubdeps`
- **Pin exact versions** (`--save-exact`). Adding a dependency to `packages/core` `dependencies` is forbidden (SPEC A4). Dev dependencies need a reason in the PR.
- **GitHub Actions are pinned to full commit SHAs** with a `# vX.Y.Z` comment. Dependabot updates them. Never use a tag or branch ref, and never set `continue-on-error`.

## TypeScript

- `strict` plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and `isolatedDeclarations`. Exported functions declare their types explicitly; the generated `.d.ts` is the public contract.
- **Erasable syntax only** (`erasableSyntaxOnly`), so Node runs tests on `.ts` directly. That means:
  - no `enum`
  - no `namespace`
  - no parameter properties
- **Constants are `as const` objects, and types are derived from them:**

  ```ts
  export const PartKind = { Child: 'child', Attr: 'attr', Prop: 'prop', Event: 'event' } as const;
  export type PartKind = (typeof PartKind)[keyof typeof PartKind];
  ```

  A bare union of string literals isn't a usable runtime constant, and a literal compared in logic (`kind === 'event'`) is a bug waiting for a typo.
- No `any` and no non-null `!` in `src`. Narrow with checks; `unknown` at boundaries.
- `import type` for type-only imports. Relative imports carry the `.ts` extension (rewritten on emit).

## Code rules

These are checked by `pnpm lint` where a rule can express them, and by review
where it can't.

**Names and literals**
- **No magic numbers or strings.** Every tunable or meaningful value is a named constant next to its use (`FRAME_FALLBACK_MS = 1000 / 60`, `MAX_RERUNS_PER_DRAIN = 100`, `NodeFilter.SHOW_ELEMENT`). Bit flags are named (`Flags.Dirty = 1 << 0`). Only `-1`, `0` and `1` are exempt.
- **If a literal appears in two files, it gets one home.** Error-code prefixes, marker strings and DOM constants are defined once.
- **Files are named for what they contain.** A file that holds only a prompt is not `state.ts`.

**Readability**
- **Blank lines separate logical steps:** after declarations, around multi-line statements, after every block, and before `return` and `throw`. A wall of statements is a lint error, not a style preference.
- **One statement per line.** No `if (a) { if (b) x(); }` one-liners and no comma-operator tricks. Nested ternaries are forbidden.

**Functions**
- Cyclomatic complexity ≤ 10, ≤ 50 lines, nesting depth ≤ 3, ≤ 4 parameters.
- A function does one thing. If it mixes control flow with per-item work, computation and bookkeeping, split it so the loop owns iteration and named helpers own each concern.
- **Re-check a function's length whenever cross-cutting code (tracing, dev assertions, metrics) is added to it.** That's the usual way a fine function becomes a god function.
- **Extract for reuse, a distinct concern, or testability.** Don't fragment one-off code into single-use helpers just because a block has a comment.

**Errors** (SPEC A3)
- Every thrown error comes from the one error helper and carries a stable code, what went wrong, and what to do instead.
- Error messages state the allowed alternative, not only the rule.

**Comments**
- TSDoc on every exported symbol: what it does, the SPEC section, and an `@example` for public API. It flows into the generated `.d.ts` that editors and agents read.
- Inline comments explain *why* (an ordering constraint, an invariant, a browser quirk), never *what*.

**Mutability and imports**
- Immutable by default: `readonly` fields and `ReadonlyArray` in public types; `const` everywhere possible; no parameter reassignment.
- Runtime code (`packages/core/src`) imports only relative modules. No `node:` imports, and no DOM access at module evaluation time (SPEC §13: SSR door stays open).

## Performance and algorithms

The runtime's value is its update cost, so algorithmic complexity is part of
the contract. Pick the best known algorithm for each operation. A PR that
worsens a bound below needs a TASKS decision entry and a benchmark.

| Operation | Bound | How |
|---|---|---|
| Signal read / write (no observers) | O(1) | |
| Dependency link / unlink | O(1) | Doubly-linked edge lists (alien-signals design); edges reused across re-runs, no per-run allocation when deps are unchanged |
| Re-run with changed deps | O(changed) | Stale tail edges purged after the run |
| Write propagation | O(affected subgraph) | Iterative push of Pending/Dirty flags; explicit stack, no recursion depth limit |
| Computed read | O(1) cached; O(sources checked) when pending | Pull re-validation stops at the first dirty source |
| Owner child add / remove | O(1) | Intrusive linked list |
| Row lookup for an event handler | O(1) | Inherited at owner creation, never walked |
| Template parse | O(markup), **once per call site** | Cached by the `TemplateStringsArray` |
| Template instantiate | O(clone + path steps to holes) | Hole paths precomputed at parse; marker attributes stripped from the template; no per-mount scan, string parse or `Map` |
| Hole update | O(1) DOM writes per changed hole | One frame watcher per reactive hole |
| `each` reconcile | O(n) diff, O(n log n) moves, **minimum DOM moves** | Key `Map`; common prefix/suffix skipped; longest increasing subsequence decides which rows stay |
| Dispose a subtree | O(owned nodes + edges) | |

Rules:
- **Measure what is deterministic.** Tests assert operation counts (DOM moves, watcher runs, allocations of edges) rather than wall-clock time.
- **No work in hot paths that can happen once at parse or creation time.**
- **Avoid allocation in per-update paths:** no spread-to-array, no `reverse()` copies, no closures created per write.

## Tests

- **Runtime semantics are specified by tests written before the implementation** (TASKS Week 1). A bug fix starts with a failing test.
- **`node:test` + `node:assert/strict`; happy-dom for the DOM.** Tests run on `.ts` source directly.
- **Coverage gate:** 100% lines, 100% functions and ≥ 95% branches for `packages/core/src`. Unreachable defensive code gets deleted, not excluded.
- **Test behaviour through the public API.** Use `internal` only for what the public API can't observe: live subscription count, owners, frame watchers.
- **Every error path has a test that asserts the error code.**
- **Time:** use `flush()` or fake timers. Never sleep, except the one test proving the scheduler runs unaided.
- **Leaks:** a mount/dispose loop returns `liveSubscriptions()` to its starting value. Add one for any new owner-scoped resource.

## Documentation obligations

A change to the public API updates, in the same PR:
1. TSDoc
2. `llms.txt`
3. the SPEC section it implements
4. an export-surface test, which lists the exact public names (SPEC A5)

A behaviour change updates the relevant SPEC section. A resolved gap gets ticked in TASKS with where it was resolved.

## Definition of done

1. `pnpm check` is green locally, and CI is green on the PR.
2. **A fresh read of every function you touched:** does it do one thing, and does it read top to bottom without a comment explaining the flow? Structural compliance (tests exist, constants exist) is not the same as clean code.
3. Complexity bounds above still hold; new hot-path code states its bound in the PR.
4. Docs obligations met. No TODOs without a TASKS entry.

## AI_Web_App_Checklist applicability

The team's launch checklist (`~/Projects/AI_Web_App_Checklist.md`) is written
for LLM apps. For a framework, this is what applies.

| Section | Status | Where it lands here |
|---|---|---|
| §1 model layer, §2 SSE, §3 API keys, §4a moderation, §5–6 chat client, §10 PWA, §11 markdown, §13 browser ML, §14 RAG, §19 voice, §20 Tauri, §22 AWS, §23 GitHub App | N/A | No LLM, server or chat UI in this repo |
| §4 security headers | Partial | `site/` sends a `<meta>` CSP (GitHub Pages can't set headers); the runtime escapes holes by default (SPEC §9) |
| §7–9 accessibility, mobile, web vitals | Partial | `site/` and, later, `examples/dashboard` |
| §12 unit testing | Applies | Tests section above |
| §15 observability | Remapped | The causal trace (SPEC §7) is the framework's observability story |
| §16 evals | Remapped | `Docs/EVAL.md` performance and agent-authoring evals, with go/no-go gates |
| §17 CI/CD | Applies | `ci.yml`: SHA-pinned actions, frozen lockfile, lint → typecheck → build → coverage → audit, dependency review on PRs, daily audit |
| §17a package hygiene | Applies (pnpm) | Toolchain decisions above |
| §17b / §17c clean code | Applies | Code rules above, enforced by `tooling/eslint-config` |
| §18 Vercel | N/A | Site is on GitHub Pages |
| §21 README | Applies | Quickstart and repository map in `README.md` |
