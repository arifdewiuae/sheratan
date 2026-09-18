// SHR-L001 (SPEC §4). The table below is the import matrix, cell by cell:
// every row imports from exactly one place, and the test asserts that the
// checker flags exactly the rows the matrix forbids — no more, no fewer.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { RuleCode } from '../src/index.ts';
import { check, type Files } from './project.ts';

/** Files every case can import from: one of each kind of target. */
const TARGETS: Files = {
  'lib/format.ts': 'export const money = (n: number): string => n.toFixed(2);\n',
  'ui/badge/index.ts': 'export const badge = (text: string): string => text;\n',
  'services/api.contract.ts':
    'export interface Order {\n  readonly id: number;\n}\n\nexport const ORDERS_PATH = "/orders";\n',
  'services/api.http.ts': 'export const createHttpApi = (): string => "http";\n',
  'modules/orders/orders.state.ts': 'export const count = 0;\n',
  'modules/orders/orders.effects.ts': 'export const load = 0;\n',
  'modules/orders/orders.view.ts': 'export const view = 0;\n',
  'modules/orders/index.ts': 'export const kind = "full";\n',
  'app.ts': 'export const app = 0;\n',
};

type Target =
  | 'lib'
  | 'ui'
  | 'contract'
  | 'adapter'
  | 'otherState'
  | 'otherIndex'
  | 'ownState'
  | 'ownEffects'
  | 'ownView'
  | 'ownIndex'
  | 'ownHelper';

/** Where each target is, from the root. `own*` targets live beside the importer. */
const OTHER: Record<string, string> = {
  lib: 'lib/format.ts',
  ui: 'ui/badge/index.ts',
  contract: 'services/api.contract.ts',
  adapter: 'services/api.http.ts',
  otherState: 'modules/orders/orders.state.ts',
  otherIndex: 'modules/orders/index.ts',
};

const OWN: Record<string, string> = {
  ownState: 'STATE',
  ownEffects: 'EFFECTS',
  ownView: 'VIEW',
  ownIndex: 'index.ts',
  ownHelper: 'helper.ts',
};

/** One cell: a file, what it imports, how, and whether the matrix allows it. */
interface Cell {
  readonly from: string;
  readonly to: Target;
  readonly type?: boolean;
  readonly reexport?: boolean;
  readonly allowed: boolean;
}

// `from` names a layer; each row gets its own file (and its own module), so a
// finding can be traced back to exactly one row.
const MATRIX: readonly Cell[] = [
  { from: 'lib', to: 'lib', allowed: false },
  { from: 'lib', to: 'ui', allowed: false },
  { from: 'ui', to: 'lib', allowed: true },
  { from: 'ui', to: 'ui', allowed: true },
  { from: 'ui', to: 'contract', allowed: false },
  { from: 'ui', to: 'contract', type: true, allowed: false },
  { from: 'ui', to: 'otherIndex', allowed: false },
  { from: 'service', to: 'lib', allowed: true },
  { from: 'service', to: 'contract', allowed: true },
  { from: 'service', to: 'otherIndex', allowed: false },
  { from: 'contract', to: 'ui', allowed: false },
  { from: 'state', to: 'lib', allowed: true },
  { from: 'state', to: 'ownHelper', allowed: true },
  { from: 'state', to: 'ownEffects', allowed: false },
  { from: 'state', to: 'ownView', allowed: false },
  { from: 'state', to: 'otherIndex', allowed: false },
  { from: 'state', to: 'otherIndex', type: true, allowed: true },
  { from: 'state', to: 'contract', type: true, allowed: true },
  { from: 'state', to: 'contract', allowed: false },
  { from: 'state', to: 'adapter', allowed: false },
  { from: 'state', to: 'ui', allowed: false },
  { from: 'effects', to: 'lib', allowed: true },
  { from: 'effects', to: 'ownState', allowed: true },
  { from: 'effects', to: 'contract', allowed: true },
  { from: 'effects', to: 'otherIndex', allowed: true },
  { from: 'effects', to: 'adapter', allowed: false },
  { from: 'effects', to: 'otherState', allowed: false },
  { from: 'effects', to: 'otherState', type: true, allowed: false },
  { from: 'effects', to: 'ownView', allowed: false },
  { from: 'effects', to: 'ownIndex', allowed: false },
  { from: 'effects', to: 'ui', allowed: false },
  { from: 'view', to: 'lib', allowed: true },
  { from: 'view', to: 'ui', allowed: true },
  { from: 'view', to: 'ownState', allowed: true },
  { from: 'view', to: 'ownEffects', allowed: false },
  { from: 'view', to: 'ownEffects', type: true, allowed: false },
  { from: 'view', to: 'otherIndex', allowed: false },
  { from: 'view', to: 'otherIndex', type: true, allowed: true },
  { from: 'view', to: 'contract', type: true, allowed: true },
  { from: 'view', to: 'contract', allowed: false },
  { from: 'view', to: 'adapter', allowed: false },
  { from: 'index', to: 'ownView', allowed: true },
  { from: 'index', to: 'otherIndex', type: true, allowed: true },
  { from: 'index', to: 'otherIndex', allowed: false },
  { from: 'index', to: 'otherState', reexport: true, allowed: false },
  { from: 'index', to: 'lib', allowed: false },
  { from: 'helper', to: 'ownState', allowed: true },
  { from: 'helper', to: 'ui', allowed: true },
  { from: 'helper', to: 'otherState', allowed: false },
  { from: 'app', to: 'adapter', allowed: true },
  { from: 'app', to: 'otherState', allowed: true },
];

/** The path of row `index`'s importing file. Module rows get a module of their own. */
function importerOf(cell: Cell, index: number): string {
  const name = `m${String(index)}`;

  const files: Record<string, string> = {
    lib: `lib/case${String(index)}.ts`,
    ui: `ui/case${String(index)}/index.ts`,
    service: `services/case${String(index)}.ts`,
    contract: `services/case${String(index)}.contract.ts`,
    state: `modules/${name}/${name}.state.ts`,
    effects: `modules/${name}/${name}.effects.ts`,
    view: `modules/${name}/${name}.view.ts`,
    index: `modules/${name}/index.ts`,
    helper: `modules/${name}/helper.ts`,
    app: 'app.ts',
  };

  return files[cell.from] ?? '';
}

function depthOf(path: string): number {
  return path.split('/').length - 1;
}

function specifierFor(importer: string, cell: Cell): string {
  const own = OWN[cell.to];

  if (own !== undefined) {
    const name = importer.split('/')[1] ?? '';

    const file = own
      .replace('STATE', `${name}.state.ts`)
      .replace('EFFECTS', `${name}.effects.ts`)
      .replace('VIEW', `${name}.view.ts`);

    return `./${file}`;
  }

  return `${'../'.repeat(depthOf(importer))}${OTHER[cell.to] ?? ''}`;
}

function sourceFor(importer: string, cell: Cell): string {
  const specifier = specifierFor(importer, cell);

  if (cell.reexport === true) return `export * from '${specifier}';\n`;

  return `import ${cell.type === true ? 'type ' : ''}* as target from '${specifier}';\n\nexport type Probe = typeof target;\n`;
}

/** How the row's import is written, for a failure message. */
function spelling(cell: Cell): string {
  if (cell.type === true) return 'import type';

  if (cell.reexport === true) return 'export *';

  return 'import';
}

/** The whole matrix as one project, so TypeScript opens once. */
function matrixProject(): { readonly files: Files; readonly importers: readonly string[] } {
  const files: Record<string, string> = { ...TARGETS };
  const importers = MATRIX.map((cell, index) => importerOf(cell, index));

  for (const [index, cell] of MATRIX.entries()) {
    const importer = importers[index] ?? '';
    const [top, name] = importer.split('/');

    // Every module row gets the full file set, so its own-module targets exist.
    if (top === 'modules' && name !== undefined && name !== 'orders') {
      for (const suffix of ['state', 'effects', 'view']) {
        files[`modules/${name}/${name}.${suffix}.ts`] ??= 'export const stub = 0;\n';
      }

      files[`modules/${name}/index.ts`] ??= 'export const kind = "full";\n';
      files[`modules/${name}/helper.ts`] ??= 'export const helper = 0;\n';
    }

    files[importer] = sourceFor(importer, cell);
  }

  return { files, importers };
}

test('every cell of the import matrix: forbidden imports are flagged, allowed ones are not', () => {
  const { files, importers } = matrixProject();

  const flagged = new Set(
    check(files)
      .filter((finding) => finding.code === RuleCode.Boundary)
      .map((finding) => finding.file),
  );

  const wrong = MATRIX.flatMap((cell, index) => {
    const importer = importers[index] ?? '';
    const reported = flagged.has(importer);

    if (reported === !cell.allowed) return [];

    const how = spelling(cell);

    return [
      `${cell.from} → ${cell.to} (${how}): expected ${cell.allowed ? 'allowed' : 'flagged'}, got ${reported ? 'flagged' : 'allowed'}`,
    ];
  });

  assert.deepEqual(wrong, []);
});

test('a finding names the allowed set, says what to write instead, and links its code', () => {
  const [finding] = check({
    'modules/todo/todo.state.ts': 'export const items = 0;\n',
    'modules/todo/todo.effects.ts': 'export const load = (): number => 1;\n',
    'modules/todo/todo.view.ts':
      "// A view.\n\nimport { load } from './todo.effects.ts';\n\nexport const view = load;\n",
    'modules/todo/index.ts': 'export const kind = "full";\n',
  });

  assert.deepEqual(finding, {
    code: 'SHR-L001',
    severity: 'error',
    file: 'modules/todo/todo.view.ts',
    range: { line: 3, column: 1 },
    message: 'view cannot import modules/todo/todo.effects.ts; allowed: lib, ui, own state.',
    fix: 'Declare the intents the view needs as an interface in this file and receive them as a parameter; the effects object satisfies it structurally.',
    docs: 'https://sheratan.dev/errors/SHR-L001',
  });
});

test('a deep import names the public surface to use instead', () => {
  const [finding] = check({
    ...TARGETS,
    'modules/billing/billing.effects.ts':
      "import { count } from '../orders/orders.state.ts';\n\nexport const total = count;\n",
  });

  assert.ok(finding);

  assert.equal(
    finding.message,
    "effects cannot import modules/orders/orders.state.ts; allowed: lib, services contracts, own state, other modules' index.ts.",
  );

  assert.match(finding.fix, /modules\/orders\/index\.ts/);
});

test("packages, unresolved imports and files outside the layout are not the matrix's business", () => {
  const findings = check({
    ...TARGETS,
    'modules/todo/todo.view.ts':
      "import { signal } from 'sheratan';\n\nexport const view = signal;\n",
    'modules/todo/todo.test.ts':
      "import { load } from '../orders/orders.effects.ts';\n\nexport const probe = load;\n",
    'scripts/seed.ts':
      "import { load } from '../modules/orders/orders.effects.ts';\n\nexport const probe = load;\n",
    'lib/broken.ts':
      "// @ts-expect-error: resolves to nothing\nimport { gone } from './missing.ts';\n\nexport const probe = gone;\n",
  });

  assert.deepEqual(findings, []);
});

test('the fix for each kind of mistake says what to do about that mistake', () => {
  const findings = check({
    ...TARGETS,
    'lib/dates.ts': "import { money } from './format.ts';\n\nexport const probe = money;\n",
    'ui/card/index.ts':
      "import { kind } from '../../modules/orders/index.ts';\n\nexport const probe = kind;\n",
    'services/api.socket.ts':
      "import { kind } from '../modules/orders/index.ts';\n\nexport const probe = kind;\n",
    'services/feed.contract.ts':
      "import { badge } from '../ui/badge/index.ts';\n\nexport const probe = badge;\n",
    'modules/a/a.state.ts':
      "import { kind } from '../orders/index.ts';\n\nexport const probe = kind;\n",
    'modules/b/b.view.ts':
      "import { ORDERS_PATH } from '../../services/api.contract.ts';\n\nexport const probe = ORDERS_PATH;\n",
    'modules/c/c.effects.ts':
      "import { createHttpApi } from '../../services/api.http.ts';\n\nexport const probe = createHttpApi;\n",
    'modules/d/d.state.ts':
      "import { badge } from '../../ui/badge/index.ts';\n\nexport const probe = badge;\n",
    'modules/e/e.state.ts':
      "import { load } from './e.effects.ts';\n\nexport const probe = load;\n",
    'modules/e/e.effects.ts': 'export const load = 0;\n',
    'modules/f/f.effects.ts': "import { view } from './f.view.ts';\n\nexport const probe = view;\n",
    'modules/f/f.view.ts': 'export const view = 0;\n',
    'modules/g/g.effects.ts': "import { kind } from './index.ts';\n\nexport const probe = kind;\n",
    'modules/g/index.ts': 'export const kind = "full";\n',
    'modules/h/helper.ts':
      "import { load } from '../orders/orders.effects.ts';\n\nexport const probe = load;\n",
    'modules/i/i.view.ts':
      "import { kind } from '../orders/index.ts';\n\nexport const probe = kind;\n",
    'modules/j/helper.ts': "import { load } from './j.effects.ts';\n\nexport const probe = load;\n",
    'modules/j/j.effects.ts': 'export const load = 0;\n',
    'modules/k/index.ts':
      "import { money } from '../../lib/format.ts';\n\nexport const probe = money;\n",
  });

  const fixes = Object.fromEntries(findings.map((finding) => [finding.file, finding.fix]));

  assert.deepEqual(fixes, {
    'lib/dates.ts':
      'lib/ may not know the app. Move this code next to its caller, or pass the value in as a parameter.',
    'ui/card/index.ts':
      'ui/ components are stateless and know no modules. Take the value as a parameter from the module that renders it.',
    'services/api.socket.ts':
      "A service is an adapter and knows no modules. Return the data, and let the module's effects apply it.",
    'services/feed.contract.ts':
      'A contract describes I/O and knows no modules. Move the shared type into the contract itself.',
    'modules/a/a.state.ts':
      'State cannot depend on another module. React to it in effects, which may import modules/orders/index.ts, and call a transition with the result.',
    'modules/b/b.view.ts':
      'Use `import type` — a contract is shared as types, and the adapter it describes is wired in app.ts.',
    'modules/c/c.effects.ts':
      'Depend on the contract, not the adapter: `import type` from services/*.contract.ts, and let app.ts pass the adapter in.',
    'modules/d/d.state.ts':
      'State and effects have no markup. Render the ui/ component from the view.',
    'modules/e/e.state.ts':
      'State holds signals and pure transitions. Move this into e.effects.ts, which calls a transition with the result.',
    'modules/f/f.effects.ts':
      'Effects never render. Hand the result to a transition in f.state.ts and let the view read it.',
    'modules/g/g.effects.ts':
      'index.ts assembles the module and imports its files; importing it back from inside makes a cycle. Import the file you need directly.',
    'modules/h/helper.ts':
      'A helper inside a module cannot reach another module. Move this into h.effects.ts, which may import modules/orders/index.ts.',
    'modules/i/i.view.ts':
      'A view receives other modules as parameters. Have index.ts pass the instance in rather than importing modules/orders/index.ts.',
    'modules/j/helper.ts':
      'A helper inside a module may use lib, ui and its own state and views. Move the call into j.effects.ts.',
    'modules/k/index.ts':
      "index.ts is the module's public surface and re-exports only its own files. Import this in the module file that needs it.",
  });
});

test('how an import is written does not change what it imports', () => {
  const findings = check({
    ...TARGETS,
    'services/api.contract.ts':
      'export interface Order {\n  readonly id: number;\n}\n\nexport default interface Draft {\n  readonly note: string;\n}\n',
    // Side-effect and default imports run code, so they are value imports.
    'modules/a/a.view.ts': "import '../../services/api.http.ts';\n\nexport const probe = 0;\n",
    'modules/b/b.view.ts':
      "import Draft from '../../services/api.contract.ts';\n\nexport type Probe = Draft;\n",
    // Every named binding marked `type` is as erased as `import type`.
    'modules/c/c.view.ts':
      "import { type Order } from '../../services/api.contract.ts';\n\nexport type Probe = Order;\n",
    // One value binding among types keeps the import at run time.
    'modules/d/d.view.ts':
      "import { type Order, ORDERS_PATH } from '../../services/api.contract.ts';\n\nexport type Probe = [Order, typeof ORDERS_PATH];\n",
    'modules/e/e.view.ts': "export type { Order } from '../../services/api.contract.ts';\n",
    'modules/f/f.view.ts': "export { type Order } from '../../services/api.contract.ts';\n",
    'modules/g/g.view.ts': "export { ORDERS_PATH } from '../../services/api.contract.ts';\n",
    'modules/h/h.view.ts': "export * as api from '../../services/api.contract.ts';\n",
  });

  assert.deepEqual(
    findings.map((finding) => finding.file),
    [
      'modules/a/a.view.ts',
      'modules/b/b.view.ts',
      'modules/d/d.view.ts',
      'modules/g/g.view.ts',
      'modules/h/h.view.ts',
    ],
  );
});

test('findings come out in file order, then line, then column', () => {
  const findings = check({
    ...TARGETS,
    'modules/z/z.view.ts':
      "import { load } from '../orders/orders.effects.ts'; import { count } from '../orders/orders.state.ts';\n\nimport { view } from '../orders/orders.view.ts';\n\nexport const probe = [load, count, view];\n",
    'modules/a/a.view.ts':
      "import { load } from '../orders/orders.effects.ts';\n\nexport const probe = load;\n",
  });

  assert.deepEqual(
    findings.map(({ file, range }) => `${file}:${String(range.line)}:${String(range.column)}`),
    [
      'modules/a/a.view.ts:1:1',
      'modules/z/z.view.ts:1:1',
      'modules/z/z.view.ts:1:53',
      'modules/z/z.view.ts:3:1',
    ],
  );
});
