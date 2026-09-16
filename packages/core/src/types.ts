// Public value types (SPEC §5).

/**
 * A value that cannot hold nested state, so it is returned unchanged. The list
 * matches what `freeze()` declines to freeze: a class instance breaks when its
 * members are mapped, and an `Error` mapped member-by-member stops being one.
 */
type Opaque =
  | string
  | number
  | boolean
  | bigint
  | symbol
  | null
  | undefined
  | Node
  | Date
  | RegExp
  | Error;

/**
 * A value as a signal hands it out: readable everywhere, writable nowhere.
 *
 * Mutating state in place is the mistake a code-generating agent makes most
 * often, so it fails to type-check and, for plain objects and arrays, throws
 * at run time as well (SPEC §5 Immutability).
 */
export type DeepReadonly<T> = T extends Opaque
  ? T
  : T extends (...args: never[]) => unknown
    ? T
    : T extends ReadonlyMap<infer K, infer V>
      ? ReadonlyMap<DeepReadonly<K>, DeepReadonly<V>>
      : T extends ReadonlySet<infer V>
        ? ReadonlySet<DeepReadonly<V>>
        : { readonly [K in keyof T]: DeepReadonly<T[K]> };

/** A read-only reactive value: a computed, or a signal passed around for reading. */
export type Accessor<T> = () => T;

/** A writable signal: call to read, `.set()` to write. */
export interface Signal<T> {
  (): DeepReadonly<T>;
  /** Replaces the value. Equal writes (`Object.is`) notify nobody. */
  set(value: T | DeepReadonly<T>): void;
}
