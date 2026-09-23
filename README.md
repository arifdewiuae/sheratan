<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/mark-dark.svg">
    <img src=".github/assets/mark-light.svg" width="96" height="96" alt="sheratan mark">
  </picture>
</p>

<h1 align="center">S H E R A T A N</h1>

<p align="center">
  <b>Architectural boundaries, enforced.</b><br>
  A frontend framework with one legal way to structure an app, enforced by a checker
  with machine-readable fixes, plus async and live data in the core.
</p>

<p align="center">
  <a href="https://sheratan.dev">Website</a> ·
  <a href="Docs/SPEC.md">Spec</a> ·
  <a href="Docs/guides/web-components.md">Component libraries</a> ·
  <a href="Docs/COMPARISON.md">Comparison</a> ·
  <a href="Docs/EVAL.md">Eval</a> ·
  <a href="Docs/EVAL-RESULTS.md">Results</a> ·
  <a href="Docs/TASKS.md">Progress</a>
</p>

---

> **Pre-release.** `sheratan@0.0.1` on npm is a name reservation, not usable
> software — don't build on it. This repository holds the specification, the
> evaluation plan, the website and the core runtime while the MVP is built.

[![CI](https://github.com/arifdewiuae/sheratan/actions/workflows/ci.yml/badge.svg?branch=develop)](https://github.com/arifdewiuae/sheratan/actions/workflows/ci.yml)

## The idea

For a code-generating agent, the problem with today's frameworks isn't a missing
linter. It's that there are too many legal ways to do the same thing. Sheratan
removes the choice:

- **One module shape.** `state` holds signals and pure transitions, `effects`
  holds everything impure, and `view` is a pure function of state.
- **One import matrix,** checked statically. Every violation comes back as JSON
  with a stable code, a location and a `fix`, so an agent can repair it in one turn.
- **Async in the core.** `resource()`, `mutation()` and `stream()` handle
  cancellation, staleness, retries and frame-coalesced push data.
- **No bundler.** The core is plain ESM with zero runtime dependencies. TypeScript
  projects need type stripping only.

The honest version of the claim, including prior art (Elm, Solid, Lit, boundary
linters) and what Sheratan won't do, is in [the spec](Docs/SPEC.md).

## What it takes to match one import

Signals, derived values, rendering without a virtual DOM, keyed lists, windowed
lists, and the async request lifecycle — cancel on key change, deduplicate,
discard out-of-order responses, retry with backoff, revalidate — plus push data
folded once per frame. That is one import. Reaching the same place elsewhere,
bundled and gzipped the same way ([method](Docs/comparison/README.md)):

| Stack | Packages | gzip |
|---|---|---|
| **Sheratan** | **1** | **6.9 kB** |
| Solid 1.9 | 3 | 25.6 kB |
| Svelte 5 | 3 | 37.0 kB |
| Vue 3 | 3 | 41.8 kB |
| React 19 | 4 | 84.1 kB |
| Angular 19 | 5 | 145.5 kB |

The whole of Sheratan is smaller than the smallest single piece of any of them.

Size is the easiest axis to verify, not the one that matters. The one this
project exists for is the other table: **none of those five is designed to be
written by a model.** One legal structure instead of five conventions,
violations that come back as JSON with the code to write instead, and docs
generated from the declarations so they cannot drift from them.
[What is being matched, what Sheratan does not have, and the caveats](Docs/COMPARISON.md)
— including that there is no router, no server rendering, and no proof yet that
any of it makes an agent measurably better.

## Repository

| Path | What |
|---|---|
| `packages/core/` | The runtime: signals, templates, keyed and windowed `each`, `render`, `resource`, `mutation`, `stream`, and the causal trace. Zero runtime dependencies |
| `packages/check/` | The checker behind `sheratan check`: the import matrix, the I/O globals, cycles and the state surface, as machine-readable findings |
| `packages/cli/` | The `sheratan` command (SPEC §10). Today it runs the checker; the rest of the commands are specified and not built |
| `packages/eval/` | The Week 0 self-repair eval: host app, injected violations, raw logs |
| `examples/hello/` | A live dashboard in the canonical module shape: 500 rows, 20,000 values a second, sorted on every batch |
| `llms.txt` | The API as an agent should learn it |
| `Docs/SPEC.md` | Technical specification. The source of truth for implementation |
| `Docs/EVAL.md` | Performance and agent-authoring evaluation plan, with go/no-go gates |
| `Docs/EVAL-RESULTS.md` | What the Week 0 falsification gate actually measured, and what it did not |
| `Docs/COMPARISON.md` | Size and capability against Solid, Svelte, Vue, React and Angular, with the method in `Docs/comparison/` |
| `Docs/adr/` | Decisions with a real trade-off, written up once |
| `Docs/guides/` | Using a web-component library inside a Sheratan view |
| `Docs/TASKS.md` | Progress tracker for the MVP |
| `Docs/sheratan-identity.html` | Brand identity |
| `site/` | Website: plain HTML, no build. Serve `site/` with any static file server |
| `AGENTS.md` | How to work in this repo: commands, code rules, complexity bounds, definition of done |

## Development

Requires Node (version in `.nvmrc`) and pnpm (version pinned in `package.json`).

```sh
pnpm install --frozen-lockfile
pnpm check   # format, lint, typecheck, build, tests + coverage gate, package checks, audit
```

The runtime is 6.8 KB brotli with zero dependencies, and every commit is
measured against `packages/core/size-budget.json`.

Run the example — 500 rows under a synthetic 20,000 values/second feed, re-sorted
on every batch:

```sh
pnpm build                         # the example imports the built runtime
pnpm --filter example-hello dev    # http://localhost:5173
pnpm --filter example-hello e2e    # the same flows in a real browser
```

No bundler is involved: the dev server strips TypeScript and serves ESM. For
the version with no build step at all, serve the repository with any static
file server and open `examples/hello/public/no-build.html`.

Check an app against the architecture rules — the same findings an editor and
an agent read:

```sh
pnpm sheratan check examples/hello          # a line per violation, with the fix
pnpm sheratan check examples/hello --json   # one versioned object, for a tool
```

In an app that installed the framework, the same command comes with it —
`sheratan` ships a `bin`, so there is nothing else to install:

```sh
npx sheratan check .          # exit 0 clean, 1 violations, 2 could not run
npx sheratan check . --json   # { "version": 1, "findings": [ … ] }
```

The checker reads your code with the TypeScript compiler, so `typescript` is an
optional peer dependency: an app that only renders installs nothing extra, and
`sheratan check` tells you to add it if it is not there.

All changes go through pull requests into `develop`; `main` is for releases.
Read [AGENTS.md](AGENTS.md) before opening one.

## The name

β Arietis, from Arabic *aš-šaraṭān*, "the two signs". With its neighbour it once
marked the vernal equinox, the reference point the year is measured from.

## License

[MIT](LICENSE)
