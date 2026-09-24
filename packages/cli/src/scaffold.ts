// `sheratan create` (SPEC §10, §10b). A scaffold is a copy with two edits: the
// template on disk is a real, checked application — it typechecks, lints,
// tests and passes `sheratan check` in this repository — so what a user
// receives cannot drift from what CI proves. The only things rewritten are the
// app's name and the runtime version it depends on.

import { cp, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ENCODING, RUNTIME } from './project.ts';
import { RUNTIME_VERSION } from './version.ts';

/**
 * The template, beside whichever form of the command is running: `src/` next
 * to `template/` from source, and the bundle next to the copy the tarball
 * carries. One expression answers for both, so there is no build-only path.
 */
const TEMPLATE = new URL('../template/', import.meta.url);

/** The manifest both the template and the scaffolded app are described by. */
const MANIFEST = 'package.json';

/** Never copied: a workspace link tree and whatever a previous build left. */
const NOT_TEMPLATE: ReadonlySet<string> = new Set(['node_modules', 'dist']);

/**
 * Config files the app wants as dotfiles, stored undotted in the template.
 * oxlint and oxfmt discover a nested config and merge it into the one above
 * it, so a live `.oxlintrc.json` inside this repository would change how the
 * repository lints the template. The app's config is written on the way out
 * instead, and `test/scaffold.test.ts` runs oxlint against a scaffolded app so
 * the file is still proved rather than merely copied.
 */
const DOTFILES: Readonly<Record<string, string>> = {
  'oxlintrc.json': '.oxlintrc.json',
  'oxfmtrc.json': '.oxfmtrc.json',
};

/** How the manifest is written back, matching what a package manager writes. */
const INDENT = 2;

/**
 * The scripts only a scaffolded app has. The template carries the rest, which
 * are the ones this repository runs for it — it is a workspace member, and a
 * `build` script there would make `pnpm -r build` build the template.
 */
const APP_SCRIPTS: Readonly<Record<string, string>> = {
  dev: 'sheratan dev .',
  build: 'sheratan build .',
  check: 'sheratan check .',
};

/** What a scaffold was asked for. */
export interface ScaffoldOptions {
  /** Where the app is written. It must not already hold files. */
  readonly root: string;
  /** The app's name, which is also its directory's. */
  readonly name: string;
}

/** What a scaffold produced. */
export interface Scaffolded {
  /** Where the app was written. */
  readonly root: string;
  /** The app's name, as the manifest now spells it. */
  readonly name: string;
  /** The runtime version the app depends on. */
  readonly version: string;
}

/** An npm package name: what a directory has to be called to also be a package. */
const PACKAGE_NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/u;

/**
 * Whether the target is free. A missing directory is free; an existing one is
 * free only while it is empty, because writing into a project someone already
 * has is the one mistake a scaffold cannot undo.
 */
async function isEmpty(root: string): Promise<boolean> {
  try {
    return (await readdir(root)).length === 0;
  } catch {
    return true;
  }
}

/** The template's manifest, with this app's name and runtime version in it. */
async function manifestFor(root: string, name: string): Promise<void> {
  const path = resolve(root, MANIFEST);
  const template = JSON.parse(await readFile(path, ENCODING)) as Record<string, unknown>;

  const manifest = {
    ...template,
    name,
    description: `An app built with ${RUNTIME}.`,
    scripts: { ...APP_SCRIPTS, ...(template['scripts'] as Record<string, string>) },
    dependencies: { [RUNTIME]: `^${RUNTIME_VERSION}` },
  };

  await writeFile(path, `${JSON.stringify(manifest, undefined, INDENT)}\n`, ENCODING);
}

/**
 * Writes a new app into `root` and says what it wrote. The result is a
 * complete project: it runs on `sheratan dev`, it passes `sheratan check`, and
 * its canonical module exercises every rule the checker has (SPEC §10b).
 *
 * @example
 * const app = await scaffoldApp({ root: resolve('./shop'), name: 'shop' });
 */
export async function scaffoldApp(options: ScaffoldOptions): Promise<Scaffolded> {
  const { root, name } = options;

  if (!PACKAGE_NAME.test(name)) {
    throw new Error(
      `\`${name}\` cannot be a package name, so it cannot be an app name.\n` +
        'Use lower-case letters, digits, dashes and dots, as npm does.',
    );
  }

  if (!(await isEmpty(root))) {
    throw new Error(
      `${root} already has files in it, and create never writes into an existing project.\n` +
        'Name a directory that does not exist, or empty this one first.',
    );
  }

  await cp(fileURLToPath(TEMPLATE), root, {
    recursive: true,
    filter: (source) => !NOT_TEMPLATE.has(basename(source)),
  });

  await Promise.all(
    Object.entries(DOTFILES).map(([from, to]) => rename(resolve(root, from), resolve(root, to))),
  );

  await manifestFor(root, name);

  return { root, name, version: RUNTIME_VERSION };
}
