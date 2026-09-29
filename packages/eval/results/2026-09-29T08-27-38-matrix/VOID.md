# Void: the first Week 0 matrix, 2026-09-29

18 of 18 cells ran, $42.71 with the correction below, and `matrix.json` computes
**gate MET**. That verdict does not stand, and nothing is decided on this grid.

## Why

The sandbox confined the agent by convention only. Its `node_modules` was a link
into this repository, the link's target gave the repository's path away, and the
agents followed it. Read from every session's transcript after the run:

| | Sheratan | React |
|---|---|---|
| Sessions that touched the repository | 9 of 9 | 1 of 9 (to borrow Playwright) |
| Read a hidden suite or `evalkit` source | 1 — T01 seed 3 read `suites/T01.spec.ts`, `suites/harness.ts` and `evalkit/src/{control,state}.ts` | 0 |
| Read documentation outside the §1.5 budget | 1 — T04 seed 2 read `examples/hello` | 0 |
| Wrote into the repository | 1 — T04 seed 2, verification scripts in `packages/eval`, deleted again | 0 |

Several Sheratan sessions also read the runtime's source in `packages/core`.
That is not counted as a leak: the published package ships `src/`, as React's
ships its own, and an agent under the new harness can still read it inside its
own installed tree.

The harness watched the network for test-only surfaces and never the file
system, so none of this was refused or recorded. Every leak ran in Sheratan's
favour.

## What still holds

A leak could only have helped Sheratan, so the results that favour React stand
as lower bounds on the gap:

- Cost: Sheratan $26.60 across nine cells against React's $16.10.
- T03 (form): Sheratan wrote 1,146–1,407 lines per run against 557–780, ran
  29–41 shell commands against 6–12, and took almost three times as long. Of
  Sheratan's lines, 320–540 were tests; React's were 32–46.
- T04: all three React first attempts failed *when one of two ships fails, only
  that row goes back*; all three Sheratan first attempts passed it.

## Other defects found in this run

- T03-sheratan-seed1's first turn hit the 15-minute limit. The CLI was killed
  before it replied, so the cell records $0.00; the turn's own cost, $2.59, is
  in the session transcript and in `corrections.json`. The cell file is left as
  the harness wrote it.
- `--allowedTools` pre-approved seven tools without hiding the rest: agents
  used the built-in `run` skill (Sheratan 2, React 3), tool search (4 and 4) and
  one React subagent. No installed plugin or skill was used.

All three are fixed in the harness that replaces this one (EVAL-TASKS §1.4,
step 6).
