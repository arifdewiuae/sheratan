// Shared by the async primitives (SPEC §6). `resource()` and `stream()` both
// take a reactive key and both have to turn whatever was thrown into a value,
// and a rule that lives in two files is a rule that drifts.

/** The `name` every host rejects a cancelled request with. */
const ABORT_ERROR = 'AbortError';

/** Keys compare by contents, so a rebuilt array with the same parts is the same key. */
export function sameKey(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((part, index) => Object.is(part, right[index]));
}

/** Cancellation is not failure (SPEC §5b rule 3), so it has to be recognisable. */
export function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === ABORT_ERROR;
}

/** Errors are values, and a value has to be an Error even when a string was thrown. */
export function toError(thrown: unknown): Error {
  return thrown instanceof Error ? thrown : new Error(String(thrown));
}
