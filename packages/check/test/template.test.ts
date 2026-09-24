// SPEC §10b, second constraint: the `create` template passes `sheratan check`,
// and its canonical module exercises **every rule the checker has**.
//
// "Exercises" is asserted by breaking it. For each code there is one small,
// named edit to a copy of the template, and the checker must answer with that
// code. A template that stopped using `resource()`, or dropped its contract,
// or lost a test file, would leave its mutation with nothing to break — and
// this suite would go red rather than quietly certifying less than it claims.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { checkProject, RuleCode, Severity, type Finding } from '../src/index.ts';

const REPO = resolve(import.meta.dirname, '../../..');

const TEMPLATE = resolve(REPO, 'packages/cli/template');

/** The runtime's own source, so a copy needs no `node_modules` to be read. */
const CORE = resolve(REPO, 'packages/core/src/index.ts');

/**
 * The copy's compiler options. Test files stay on disk — SHR-T001 reads the
 * directory — but out of the program, because `happy-dom` is not installed
 * beside a copy and an unresolvable import is not what any of this is about.
 */
const TSCONFIG = {
  compilerOptions: {
    strict: true,
    target: 'esnext',
    lib: ['es2025', 'dom', 'dom.iterable'],
    module: 'nodenext',
    moduleResolution: 'nodenext',
    noEmit: true,
    allowImportingTsExtensions: true,
    skipLibCheck: true,
    types: [],
    paths: { sheratan: [CORE] },
  },
  include: ['app.ts', 'lib', 'modules', 'services'],
  exclude: ['**/*.test.ts'],
};

/** A copy of the template on disk, removed when the block that made it ends. */
interface Copy extends Disposable {
  readonly root: string;
}

function copyTemplate(): Copy {
  // realpath: the system temp folder is a symlink on macOS, and TypeScript
  // reports real paths.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'sheratan-template-')));

  cpSync(TEMPLATE, root, {
    recursive: true,
    filter: (source) => !source.endsWith('/node_modules'),
  });

  writeFileSync(join(root, 'tsconfig.json'), JSON.stringify(TSCONFIG));

  return {
    root,
    [Symbol.dispose]: (): void => {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/** Replaces one exact string in one file of the copy. */
function edit(root: string, file: string, from: string, to: string): void {
  const path = join(root, file);
  const before = readFileSync(path, 'utf8');

  assert.ok(
    before.includes(from),
    `the template no longer contains \`${from}\` in ${file}, so this mutation proves nothing`,
  );

  writeFileSync(path, before.replace(from, to));
}

/** One rule, and the smallest edit to the template that must provoke it. */
interface Mutation {
  readonly code: RuleCode;
  /** What the edit does, as the test name reads it. */
  readonly what: string;
  readonly mutate: (root: string) => void;
}

const MUTATIONS: readonly Mutation[] = [
  {
    code: RuleCode.Boundary,
    what: 'state reaches for a service adapter',
    mutate: (root) =>
      edit(
        root,
        'modules/devices/devices.state.ts',
        "import type { Device, Limits } from '../../services/devices.contract.ts';",
        "import type { Device, Limits } from '../../services/devices.contract.ts';\n" +
          "import { createFixtureDevices } from '../../services/devices.fixture.ts';\n" +
          'const unused = createFixtureDevices;',
      ),
  },
  {
    code: RuleCode.Io,
    what: 'the view fetches',
    mutate: (root) =>
      edit(
        root,
        'modules/devices/devices.view.ts',
        'const caption = computed(() => countOf(state.count()));',
        'const caption = computed(() => countOf(state.count()));\n  void fetch("/devices");',
      ),
  },
  {
    code: RuleCode.Structure,
    what: 'a `shared/` directory appears',
    mutate: (root) => {
      mkdirSync(join(root, 'modules/shared'));
      writeFileSync(join(root, 'modules/shared/helpers.ts'), 'export const shared = 1;\n');
    },
  },
  {
    code: RuleCode.EffectsOnly,
    what: 'the view registers teardown',
    mutate: (root) => {
      edit(
        root,
        'modules/devices/devices.view.ts',
        'import {\n  computed,',
        'import {\n  onDispose,\n  computed,',
      );

      edit(
        root,
        'modules/devices/devices.view.ts',
        'const caption = computed(() => countOf(state.count()));',
        'const caption = computed(() => countOf(state.count()));\n' +
          '  onDispose(() => undefined);',
      );
    },
  },
  {
    code: RuleCode.Shape,
    what: 'a `full` module loses its effects file',
    mutate: (root) => rmSync(join(root, 'modules/devices/devices.effects.ts')),
  },
  {
    code: RuleCode.Cancellable,
    what: 'a contract method drops its AbortSignal',
    mutate: (root) =>
      edit(
        root,
        'services/devices.contract.ts',
        'limits(signal: AbortSignal): Promise<Limits>;',
        'limits(): Promise<Limits>;',
      ),
  },
  {
    code: RuleCode.Cycle,
    what: 'two modules import each other',
    mutate: (root) =>
      edit(
        root,
        'modules/reading/index.ts',
        "import { readingView, type ReadingProps } from './reading.view.ts';",
        "import { readingView, type ReadingProps } from './reading.view.ts';\n" +
          "import { kind as parent } from '../devices/index.ts';\n" +
          'export const cycle = parent;',
      ),
  },
  {
    code: RuleCode.StateSurface,
    what: 'state hands out a writable signal',
    mutate: (root) =>
      edit(
        root,
        'modules/devices/devices.state.ts',
        'readonly room: Accessor<string>;',
        'readonly room: Signal<string>;',
      ),
  },
  {
    code: RuleCode.Tested,
    what: 'a module loses the test beside its state',
    mutate: (root) => rmSync(join(root, 'modules/devices/devices.state.test.ts')),
  },
];

const DEVICES = 'modules/devices/devices';

/**
 * SPEC §10b's required coverage, item for item. The mutations below prove that
 * every *rule* fires; this proves the module still contains the things the
 * spec asks a first example to show. Dropping `stream()` breaks no rule, so
 * without this the template could quietly teach less than it promises.
 */
const REQUIRED: readonly {
  readonly what: string;
  readonly file: string;
  readonly needle: string;
}[] = [
  { what: 'a resource()', file: `${DEVICES}.effects.ts`, needle: 'resource<' },
  { what: 'a mutation()', file: `${DEVICES}.effects.ts`, needle: 'mutation<' },
  { what: 'a stream()', file: `${DEVICES}.effects.ts`, needle: 'stream<' },
  { what: 'an onDispose()', file: `${DEVICES}.effects.ts`, needle: 'onDispose(' },
  { what: 'a computed projection', file: `${DEVICES}.state.ts`, needle: 'computed(' },
  { what: 'an atomic transition', file: `${DEVICES}.state.ts`, needle: 'batch(' },
  { what: 'an each with a window', file: `${DEVICES}.view.ts`, needle: 'state.rowWindow' },
  { what: 'a mount() of another module', file: `${DEVICES}.view.ts`, needle: 'mount(' },
  { what: 'a scoped sheet', file: `${DEVICES}.css`, needle: '@scope (.module-devices)' },
  { what: 'a token from global.css', file: `${DEVICES}.css`, needle: 'var(--hair)' },
  {
    what: 'a contract whose promises cancel',
    file: 'services/devices.contract.ts',
    needle: 'signal: AbortSignal',
  },
  { what: 'a state test', file: `${DEVICES}.state.test.ts`, needle: 'assert.' },
  { what: 'an effects test', file: `${DEVICES}.effects.test.ts`, needle: 'assert.' },
];

for (const { what, file, needle } of REQUIRED) {
  test(`the canonical module still shows ${what}`, () => {
    const source = readFileSync(join(TEMPLATE, file), 'utf8');

    assert.ok(
      source.includes(needle),
      `${file} no longer contains \`${needle}\`, so the template stopped showing ${what} (SPEC §10b)`,
    );
  });
}

function checkCopy(root: string): readonly Finding[] {
  return checkProject({ tsconfig: join(root, 'tsconfig.json') });
}

test('the template passes its own checker', () => {
  using copy = copyTemplate();

  assert.deepEqual(checkCopy(copy.root), []);
});

test('every rule the checker has is exercised by the template', () => {
  const codes = MUTATIONS.map((mutation) => mutation.code).toSorted();

  // Not "the nine we thought of": every code the checker declares. A rule
  // added without a mutation here fails this line (SPEC §10b).
  assert.deepEqual(codes, Object.values(RuleCode).toSorted());
});

for (const { code, what, mutate } of MUTATIONS) {
  test(`${code}: ${what}`, () => {
    using copy = copyTemplate();

    mutate(copy.root);

    const found = checkCopy(copy.root).filter((finding) => finding.code === code);

    assert.ok(found.length > 0, `${code} did not fire; the template may no longer exercise it`);
  });
}

test('the template is clean, and only the mutations make it otherwise', () => {
  using copy = copyTemplate();

  assert.deepEqual(
    checkCopy(copy.root).filter((finding) => finding.severity === Severity.Error),
    [],
  );
});
