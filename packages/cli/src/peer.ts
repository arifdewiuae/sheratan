// `typescript` is an optional peer dependency of `sheratan`: the checker reads
// programs with the compiler, the runtime never touches it, and an app that
// only renders must not be nagged for one it will not use (TASKS, "How many
// packages publish").
//
// The cost is that the checker's first import can fail at load. This module
// turns that into what SPEC A2 and A3 ask for: a message naming what is
// missing and what to install.

/** What to print when the compiler the checker reads programs with is absent. */
export const MISSING_TYPESCRIPT =
  'sheratan check needs the TypeScript compiler, which sheratan leaves optional so an app that only renders never installs one.';

/** How to get it, in the form a package manager takes. */
export const INSTALL_TYPESCRIPT =
  'Install it in the project you are checking: npm install -D typescript@7 (pnpm add -D, yarn add -D).';

/** Node's word for a package it could not resolve. */
const NOT_FOUND = 'ERR_MODULE_NOT_FOUND';

/** The package named in the message, whichever of its entries failed. */
const TYPESCRIPT = /'typescript(?:\/[^']*)?'/;

/**
 * Whether `error` is the compiler missing, rather than a fault in the checker.
 * Anything else is the caller's to rethrow: swallowing it turns a bug into
 * advice about an install that is already fine.
 */
export function isMissingTypescript(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const code: unknown = Reflect.get(error, 'code');

  return code === NOT_FOUND && TYPESCRIPT.test(error.message);
}
