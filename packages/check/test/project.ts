// A throwaway project on disk. The checker reads real files through a real
// TypeScript program, so its tests do too: a fake program would test the fake.

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { checkProject, type Finding } from '../src/index.ts';

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

/** Writes `files` as a project, checks it, and removes it again. */
export function check(files: Files): readonly Finding[] {
  // realpath: the system temp folder is a symlink on macOS, and TypeScript
  // reports real paths.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'sheratan-check-')));

  try {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ type: 'module' }));
    writeFileSync(join(root, 'tsconfig.json'), JSON.stringify(TSCONFIG));

    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }

    return checkProject({ tsconfig: join(root, 'tsconfig.json') });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
