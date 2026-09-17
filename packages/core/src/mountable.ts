// A child hole can receive something that mounts itself, which today is only
// `each()`. The brand lets the binder recognise it without importing it, so
// the template and list modules stay independent.

/** Marks a value that takes over a child hole's marker and manages its nodes. */
export const MOUNT: unique symbol = Symbol('sheratan.mount');

/** Something a child hole can hand its marker to. */
export interface Mountable {
  [MOUNT](marker: Comment): void;
}

/** Whether a hole value mounts itself. */
export function isMountable(value: object): value is Mountable {
  return MOUNT in value;
}
