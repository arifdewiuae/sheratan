// A throwaway project on disk. The checker reads real files through a real
// TypeScript program, so its tests do too: a fake program would test the fake.

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { checkProject, type Finding, type RuleCode } from '../src/index.ts';

/** The runtime's own source, so a fixture's `Signal` is the real one. */
const CORE = resolve(import.meta.dirname, '../../core/src/index.ts');

const TSCONFIG = {
  compilerOptions: {
    strict: true,
    target: 'es2022',
    lib: ['es2023', 'esnext.disposable', 'dom'],
    module: 'nodenext',
    moduleResolution: 'nodenext',
    noEmit: true,
    allowImportingTsExtensions: true,
    skipLibCheck: true,
    types: [],
    paths: { sheratan: [CORE] },
  },
  include: ['**/*.ts'],
};

/** Source text by path relative to the app root. */
export type Files = Readonly<Record<string, string>>;

/** A project on disk, removed when the block that made it ends. */
export interface Project extends Disposable {
  /** The app root, which is also where its `tsconfig.json` sits. */
  readonly root: string;
}

/** Writes `files` as a project a real TypeScript program can open. */
export function project(files: Files): Project {
  // realpath: the system temp folder is a symlink on macOS, and TypeScript
  // reports real paths.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'sheratan-check-')));

  writeFileSync(join(root, 'package.json'), JSON.stringify({ type: 'module' }));
  writeFileSync(join(root, 'tsconfig.json'), JSON.stringify(TSCONFIG));

  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }

  return {
    root,
    [Symbol.dispose]: (): void => {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/** Writes `files` as a project, checks it, and removes it again. */
export function check(files: Files): readonly Finding[] {
  using made = project(files);

  return checkProject({ tsconfig: join(made.root, 'tsconfig.json') });
}

/**
 * A rule's own findings, for a suite whose fixtures are deliberately partial —
 * a view with no module around it, a module with no index. Those are legal
 * inputs to the rule under test and violations of another, and a suite that
 * asserted both would be a suite about two rules.
 */
export function only(code: RuleCode): (files: Files) => readonly Finding[] {
  return (files) => check(files).filter((finding) => finding.code === code);
}
