// Reading, patching and writing the host tree. Every failure here is loud
// (A2): a patch that does not apply, or applies twice, means the case no
// longer describes the code, and a silently skipped injection would score as
// a repair the agent never had to make.

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';

import type { Case } from './cases.ts';
import type { SourceFile } from './source.ts';

const SOURCE = '.ts';

async function walk(root: string, at: string, found: string[]): Promise<void> {
  const entries = await readdir(join(root, at), { withFileTypes: true });
  const directories: string[] = [];

  for (const entry of entries) {
    const path = at === '' ? entry.name : `${at}/${entry.name}`;

    if (entry.isDirectory()) directories.push(path);
    else if (entry.name.endsWith(SOURCE)) found.push(path);
  }

  await Promise.all(directories.map(async (path) => walk(root, path, found)));
}

/** Every TypeScript file under `root`, by path relative to it, sorted. */
export async function readTree(root: string): Promise<SourceFile[]> {
  const paths: string[] = [];

  await walk(root, '', paths);
  paths.sort();

  return Promise.all(
    paths.map(async (path) => ({ path, text: await readFile(join(root, path), 'utf8') })),
  );
}

/** Writes a tree out, creating the directories it needs. */
export async function writeTree(root: string, files: readonly SourceFile[]): Promise<void> {
  await Promise.all(
    files.map(async (file) => {
      const target = join(root, ...file.path.split('/'));

      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.text, 'utf8');
    }),
  );
}

/** The path a file on disk has inside the tree. */
export function pathIn(root: string, file: string): string {
  return relative(root, file).split(sep).join('/');
}

function occurrences(text: string, find: string): number {
  return text.split(find).length - 1;
}

/**
 * Applies a case's patches. Each `find` must appear exactly once in its file,
 * so a host edited out from under a case fails the run instead of quietly
 * producing a tree with no violation in it.
 */
export function inject(files: readonly SourceFile[], one: Case): SourceFile[] {
  const byPath = new Map(files.map((file) => [file.path, file.text]));

  for (const patch of one.patches) {
    const text = byPath.get(patch.file);

    if (text === undefined) throw new Error(`${one.id}: no file ${patch.file}`);

    const count = occurrences(text, patch.find);

    if (count !== 1) {
      throw new Error(
        `${one.id}: the patch for ${patch.file} matched ${String(count)} times, expected 1`,
      );
    }

    byPath.set(patch.file, text.replace(patch.find, patch.replace));
  }

  return [...byPath].map(([path, text]) => ({ path, text }));
}
