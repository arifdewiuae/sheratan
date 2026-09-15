// Public types for `sheratan` (SPEC §5, §9). The runtime is plain ESM; these
// declarations exist so TypeScript projects type-check with type stripping only.

/** A writable signal: call to read, `.set()` to write. */
export type Signal<T> = { (): T; set(value: T): void };

/** A read-only reactive value: a computed, or a signal passed around for reading. */
export type Accessor<T> = () => T;

export function signal<T>(initial: T): Signal<T>;
export function computed<T>(fn: () => T): Accessor<T>;
/** Runs now and whenever what it read changes. Returns a disposer. */
export function watch(fn: () => void): () => void;
/** Writes inside commit once, when the outermost batch ends. */
export function batch<T>(fn: () => T): T;
/** Teardown for subscriptions the runtime cannot see. `*.effects.ts` only (SHR-L004). */
export function onDispose(fn: () => void): void;
/** Apply pending DOM updates now (tests, layout measurement). */
export function flush(): void;

export interface Template { readonly __brand: 'Template' }
export interface Each { readonly __brand: 'Each' }

type Key = string | number;
type Hole =
  | string | number | boolean | null | undefined
  | Node | Template | Each
  | Accessor<unknown>
  | ((payload: any, item?: any) => unknown);

export function html(strings: TemplateStringsArray, ...values: Hole[]): Template;

/** Keyed list: objects by `id`, primitives by value. `row` runs once per key. */
export function each<T extends { id: Key } | Key>(
  list: Accessor<readonly T[]> | readonly T[],
  row: (item: Accessor<T>) => Template,
): Each;

/** Mount a view into `el`; owns only the nodes it inserts. Returns a disposer. */
export function render(view: () => Template, el: Element): () => void;
