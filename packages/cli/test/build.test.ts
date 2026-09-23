// `sheratan build` (SPEC §10c): types off, everything else through, into a
// directory a static host can serve. The tests read the output as a browser
// would — by what is in the files, not by what the builder reported.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { project, type Files } from '../../check/test/project.ts';
import { buildProject, Exit, run } from '../src/index.ts';
import { recorder } from './terminal.ts';

const OUT = 'dist';

const APP = `import { render } from 'sheratan';

import { createTodo } from './modules/todo/index.ts';

const host: Element | null = document.querySelector('#app');

if (host !== null) render(createTodo(), host);
`;

const PAGE = `<!doctype html>
<html lang="en">
  <head>
    <link rel="stylesheet" href="/styles/global.css" />
    <script type="importmap">
      { "imports": { "sheratan": "/sheratan/dev/index.js" } }
    </script>
  </head>
  <body>
    <main id="app"></main>
    <script type="module" src="/app.ts"></script>
  </body>
</html>
`;

/** A package the app resolves `sheratan` to, without a build having run. */
const INSTALLED: Files = {
  'node_modules/sheratan/package.json': JSON.stringify({
    name: 'sheratan',
    type: 'module',
    exports: './dist/prod/index.js',
  }),
  'node_modules/sheratan/dist/prod/index.js': 'export const signal = 0;\n',
};

const SITE: Files = {
  'index.html': PAGE,
  'app.ts': APP,
  'styles/global.css': ':root { color-scheme: light dark; }\n',
  'modules/todo/index.ts':
    "export const kind = 'view';\nexport const createTodo = (): string => 'todo';\n",
  ...INSTALLED,
};

const read = async (out: string, path: string): Promise<string> =>
  readFile(join(out, path), 'utf8');

/** Builds `files` and hands the output to `inspect`, before the project goes. */
async function built(files: Files, inspect: (out: string) => Promise<void>): Promise<void> {
  using made = project(files);
  const out = join(made.root, OUT);

  await buildProject({ root: made.root, out });
  await inspect(out);
}

test('types come off and a relative import points at the file it will be', async () => {
  await built(SITE, async (out) => {
    const app = await read(out, 'app.js');

    assert.match(app, /from '\.\/modules\/todo\/index\.js'/);
    assert.doesNotMatch(app, /Element \| null/);
    assert.match(app, /import \{ render \} from 'sheratan'/, 'a bare specifier is left alone');
  });
});

test('a page is pointed at the stripped entry and at the runtime beside it', async () => {
  await built(SITE, async (out) => {
    const page = await read(out, 'index.html');

    assert.match(page, /src="\/app\.js"/);
    assert.match(page, /"sheratan": "\.\/sheratan\/index\.js"/);
    assert.equal(await read(out, 'sheratan/index.js'), 'export const signal = 0;\n');
    assert.equal(await read(out, 'styles/global.css'), ':root { color-scheme: light dark; }\n');
  });
});

test('a project whose pages never name the runtime gets no copy of it', async () => {
  const library = { 'lib/format.ts': 'export const pad = (n: number): string => `${n}`;\n' };

  await built(library, async (out) => {
    assert.deepEqual(await readdir(out), ['lib']);
  });
});

test('tooling, dependencies and tests are in the project and not in the build', async () => {
  const site = {
    ...SITE,
    'modules/todo/todo.test.ts': 'export const spec = 1;\n',
    'e2e/todo.e2e.ts': 'export const spec = 1;\n',
    'playwright.config.ts': 'export default {};\n',
    '.hidden/secret.txt': 'x\n',
  };

  await built(site, async (out) => {
    const shipped = await readdir(out, { recursive: true });

    assert.deepEqual(shipped.filter((path) => !path.startsWith('sheratan')).toSorted(), [
      '404.html',
      'app.js',
      'index.html',
      'modules',
      'modules/todo',
      'modules/todo/index.js',
      'styles',
      'styles/global.css',
    ]);
  });
});

test('syntax that cannot be erased is refused by name, with the alternative', async () => {
  await assert.rejects(
    async () => built({ 'lib/kind.ts': 'export enum Kind { View }\n' }, async () => {}),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /^lib\/kind\.ts cannot be stripped: /);
      assert.match(error.message, /enum is not supported/);
      assert.match(error.message, /const object with `as const`/);

      return true;
    },
  );
});

test('the output is emptied first, so a file that left the project leaves the build', async () => {
  using made = project(SITE);
  const out = join(made.root, OUT);

  await buildProject({ root: made.root, out });
  await writeFile(join(out, 'gone.js'), 'export const stale = 1;\n');
  await buildProject({ root: made.root, out });

  const twice = await readdir(out, { recursive: true });

  assert.ok(!twice.includes('gone.js'), 'a file from the last build is still there');
  assert.ok(twice.includes('app.js'), 'and this one rebuilt what belongs');
});

test('a deep link into a route falls back to the page, under the name hosts serve', async () => {
  await built(SITE, async (out) => {
    // Byte for byte the page: a route is not another document, it is this one
    // reached by a URL the host has no file for. The project with no page of
    // its own is covered above, where the whole output is just `lib`.
    assert.equal(await read(out, '404.html'), await read(out, 'index.html'));
  });
});

test('an output directory holding the project is refused', async () => {
  using made = project(SITE);

  await assert.rejects(
    async () => buildProject({ root: made.root, out: made.root }),
    /would contain the project/,
  );
});

test('a page that names the runtime without it installed says what to install', async () => {
  await assert.rejects(
    async () => built({ 'index.html': PAGE }, async () => {}),
    /npm install sheratan/,
  );
});

test('the command reports what it wrote and exits 0', async () => {
  using made = project(SITE);
  const { terminal, out, err } = recorder();

  assert.equal(await run(['build', made.root, '--out', 'public'], terminal), Exit.Clean);
  assert.deepEqual(err, []);
  assert.match(out.join(''), /^2 files stripped, 2 copied, and the runtime beside them\./);
  assert.match(out.join(''), /Serve .*public with any static file server\./);
  assert.match(out.join(''), /A route falls back to 404\.html/);
  assert.match(await read(join(made.root, 'public'), 'app.js'), /render\(createTodo\(\), host\)/);
});
