// Runtime error codes (SPEC §4: the `R` family is reserved for the runtime).
// Codes are stable and never reused: they are what an agent matches on, and
// what the docs URL in a production build points at.

/** Stable identifier carried by every error the runtime throws. */
export const ErrorCode = {
  /** `onDispose()` was called with no owner mounting. */
  DisposeOutsideOwner: 'SHR-R001',
  /** A watcher kept writing what it reads and never settled. */
  WatchersDidNotSettle: 'SHR-R002',
  /** A hole inside a tag was not a whole attribute value. */
  PartialAttributeHole: 'SHR-R003',
  /** A hole landed where the HTML parser cannot keep its marker. */
  UnreachableHole: 'SHR-R004',
  /** An `@event` hole received something other than a function. */
  EventHoleNotFunction: 'SHR-R005',
  /** An `each()` item is an object with no `id`. */
  EachItemWithoutId: 'SHR-R006',
  /** Two `each()` items resolved to the same key. */
  EachDuplicateKey: 'SHR-R007',
  /** An array reached a hole, which renders many and needs `each()`. */
  ArrayInHole: 'SHR-R008',
} as const;

/** One of the runtime error codes. */
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** Where a production build sends you for the full explanation of a code. */
export const DOCS_BASE_URL = 'https://sheratan.dev/errors/';
