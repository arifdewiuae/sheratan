// The public API (SPEC §5, §6, §9). Fifteen names: if this list grows, check
// it against axiom A5 first — the whole surface fits on one screen.

export { ErrorCode } from './codes.ts';
export { computed } from './computed.ts';
export { each } from './each.ts';
export { SheratanError } from './errors.ts';
export { mutation, MutationStatus } from './mutation.ts';
export { render } from './render.ts';
export { resource, ResourceStatus } from './resource.ts';
export { batch, flush } from './scheduler.ts';
export { signal } from './signal.ts';
export { stream, StreamStatus } from './stream.ts';
export { html } from './template.ts';
export { onDispose } from './owner.ts';
export { watch } from './watch.ts';

export type { Disposer } from './disposer.ts';
export type { Each, EachWindow, Key } from './each.ts';
export type { Mutation, MutationContext, MutationOptions } from './mutation.ts';
export type { FetchContext, Resource, ResourceOptions } from './resource.ts';
export type { Stream, StreamContext, StreamOptions, Teardown } from './stream.ts';
export type { Template } from './template.ts';
export type { Accessor, DeepReadonly, Signal } from './types.ts';
