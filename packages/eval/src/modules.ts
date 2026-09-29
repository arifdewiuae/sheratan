// An installed package tree for each arm, outside the repository.
//
// A sandbox used to borrow a `node_modules` from this repository through a
// symlink, and a symlink says where it points: the first matrix's agents read
// the target and walked into the repository. With the agent now denied the
// repository outright (`confine.ts`), a borrowed tree would not even load. So
// each arm installs its own, once per run of the harness, into a temporary
// directory: every cell of a matrix links the same tree, so no two cells can
// differ in what they were given, and nothing in it leads back here.
//
// The install uses the repository's pnpm and its supply-chain policy, and
// prefers the local store, so it is quick and it cannot pick up a package the
// repository itself would refuse.

import { spawn } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import type { Arm } from './arm.ts';
import { REPOSITORY } from './confine.ts';

/** What an install may take before it is treated as broken. */
const INSTALL_TIMEOUT_MS = 300_000;

const INDENT = 2;

/** The repository's own manifest, where its pnpm version is pinned. */
const ROOT_MANIFEST = join(REPOSITORY, 'package.json');

/** The repository's supply-chain policy, which an install outside it keeps. */
const ROOT_WORKSPACE = join(REPOSITORY, 'pnpm-workspace.yaml');

/** The `packages:` block of a workspace file, up to the first blank line. */
const PACKAGES_BLOCK = /^packages:\n(?:[ \t].*\n)*/mu;

/** One install per arm per process, shared by every cell that asks. */
const trees = new Map<string, Promise<string>>();

/**
 * Runs pnpm in `dir` and fails with everything it said if it fails.
 *
 * @example
 * await pnpm(dir, ['install', '--frozen-lockfile', '--prefer-offline']);
 */
export async function pnpm(dir: string, args: readonly string[]): Promise<void> {
  const output = await new Promise<{ ok: boolean; said: string }>((settle) => {
    const child = spawn('pnpm', [...args], {
      cwd: dir,
      timeout: INSTALL_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let said = '';

    child.stdout.on('data', (chunk: Buffer) => {
      said += chunk.toString();
    });

    child.stderr.on('data', (chunk: Buffer) => {
      said += chunk.toString();
    });

    child.on('error', (error) => settle({ ok: false, said: `${said}${error.message}` }));
    child.on('close', (code) => settle({ ok: code === 0, said }));
  });

  if (!output.ok) throw new Error(`pnpm ${args.join(' ')} failed in ${dir}:\n${output.said}`);
}

/**
 * `manifest` with the repository's pnpm pinned in it. Outside the repository
 * nothing else pins it, and a different pnpm reads the same policy
 * differently — the first attempt at this install met pnpm 11 refusing a
 * lockfile pnpm 12 accepts.
 *
 * @example
 * await writeFile(path, await pinnedManifest({ name: 'x', private: true }));
 */
export async function pinnedManifest(manifest: Readonly<Record<string, unknown>>): Promise<string> {
  const root = JSON.parse(await readFile(ROOT_MANIFEST, 'utf8')) as { packageManager?: string };

  return `${JSON.stringify({ ...manifest, packageManager: root.packageManager }, null, INDENT)}\n`;
}

/**
 * The repository's workspace file as a single-project root: its policy
 * intact, its `packages` list emptied so nothing is looked for.
 *
 * @example
 * await writeFile(join(dir, 'pnpm-workspace.yaml'), await rootPolicy());
 */
export async function rootPolicy(): Promise<string> {
  const text = await readFile(ROOT_WORKSPACE, 'utf8');

  if (!PACKAGES_BLOCK.test(text)) {
    throw new Error(
      `${ROOT_WORKSPACE} has no packages block to replace; the policy cannot be carried over.`,
    );
  }

  return text.replace(PACKAGES_BLOCK, 'packages: []\n');
}

async function installed(arm: Arm): Promise<string> {
  const dir = await mkdtemp(resolve(tmpdir(), `sheratan-modules-${arm.id}-`));

  await arm.install(dir);

  return join(dir, 'node_modules');
}

/**
 * The installed tree for `arm`, built on the first request of this process
 * and shared after it. The directory is left for the operating system's
 * temporary-file sweep: a matrix that is resumed builds its own.
 *
 * @example
 * const modules = await modulesFor(arm); // link it as the sandbox's node_modules
 */
export async function modulesFor(arm: Arm): Promise<string> {
  const known = trees.get(arm.id);

  if (known !== undefined) return known;

  const building = installed(arm);

  trees.set(arm.id, building);

  return building;
}
