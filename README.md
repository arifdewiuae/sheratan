<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/mark-dark.svg">
    <img src=".github/assets/mark-light.svg" width="96" height="96" alt="sheratan mark">
  </picture>
</p>

<h1 align="center">s h e r a t a n</h1>

<p align="center">
  <b>Architectural boundaries, enforced.</b><br>
  A frontend framework with one legal way to structure an app, enforced by a checker
  with machine-readable fixes, plus async and live data in the core.
</p>

<p align="center">
  <a href="https://arifdewiuae.github.io/sheratan/">Website</a> ·
  <a href="Docs/SPEC.md">Spec</a> ·
  <a href="Docs/EVAL.md">Eval</a> ·
  <a href="Docs/TASKS.md">Progress</a>
</p>

---

> **Pre-release.** There is no code to install yet. This repository holds the
> specification, the evaluation plan and the website while the MVP is built.

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

## Repository

| Path | What |
|---|---|
| `Docs/SPEC.md` | Technical specification. The source of truth for implementation |
| `Docs/EVAL.md` | Performance and agent-authoring evaluation plan, with go/no-go gates |
| `Docs/TASKS.md` | Progress tracker for the MVP |
| `Docs/sheratan-identity.html` | Brand identity |
| `site/` | Website: plain HTML, no build. Open `site/index.html` |

## The name

β Arietis, from Arabic *aš-šaraṭān*, "the two signs". With its neighbour it once
marked the vernal equinox, the reference point the year is measured from.

## License

[MIT](LICENSE)
