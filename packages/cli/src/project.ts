// What an app's files are called, and what the framework is called inside
// them. `dev` and `build` are the same job with two destinations, so the facts
// they share about a project live here rather than twice.

/** TypeScript on the way in. */
export const SOURCE_FILE = '.ts';

/** JavaScript on the way out: what a `.ts` becomes once its types are gone. */
export const STRIPPED_FILE = '.js';

/** A page: the one kind of file both commands rewrite rather than copy. */
export const PAGE_FILE = '.html';

/** Every source either command reads is text a browser will run. */
export const ENCODING = 'utf8';

/** The package a project installs, and which both commands hand out. */
export const RUNTIME = 'sheratan';

/**
 * The bare specifier a page maps, as an import map writes it. A browser cannot
 * resolve one on its own, so this is the entry `build` rewrites and `dev`
 * answers for.
 */
export const RUNTIME_SPECIFIER: RegExp = /("sheratan"\s*:\s*")[^"]*(")/;

/** Where the runtime sits beside a page, in the output and on the server. */
export const RUNTIME_DIRECTORY: string = RUNTIME;
