# 0001 — Where each supply-chain check runs

**Status:** accepted, 2026-09-16

## Context

The runtime has zero dependencies (SPEC A4), so the supply chain we actually
run is the dev toolchain: linters, compilers, test runners, browsers. pnpm
gives us four defences, configured in `pnpm-workspace.yaml`: dependency
lifecycle scripts blocked, a three-day `minimumReleaseAge`, `trustPolicy:
no-downgrade`, and `blockExoticSubdeps`. On top of that, two commands report
rather than prevent:

- `pnpm audit` — known advisories for the installed tree.
- `pnpm audit signatures` — verifies each package's registry signature.

`pnpm audit signatures` verifies **every entry in the lockfile**, including
platform packages we never install (`@typescript/typescript-linux-mips64el`,
`@esbuild/linux-arm64`). Each needs its full packument from the registry, and
in practice a handful of requests fail per run — a different handful each time
(three, then none, then two), while the same URLs serve fine over `curl`. The
failure is reported as "Someone might have tampered with these packages", which
is alarming, unactionable, and wrong.

A gate that fails for reasons unrelated to the change in front of it teaches
people to re-run CI until it passes, which is how a real signal gets ignored.

## Decision

- `pnpm audit` (advisories) stays in `pnpm check` and blocks every PR.
- `pnpm audit signatures` moves to the **daily scheduled CI run**, where a
  transient registry failure costs a re-run and nothing else, and where a
  genuine signature problem still surfaces within a day.
- The preventive settings stay where they are: they do not depend on the
  network at check time, and they are what actually stops a hijacked release
  from being installed.

## Trade-off accepted

A tampered package could be installed and used for up to a day before the
scheduled run flags it. `minimumReleaseAge` (3 days) and `trustPolicy` already
cover the realistic version of that attack, which is a freshly published
hijacked release.

## Revisit if

`pnpm audit signatures` becomes reliable (or gains a way to verify only the
packages installed for this platform), in which case it returns to `check`.
