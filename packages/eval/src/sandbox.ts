// A throwaway copy of the host app for one run. The agent edits the copy, so
// the committed hosts are never touched and two runs can never see each other.

import { spawn } from 'node:child_process';
import { cp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import type { SourceFile } from './source.ts';
import { writeTree } from './tree.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The package this harness lives in, and what a sandbox borrows from it. */
export const PACKAGE: string = resolve(HERE, '..');

/** The committed host app, which every case starts from. */
export const HOSTS: string = join(PACKAGE, 'hosts');

/** The behaviour suite, copied in only after the agent's turn. */
const SUITE = ['dom.ts', 'hosts.test.ts'];

const INDENT = 2;

const MANIFEST = `${JSON.stringify({ name: 'sheratan-eval-run', private: true, type: 'module' }, null, INDENT)}\n`;

/** How long one behaviour run may take before it counts as not converging. */
const TEST_TIMEOUT_MS = 60_000;

/** What running the hidden suite said. */
export interface TestRun {
  readonly ok: boolean;
  readonly output: string;
}

/** Lays down the tree the agent will work in. Only `hosts/` exists at first. */
export async function prepare(root: string, files: readonly SourceFile[]): Promise<void> {
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  await writeFile(join(root, 'package.json'), MANIFEST, 'utf8');
  await symlink(join(PACKAGE, 'node_modules'), join(root, 'node_modules'), 'dir');
  await writeTree(join(root, 'hosts'), files);
}

/** Adds the hidden suite. Called after the turn, never before. */
export async function addSuite(root: string): Promise<void> {
  await mkdir(join(root, 'test'), { recursive: true });

  await Promise.all(
    SUITE.map(async (name) => cp(join(PACKAGE, 'test', name), join(root, 'test', name))),
  );
}

/** Runs the hidden suite against whatever is in the sandbox now. */
export async function runTests(root: string): Promise<TestRun> {
  return new Promise<TestRun>((settle) => {
    const child = spawn('node', ['--test', 'test/hosts.test.ts'], {
      cwd: root,
      timeout: TEST_TIMEOUT_MS,
    });

    let output = '';

    const take = (chunk: Buffer): void => {
      output += chunk.toString();
    };

    child.stdout.on('data', take);
    child.stderr.on('data', take);

    child.on('close', (code) => {
      settle({ ok: code === 0, output });
    });
  });
}
