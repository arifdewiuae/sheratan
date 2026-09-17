// The production trace: nothing. `scripts/build-prod.ts` resolves `trace.ts`
// to this file, the way it swaps `env.ts` for `env.prod.ts`, so the buffer, the
// stack capture and `__sheratan` are absent from a shipped bundle rather than
// merely unreachable in one (SPEC §7). The build asserts it.
//
// The `DEV` guards at the call sites still earn their place: they make each
// hook a boolean test instead of a call into one of these.

/** No-op: a production build records nothing. */
export function traceWrite(_from: unknown, _to: unknown): void {}

/** No-op: a production build records nothing. */
export function traceCompute(_node: object): void {}

/** No-op: a production build records nothing. */
export function tracePatch(_target: Node): void {}

/** No-op: a production build records nothing. */
export function traceQueued(_job: object): void {}

/** No-op: a production build records nothing. */
export function traceRunning(_job: object): void {}

/** No-op: a production build records nothing. */
export function traceIdle(): void {}

/** No-op: there is no debugging surface to install. */
export function installTrace(): void {}
