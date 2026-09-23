// Type stripping (SPEC §10c). "No build" means no bundler, no config and no
// plugin pipeline — not that the browser runs TypeScript. Types come off and
// nothing else changes: the output is the input with the annotations blanked,
// line for line, so a stack trace still points at the source.
//
// The stripper is Node's own (`node:module`), which is why `sheratan build`
// needs nothing installed — not even the optional TypeScript that the checker
// asks for. It can only erase, never compile, which is exactly the promise:
// syntax that has to be emitted rather than removed is refused by name.

import { stripTypeScriptTypes } from 'node:module';

import { STRIPPED_FILE } from './project.ts';

/**
 * `from './x.ts'` and `import('./x.ts')`: a relative specifier keeps the
 * extension it was written with, and the file it names is now `.js`.
 */
const RELATIVE_IMPORT = /(\b(?:from|import)\s*\(?\s*)(['"])(\.[^'"]*)\.ts\2/g;

/**
 * `source` with its types removed and nothing else touched. Throws what Node
 * throws for syntax that cannot be erased; the caller says which file it was.
 */
export function stripTypes(source: string): string {
  return stripTypeScriptTypes(source, { mode: 'strip' });
}

/**
 * `source` with its relative `.ts` imports pointed at the files they will be.
 * Only a build needs this: `dev` serves each source at the path it was written
 * with, so the specifier a file already carries is the one that resolves.
 */
export function rewriteExtensions(source: string): string {
  return source.replaceAll(RELATIVE_IMPORT, `$1$2$3${STRIPPED_FILE}$2`);
}
