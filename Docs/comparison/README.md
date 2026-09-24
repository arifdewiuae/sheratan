# Reproducing the comparison

The numbers in [`../COMPARISON.md`](../COMPARISON.md) come from this directory.
It is **its own pnpm root** (`pnpm-workspace.yaml` here, with empty `packages`):
nothing in it is a dependency of Sheratan, the repository root's workspace globs
never reach it, and `pnpm install` at the repository root does not touch it.

```sh
pnpm --filter sheratan build       # from the repo root: writes packages/core/dist/prod
cd Docs/comparison
pnpm install
pnpm measure                       # size, the table in ../COMPARISON.md
pnpm perf                          # speed, the Week 1 gate
```

Run `pnpm install` from **inside this directory**. Running it with
`--ignore-workspace` from anywhere else rewrites the repository's own
`pnpm-lock.yaml`, which is not what anyone wants and is why the local
`pnpm-workspace.yaml` exists.

The lockfile this produces is **not committed**. Committing it would put six
frameworks' transitive trees into the repository's dependency graph, which is
the thing this directory exists to avoid — and an advisory in someone else's
framework would then block an unrelated pull request. What the rows are
measured against is pinned instead in `package.json`, exactly, and listed in
[`../COMPARISON.md`](../COMPARISON.md#versions).

## Size — `pnpm measure`

`measure.ts` bundles one entry per stack with esbuild — `bundle`, `minify`,
`target: es2022`, `platform: browser`, `NODE_ENV=production` — and gzips the
result at level 9. Every stack goes through the same function, so the rows are
comparable to each other even where the absolute number is not what a given app
would ship.

Svelte is compiled for real: `app.svelte` is put through `svelte/compiler` by an
esbuild plugin, so its row is the runtime a component actually pulls in rather
than the whole of `svelte/internal/client`.

## Speed — `pnpm perf`

The Week 1 gate: 500 rows reordered, within 2× of Solid on p95 frame time.

- `perf/workload.ts` — the workload, shared by both arms so neither can be
  measured on an easier version of it: 500 rows, 20 swaps per frame, the same
  seeded swap sequence for every arm and every run.
- `perf/driver.ts` — the instrument. One sample is the work inside one animation
  frame: apply the swaps, commit, force style and layout.
- `perf/sheratan.ts` and `perf/solid.jsx` — the arms. Sheratan is aliased to
  `packages/core/dist/prod/index.js`, the bundle a user installs. Solid goes
  through `babel-preset-solid`, for the same reason Svelte is compiled above.
- `perf/run.ts` — builds both, serves them, and drives headless Chromium through
  Playwright: 5 runs per arm, **interleaved**, so a machine that warms up over
  the session does not hand the advantage to whichever arm ran first. Exit code
  1 if the gate is missed.

It prints p95 and median frame time per arm, the spread across the 5 runs, and
the ratio against the 2× gate. Re-record `../COMPARISON.md` and the date on it
when you re-run, and say which machine it was — the ratio travels between
machines, the milliseconds do not.

**Checking the instrument.** Stub `longestIncreasing()` in
`packages/core/src/lis.ts` to return `[]`, rebuild, and re-run: every row then
moves instead of the minimum, and Sheratan's p95 should roughly double. A
benchmark that cannot see a deliberately broken reconciler is measuring
something else.

## Supply chain

`pnpm-workspace.yaml` here mirrors the repository root's policy —
`minimumReleaseAge`, `trustPolicy: no-downgrade`, `blockExoticSubdeps`, and no
dependency lifecycle scripts. Two deviations, both deliberate:

- `semver` is overridden to 7, because `@babel/core` still asks for semver 6,
  whose releases predate npm provenance and so read as a trust downgrade.
  Overriding the one package keeps the policy on rather than turning it off.
- `esbuild` and `vue-demi` builds stay blocked, as at the root: esbuild's
  postinstall only re-verifies the platform binary `optionalDependencies`
  already supplied, and vue-demi's picks a Vue 2/3 shim nothing here loads.

When you re-record, update the versions in `package.json`, the tables in
`../COMPARISON.md`, and the date on it.
