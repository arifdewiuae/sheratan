<h1 align="center">S H E R A T A N</h1>

<p align="center">
  <b>Architectural boundaries, enforced.</b><br>
  A frontend framework with one legal way to structure an app, enforced by a
  checker with machine-readable fixes, plus async and live data in the core.
</p>

---

> ## ⚠️ Pre-release — name reservation
>
> **This version is not usable software.** It exists to hold the name while the
> MVP is built. There is no stable API, no checker and no CLI yet, and anything
> here can change or disappear without a deprecation.
>
> Watch [the repository](https://github.com/arifdewiuae/sheratan) for the first
> real release. Don't build on this.

## What it will be

For a code-generating agent, the problem with today's frameworks isn't a missing
linter. It's that there are too many legal ways to do the same thing. Sheratan
removes the choice:

- **One module shape.** `state` holds signals and pure transitions, `effects`
  holds everything impure, and `view` is a pure function of state.
- **One import matrix,** checked statically. Every violation comes back as JSON
  with a stable code, a location and a `fix`, so an agent can repair it in one
  turn.
- **Async in the core.** `resource()`, `mutation()` and `stream()` handle
  cancellation, staleness, retries and frame-coalesced push data.
- **Zero runtime dependencies,** one package, no bundler and no config — type
  stripping only.

## Status

The runtime is built and tested; the checker and CLI are specified and not yet
written. Progress is tracked in the open, including what has failed:

| | |
|---|---|
| [Specification](https://github.com/arifdewiuae/sheratan/blob/develop/Docs/SPEC.md) | The source of truth, ahead of the code |
| [Comparison](https://github.com/arifdewiuae/sheratan/blob/develop/Docs/COMPARISON.md) | Measured against Solid, Svelte, Vue, React and Angular |
| [Eval results](https://github.com/arifdewiuae/sheratan/blob/develop/Docs/EVAL-RESULTS.md) | What the agent-repair evaluation actually showed |
| [Progress](https://github.com/arifdewiuae/sheratan/blob/develop/Docs/TASKS.md) | Week by week, with go/no-go gates |

## License

MIT © Arif Dewi
