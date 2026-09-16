# Reproducing the comparison

The numbers in [`../COMPARISON.md`](../COMPARISON.md) come from this directory.
It is deliberately **outside the pnpm workspace** (`pnpm-workspace.yaml` globs
only `packages/*` and `examples/*`): nothing here is a dependency of Sheratan,
and `pnpm install` at the root does not touch it.

```sh
pnpm --filter sheratan build       # from the repo root: writes packages/core/dist/prod
cd Docs/comparison
pnpm install --ignore-workspace
pnpm measure
```

`measure.ts` bundles one entry per stack with esbuild — `bundle`, `minify`,
`target: es2022`, `platform: browser`, `NODE_ENV=production` — and gzips the
result at level 9. Every stack goes through the same function, so the rows are
comparable to each other even where the absolute number is not what a given app
would ship.

Svelte is compiled for real: `app.svelte` is put through `svelte/compiler` by an
esbuild plugin, so its row is the runtime a component actually pulls in rather
than the whole of `svelte/internal/client`.

When you re-record, update the versions in `package.json`, the table in
`../COMPARISON.md`, and the date on it.
