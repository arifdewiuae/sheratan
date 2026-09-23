# AGENTS.md

Instructions for anyone changing this repository, human or agent. `CLAUDE.md`
points here. When a rule below disagrees with what the code does, the code is
wrong or the rule gets amended in the same change, never silently ignored.

## What this is

Sheratan is a frontend framework with one legal way to structure an app,
enforced by a checker with machine-readable fixes, plus async and live data in
the core. It's pre-release: `packages/core` holds the runtime, `packages/check` the
checker (SHR-L001, SHR-L002, SHR-L003, SHR-L006, SHR-L007, SHR-L008, SHR-L010 and the
one warning, SHR-T001, so far) and
`packages/cli` the `sheratan` command: `check`, `build` and `dev` so far, with
`create`, `generate`, `explain` and `trace` specified and not built.

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
pnpm format                      # oxfmt, writes
pnpm format:check                # oxfmt, fails on a diff
pnpm lint                        # oxlint, type-aware, zero warnings allowed
pnpm typecheck                   # tsc (TypeScript 7) per package
pnpm build                       # dist/dev (tsc) + dist/prod (esbuild) per package
pnpm test                        # node:test
pnpm coverage                    # tests + coverage gate (fails below threshold)
pnpm verify                      # consumer types, publint, attw, size budget, llms.txt freshness
pnpm security                    # pnpm audit + registry signature verification
pnpm sheratan check <dir>        # the CLI on an app, from source; --json for the machine shape
pnpm sheratan build <dir>        # strip types into <dir>/dist; --out picks another directory
pnpm sheratan dev <dir>          # serve it with types stripped; --port, --no-reload
```

Example app: `pnpm --filter example-hello dev` (http://localhost:5173), and
`pnpm --filter example-hello e2e` for the browser specs. E2E is deliberately
outside `pnpm check`, because it needs a browser; CI runs it as its own job.

Single test file: `node --test packages/core/test/html.test.ts`.
Fix lint and formatting: `pnpm exec oxlint --type-aware --fix && pnpm format`.
Re-record the size budget after an intended change: `pnpm --filter sheratan exec node scripts/size.ts --update`.
Toolchain: Node from `.nvmrc`; pnpm from `packageManager` in `package.json`.

## Repository map

| Path | What |
|---|---|
| `packages/core/src/` | Runtime. Graph (`graph`, `signal`, `computed`, `watch`, `scheduler`, `owner`), templates (`template`, `instantiate`, `each`, `lis`, `mount`, `render`, `dom`), errors (`codes`, `messages`, `env`, `env.prod`, `errors`), entries (`index` public, `internal` test-only) |
| `packages/core/test/` | `node:test` suites; DOM via happy-dom |
| `packages/core/scripts/` | Build (`build-prod`, `build-cli`), package checks (`verify-types`, `verify-cli`, `size`), docs (`llms`) |
| `packages/check/src/` | The checker (`sheratan check`): `typescript` (the one adapter over `typescript/unstable/*`), `layout` (path → layer), `matrix` (SPEC §4's table as data), `rules/` (one file per code), `check` (`checkProject()`). A folder, not a package: it folds into the `sheratan` tarball |
| `packages/check/test/` | Real TypeScript programs on disk: the whole import matrix as one project, a failing case per rule, and both apps in this repo checked clean |
| `packages/cli/src/` | The `sheratan` command (SPEC §10): `run()` returns an exit code and writes through an injected `Terminal`, `report` holds both output formats, `strip`, `build` and `serve` turn a project into plain ESM, written to a directory or served. A folder, not a package: it folds into the same tarball |
| `packages/cli/bin/` | The one file that owns a process: it hands `run()` the real streams and sets `process.exitCode` |
| `examples/hello/` | The reference app in the canonical module shape (SPEC §4): a live dashboard and its e2e specs. It runs on `sheratan dev`, the shipped command, so the example and the product cannot drift |
| `.oxlintrc.json`, `.oxfmtrc.json` | The one lint config and the one formatter config |
| `Docs/` | SPEC, EVAL, EVAL-TASKS, TASKS, brand identity |
| `Docs/adr/` | Decisions with a real trade-off, written up once instead of re-argued |
| `llms.txt` | The API as an agent should learn it. Updated with every public API change |
| `site/` | Static landing page, served at **sheratan.dev** (GitHub Pages, deployed from `main`; `site/CNAME` holds the domain and must not be deleted — Pages rewrites the setting from it on every deploy). Fonts are self-hosted in `site/fonts/`, so the page loads nothing from a third party; editing the one inline `<script>` means recomputing the CSP hash in `<head>` |
| `.github/workflows/` | `ci.yml` (every push/PR, daily audit), `pages.yml` (site deploy) |

## Git and PRs

- `develop` is the default branch. `main` receives releases only, and the site deploys from it.
- **Every change goes through a PR into `develop`.** No direct commits to either branch. GitHub enforces it: the ruleset "protect develop and main" requires a PR and all three CI checks green, blocks force-pushes and deletion, and has no bypass, admins included.
- Branch names: `feat/…`, `fix/…`, `refactor/…`, `chore/…`, `docs/…`. One concern per PR; stack PRs when a change splits into reviewable steps.
- A PR is mergeable when CI is green and the description states what changed, why, and how it was verified.
- Commit subjects are imperative and scoped, as in the existing history ("Core: …", "Spec: …").

## Releases

`packages/core` publishes as `sheratan`. Nothing publishes from a laptop except
the first `0.0.1`, which had to exist before npm would let trusted publishing be
configured against it.

1. Bump `packages/core/package.json`, land it through a PR like anything else.
2. Tag `main` with `v<version>` — the tag must match the manifest, and
   `.github/workflows/release.yml` fails the run if it doesn't.
3. Watch the run. **Pushing the tag is the gate** — there is no approval step,
   so a tag push publishes. The workflow refuses a tag that is not on `main`
   and a tag that disagrees with the manifest, and runs `pnpm check` before it
   publishes, but nothing asks a human twice.

The workflow authenticates with **npm trusted publishing (OIDC)**: no
`NPM_TOKEN`, no `.npmrc` credentials, nothing to leak. pnpm exchanges the
`id-token: write` identity for a publish credential that expires in minutes,
and attaches a provenance attestation automatically — never pass
`--provenance`, and never add `publishConfig.provenance`, which breaks a local
publish outside CI.

npm matches its trusted-publisher configuration on repository and **workflow
filename**. Renaming `release.yml` breaks publishing until the configuration on
npmjs.com is updated to match.

npm's **environment** field is deliberately blank, and the job has no
`environment:` to match it. A GitHub environment would buy a required-reviewer
prompt before each publish; for a single maintainer who pushes the tag anyway,
it is a second click rather than a second pair of eyes. Fill that field in and
the job needs the matching `environment:` back, or the OIDC exchange fails with
a mismatch that does not name the cause.

## Toolchain decisions

- **TypeScript 7** (native Go compiler, `typescript@7`) compiles and typechecks everything. The checker (`packages/check`, Week 3) reads programs through `typescript/unstable/sync` and `typescript/unstable/ast/*` — TS 7's `.` export is a version string, not the TS 5/6 JS API. Every `unstable/*` import goes through one adapter module so a breaking change is one file's problem, and `typescript` is pinned exactly as a peer dependency. See ADR 0005.
- **Oxlint** (`--type-aware`, via tsgolint on TS 7) is the linter, with `@stylistic` and `eslint-plugin-jsdoc` loaded as JS plugins for the two rules it has no native equivalent for. **oxfmt** formats. ESLint and typescript-eslint are gone, and with them the second TypeScript.
- **Known compiler gap:** TS 7.0.2 applies `rewriteRelativeImportExtensions` to emitted JavaScript but not to emitted declarations. `scripts/build-prod.ts` rewrites `./x.ts` → `./x.js` in `dist/dev/*.d.ts`, and `scripts/verify-types.ts` type-checks a consumer file so a regression fails the build. Drop both when the compiler fixes it.
- **pnpm**, for supply-chain safety. The settings live in `pnpm-workspace.yaml`; don't relax them without a TASKS decision entry:
  - dependency lifecycle scripts are blocked (`strictDepBuilds`, empty `allowBuilds`)
  - `minimumReleaseAge` is 3 days
  - `trustPolicy: no-downgrade`
  - `blockExoticSubdeps`
- **Builds:** `dist/dev` is `tsc` output — readable, with source maps and declaration maps into the TypeScript, which is why `src/` ships too. `dist/prod` is one minified esbuild bundle where `env.ts` is swapped for `env.prod.ts`, so error messages fall away and errors carry a code plus a docs URL. The `exports` map picks between them with the `development` condition. `dist/cli` is a third output: one esbuild bundle of `packages/cli` and `packages/check` with a hashbang, which `bin` points at, built by `scripts/build-cli.ts` and proven by `scripts/verify-cli.ts` — that script runs the **built** command, because `bin` ships the bundle and the package's tests do not touch it. `typescript` stays external to it: it is an optional peer dependency, resolved from the project being checked.
- **Size budget:** `size-budget.json` holds brotli sizes per scenario; the build fails above them plus 2%. Re-record only for an intended change, and say why in the PR.
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
- A type assertion is for an invariant the compiler cannot see — an index the algorithm has just proved is in range — never for silencing a real mismatch. `noUncheckedIndexedAccess` stays on, which is why they appear in the graph and list code at all.
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

## Layers, in application code

`examples/hello` is the worked example of SPEC §4, and the rule is the same in
any app built with Sheratan:

| File | Owns | May not |
|---|---|---|
| `*.state.ts` | signals and pure transitions; everything derivable is a `computed` | do I/O, touch the DOM, import effects, a view, or a service adapter |
| `*.effects.ts` | sequencing: calls a service contract, then invokes **one** transition | decide what data means, write a signal directly, import a view |
| `*.view.ts` | markup as a pure function of state; declares the intents it needs | do I/O, import effects or an adapter |
| `services/*.contract.ts` | the interface modules depend on; every promise-returning method takes an `AbortSignal` | know about a transport |
| `index.ts` | the module's only public surface: `kind` plus a factory returning a view function | — |
| `app.ts` | the one place a contract meets an adapter | contain feature logic |

The checker enforces this (`SHR-L001`, `SHR-L002`) and runs over
`examples/hello` inside `pnpm check`. `.oxlintrc.json` repeats a subset with
`no-restricted-imports` and `no-restricted-globals`, keyed by filename, for one
reason: it shows in the editor as you type, and the checker does not yet. So
**a change to the import matrix or the I/O globals updates `.oxlintrc.json` in
the same PR**, or the two start giving different verdicts. The lint rules go
once the checker has editor feedback (TASKS, Week 3 CLI).

**Two things a new lint rule needs:**
- **Break the code once to prove the rule fires.** A rule that matches nothing
  is worse than no rule: CI is green and nothing is enforced.
- **No lookahead.** Oxlint matches with Rust's regex engine, which has no
  `(?!…)`, and an unsupported pattern simply never matches. Use `group` globs,
  where `!` negation works (`["**/services/**", "!**/services/*.contract.ts"]`).

## Performance and algorithms

The runtime's value is its update cost, so algorithmic complexity is part of
the contract. Pick the best known algorithm for each operation. A PR that
worsens a bound below needs a TASKS decision entry and a benchmark.

| Operation | Bound | How |
|---|---|---|
| Signal read / write (no observers) | O(1) | |
| Dependency link / unlink | O(1) | Doubly-linked edge lists (alien-signals design); edges reused across re-runs, no per-run allocation when deps are unchanged |
| Re-run with changed deps | O(changed) | Stale tail edges purged after the run |
| Write propagation | O(affected subgraph) | Iterative push of Pending/Dirty flags on an explicit stack: a 100k-deep graph propagates without touching the call stack. Evaluation still recurses through the user's own functions, which pull-based derivation cannot avoid |
| Computed read | O(1) cached; O(sources checked) when pending | Pull re-validation stops at the first dirty source |
| Owner child add / remove | O(1) | Intrusive linked list |
| Row lookup for an event handler | O(1) | Inherited at owner creation, never walked |
| Template parse | O(markup), **once per call site** | Cached by the `TemplateStringsArray` |
| Template instantiate | O(clone + path steps to holes) | Hole paths precomputed at parse; marker attributes stripped from the template; no per-mount scan, string parse or `Map` |
| Hole update | O(1) DOM writes per changed hole | One frame watcher per reactive hole |
| `each` reconcile | O(n) diff, O(n log n) moves, **minimum DOM moves** | Key `Map`; common prefix/suffix skipped; longest increasing subsequence decides which rows stay; `moveBefore` where the browser has it, so a moved row keeps focus and media state |
| Freezing a new state value | O(new nodes) | Subtrees that are already frozen are skipped, so structural sharing pays only for what it allocated |
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
- **Host capabilities are tested both ways** (`test/host.test.ts`): with and without `requestAnimationFrame`, with and without `moveBefore`.
- **Time:** use `flush()` or fake timers. Never sleep, except the one test proving the scheduler runs unaided.
- **Leaks:** a mount/dispose loop returns `liveSubscriptions()` to its starting value. Add one for any new owner-scoped resource.

## Documentation obligations

A change to the public API updates, in the same PR:
1. TSDoc — `llms.txt`'s API table is generated from it (`pnpm --filter sheratan llms`), and CI fails when it is stale
2. the SPEC section it implements
3. the export-surface test, which lists the exact public names (SPEC A5)

A decision with a real trade-off gets an ADR in `Docs/adr/` (see its README for
when); a one-line outcome goes in the TASKS decisions log instead.

A behaviour change updates the relevant SPEC section. A resolved gap gets ticked in TASKS with where it was resolved.

## Definition of done

1. `pnpm check` is green locally, and CI is green on the PR.
2. **A fresh read of every function you touched:** does it do one thing, and does it read top to bottom without a comment explaining the flow? Structural compliance (tests exist, constants exist) is not the same as clean code.
3. Complexity bounds above still hold; new hot-path code states its bound in the PR.
4. Docs obligations met. No TODOs without a TASKS entry.
5. **Progress is current before the PR opens:** the TASKS items this change completes are ticked with where, and the **Status table** at the top of TASKS says where the week now stands — the row's status and its gate-result line ("Checker 4 of 16 codes"). The PR description says what moved.

## AI_Web_App_Checklist applicability

The team's launch checklist (`~/Projects/AI_Web_App_Checklist.md`) is written
for LLM apps. For a framework, this is what applies.

| Section | Status | Where it lands here |
|---|---|---|
| §1 model layer, §2 SSE, §3 API keys, §4a moderation, §5–6 chat client, §10 PWA, §11 markdown, §13 browser ML, §14 RAG, §19 voice, §20 Tauri, §22 AWS, §23 GitHub App | N/A | No LLM, server or chat UI in this repo |
| §4 security headers | Partial, **accepted** | `site/` sends a `<meta>` CSP because GitHub Pages cannot set HTTP headers — no HSTS, no `X-Content-Type-Options`. Decided 2026-09-17: accepted rather than moving hosts, since the site is static, has no auth and takes no input. Revisit only if it ever does. The policy itself allows no third-party origin at all — `default-src 'none'` with `'self'` for fonts and fetches, and one script hash. The runtime escapes holes by default (SPEC §9) |
| §7–9 accessibility, mobile, web vitals | Partial | `site/` and, later, `examples/dashboard` |
| §12 unit testing | Applies | Tests section above |
| §15 observability | Remapped | The causal trace (SPEC §7) is the framework's observability story |
| §16 evals | Remapped | `Docs/EVAL.md` performance and agent-authoring evals, with go/no-go gates |
| §17 CI/CD | Applies | `ci.yml`: SHA-pinned actions, frozen lockfile, lint → typecheck → build → coverage → audit, dependency review on PRs, daily audit |
| §17a package hygiene | Applies (pnpm) | Toolchain decisions above |
| §17b / §17c clean code | Applies | Code rules above, enforced by `.oxlintrc.json` and `.oxfmtrc.json` |
| §18 Vercel | N/A | Site is on GitHub Pages |
| §21 README | Applies | Quickstart and repository map in `README.md` |
