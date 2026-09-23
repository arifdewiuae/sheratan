// `sheratan build` (SPEC §10c): the app's TypeScript with its types removed,
// beside everything else it needs, in a directory a static host can serve.
// No bundler, no config, no plugin pipeline — `dev` and `build` differ only in
// where the stripped output goes.
//
// The runtime is copied in beside the pages that name it, because a browser
// cannot resolve a bare specifier on its own: what ships is what the host
// serves, and it has to run without a resolver.

import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import {
  ENCODING,
  PAGE_FILE,
  RUNTIME,
  RUNTIME_DIRECTORY,
  RUNTIME_SPECIFIER,
  SOURCE_FILE,
  STRIPPED_FILE,
} from './project.ts';
import { rewriteExtensions, stripTypes } from './strip.ts';

/** Which app to build, and where to put it. */
export interface BuildOptions {
  /** The folder holding `index.html`, `app.ts` and the modules. */
  readonly root: string;
  /** The directory to write, emptied first. */
  readonly out: string;
}

/** What a build produced, in the terms the command reports it. */
export interface Built {
  readonly out: string;
  /** Files whose types came off. */
  readonly stripped: number;
  /** Files copied through untouched. */
  readonly copied: number;
  /** Whether the runtime was vendored beside the pages that name it. */
  readonly runtime: boolean;
}

/** Tooling and dependencies: present in the project, never part of the page. */
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'e2e']);

const SKIPPED_FILES = new Set(['package.json', 'tsconfig.json']);

const TEST_FILE = /\.(?:test|spec)\.ts$/;

const CONFIG_FILE = /\.config\.ts$/;

/** `<script type="module" src="/app.ts">` names a file that is now `.js`. */
const SCRIPT_SOURCE = /(<script[^>]*\ssrc=")([^"]+)\.ts(")/g;

/** A file inside the app to resolve the runtime from; it need not exist. */
const RESOLVE_FROM = 'sheratan.build';

const RUNTIME_HREF = './sheratan/index.js';

/** The build the runtime publishes for production, beside its `dev` twin. */
const PRODUCTION_BUILD = 'prod';

function isSkipped(name: string, directory: boolean): boolean {
  if (name.startsWith('.')) return true;

  if (directory) return SKIPPED_DIRECTORIES.has(name);

  return SKIPPED_FILES.has(name) || TEST_FILE.test(name) || CONFIG_FILE.test(name);
}

/** A path as the output writes it: relative to the app root, forward slashes. */
function pathIn(directory: string, name: string): string {
  return directory === '' ? name : `${directory}/${name}`;
}

/** Every file the build carries, as paths relative to the app root. */
async function filesOf(root: string, out: string): Promise<string[]> {
  const walk = async (directory: string): Promise<string[]> => {
    const here = join(root, directory);
    const entries = await readdir(here, { withFileTypes: true });
    const kept = entries.filter((entry) => !isSkipped(entry.name, entry.isDirectory()));

    const nested = await Promise.all(
      kept
        .filter((entry) => entry.isDirectory() && join(here, entry.name) !== out)
        .map(async (entry) => walk(pathIn(directory, entry.name))),
    );

    const files = kept
      .filter((entry) => !entry.isDirectory())
      .map((entry) => pathIn(directory, entry.name));

    return files.concat(...nested);
  };

  return (await walk('')).toSorted();
}

/**
 * Node's stripper can erase, never compile, which is the promise this command
 * makes. What it refuses is worth naming: the alternative is one line away.
 */
function refuse(path: string, error: unknown): never {
  const reason = error instanceof Error ? error.message : String(error);

  throw new Error(
    `${path} cannot be stripped: ${reason}\n\n` +
      'sheratan build removes types, it does not compile them, so syntax that has to be ' +
      'emitted has nothing to strip to. Write a const object with `as const` instead of an ' +
      'enum, a module instead of a namespace, and plain assignments instead of parameter ' +
      'properties — the same rule this framework holds itself to.',
  );
}

function page(html: string, runtime: boolean): string {
  const scripts = html.replaceAll(SCRIPT_SOURCE, `$1$2${STRIPPED_FILE}$3`);

  return runtime ? scripts.replace(RUNTIME_SPECIFIER, `$1${RUNTIME_HREF}$2`) : scripts;
}

/** Where a file lands in the output: a source arrives without its types. */
function targetOf(path: string): string {
  return path.endsWith(SOURCE_FILE)
    ? `${path.slice(0, -SOURCE_FILE.length)}${STRIPPED_FILE}`
    : path;
}

/** Writes one file into the output, and says whether it had types to lose. */
async function emit(root: string, out: string, path: string, runtime: boolean): Promise<boolean> {
  const from = join(root, path);
  const source = path.endsWith(SOURCE_FILE);
  const to = join(out, targetOf(path));

  await mkdir(dirname(to), { recursive: true });

  if (source) {
    const text = await readFile(from, ENCODING);

    try {
      await writeFile(to, rewriteExtensions(stripTypes(text)));
    } catch (error) {
      refuse(path, error);
    }

    return true;
  }

  if (path.endsWith(PAGE_FILE)) {
    await writeFile(to, page(await readFile(from, ENCODING), runtime));

    return false;
  }

  await cp(from, to);

  return false;
}

/** Where the runtime this project installed keeps its production build. */
function runtimeIn(root: string): string {
  const require = createRequire(join(root, RESOLVE_FROM));
  const entry = require.resolve(RUNTIME);

  return join(dirname(dirname(entry)), PRODUCTION_BUILD);
}

/** Copies the runtime in, so the page resolves `sheratan` with no resolver. */
async function vendor(root: string, out: string): Promise<void> {
  try {
    await cp(runtimeIn(root), join(out, RUNTIME_DIRECTORY), { recursive: true });
  } catch {
    throw new Error(
      `A page maps the bare specifier "sheratan", and the package is not installed in ${root}. ` +
        'Add it with `npm install sheratan`, or drop the import map entry if the page does not ' +
        'use the runtime.',
    );
  }
}

/** Whether any page names the runtime, which is what makes it worth copying. */
async function namesRuntime(root: string, pages: readonly string[]): Promise<boolean> {
  const sources = await Promise.all(
    pages.map(async (path) => readFile(join(root, path), ENCODING)),
  );

  return sources.some((html) => RUNTIME_SPECIFIER.test(html));
}

/**
 * Strips the app into `out` and returns what it wrote. The output is plain
 * ESM: no bundler ran, and nothing needs one to serve it.
 *
 * @example
 * const built = await buildProject({ root: 'app', out: 'app/dist' });
 */
export async function buildProject(options: BuildOptions): Promise<Built> {
  const { root, out } = options;

  if (out === root || root.startsWith(`${out}/`)) {
    throw new Error(`The output directory ${out} would contain the project it is built from.`);
  }

  const files = await filesOf(root, out);

  const runtime = await namesRuntime(
    root,
    files.filter((path) => path.endsWith(PAGE_FILE)),
  );

  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });

  const stripped = await Promise.all(files.map(async (path) => emit(root, out, path, runtime)));

  if (runtime) await vendor(root, out);

  const count = stripped.filter(Boolean).length;

  return { out, stripped: count, copied: files.length - count, runtime };
}
