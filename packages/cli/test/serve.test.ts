// `sheratan dev` (SPEC §10c). The tests talk to the running server over HTTP,
// because that is the only interface it has: a request in, a file out, with
// the types taken off on the way.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';

import { project, type Files } from '../../check/test/project.ts';
import { Exit, run, serve, type DevServer } from '../src/index.ts';
import { recorder } from './terminal.ts';

/** Let the OS pick, so two suites in one run never collide. */
const ANY_PORT = 0;

const PAGE = `<!doctype html>
<html lang="en">
  <head>
    <script type="importmap">
      { "imports": { "sheratan": "/sheratan/dev/index.js" } }
    </script>
  </head>
  <body>
    <main id="app"></main>
  </body>
</html>
`;

const SITE: Files = {
  'index.html': PAGE,
  'app.ts': "import { rows } from './lib/data.ts';\n\nexport const started: number = rows;\n",
  'lib/data.ts': 'export const rows: number = 500;\n',
  'styles/global.css': ':root { color-scheme: light dark; }\n',
  'node_modules/sheratan/package.json': JSON.stringify({
    name: 'sheratan',
    type: 'module',
    exports: './dist/prod/index.js',
  }),
  'node_modules/sheratan/dist/prod/index.js': 'export const signal = 0;\n',
  'node_modules/sheratan/dist/dev/index.js': 'export const signal = 1;\n',
};

/** Serves `files` and hands the running server to `visit`, then closes it. */
async function serving(
  files: Files,
  visit: (base: string, root: string, server: DevServer) => Promise<void>,
  reload = true,
): Promise<void> {
  using made = project(files);
  await using server = await serve({ root: made.root, port: ANY_PORT, reload });

  await visit(`http://localhost:${String(server.port)}`, made.root, server);
}

/** What a browser sends when it is navigating rather than fetching. */
const NAVIGATING = { accept: 'text/html,application/xhtml+xml' };

test('a deep link into a route is answered with the page, not a 404', async () => {
  await serving(SITE, async (base) => {
    const response = await fetch(`${base}/orders/42`, { headers: NAVIGATING });

    assert.equal(response.status, 200);
    assert.match(await response.text(), /<main id="app">/);
  });
});

test('a missing asset keeps its 404, so a wrong path is not a silent page', async () => {
  await serving(SITE, async (base) => {
    const missing = await fetch(`${base}/lib/gone.js`, { headers: NAVIGATING });

    assert.equal(missing.status, 404);
    assert.equal(await missing.text(), 'not found: /lib/gone.js');

    // The runtime path answers for itself; a deep link may not stand in for it.
    const runtime = await fetch(`${base}/sheratan/nope`, { headers: NAVIGATING });

    assert.equal(runtime.status, 404);
  });
});

test('a fetch that is not a navigation gets a 404 even with no extension', async () => {
  await serving(SITE, async (base) => {
    const response = await fetch(`${base}/api/orders`, { headers: { accept: 'application/json' } });

    assert.equal(response.status, 404);
    assert.equal(await response.text(), 'not found: /api/orders');
  });
});

test('a project with no page at all still 404s a deep link, with the reason', async () => {
  const bare: Files = { 'app.ts': 'export const started = 1;\n' };

  await serving(bare, async (base) => {
    const response = await fetch(`${base}/orders/42`, { headers: NAVIGATING });

    assert.equal(response.status, 404);
  });
});

test('a page is served with the reload client in it', async () => {
  await serving(SITE, async (base) => {
    const response = await fetch(`${base}/`);
    const markup = await response.text();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.match(markup, /EventSource\('\/__reload'\)/);
    assert.match(markup, /"sheratan": "\/sheratan\/dev\/index\.js"/);
  });
});

test('with reloading off the page is the page, so nothing races an assertion', async () => {
  await serving(
    SITE,
    async (base) => {
      const markup = await (await fetch(`${base}/`)).text();

      assert.doesNotMatch(markup, /EventSource/);
    },
    false,
  );
});

test('?build=prod reads the same page against the other build', async () => {
  await serving(SITE, async (base) => {
    const markup = await (await fetch(`${base}/?build=prod`)).text();

    assert.match(markup, /"sheratan": "\/sheratan\/prod\/index\.js"/);
  });
});

test('a source file arrives as JavaScript, with its types gone', async () => {
  await serving(SITE, async (base) => {
    const response = await fetch(`${base}/app.ts`);

    assert.equal(response.headers.get('content-type'), 'text/javascript; charset=utf-8');
    assert.match(await response.text(), /export const started\s+= rows;/);
  });
});

// The build rewrites `./x.ts` to `./x.js` because the file it names becomes
// one. Here nothing is renamed: each source is served at the path it was
// written with, so rewriting the specifier would ask the browser for a file
// that does not exist.
test('a relative import keeps the extension it was written with', async () => {
  await serving(SITE, async (base) => {
    const entry = await (await fetch(`${base}/app.ts`)).text();

    assert.match(entry, /from '\.\/lib\/data\.ts'/);
    assert.equal((await fetch(`${base}/lib/data.ts`)).status, 200);
  });
});

test('a file the server has no type for is still served, as bytes', async () => {
  await serving({ ...SITE, 'public/logo.bin': 'not markup\n' }, async (base) => {
    const response = await fetch(`${base}/public/logo.bin`);

    assert.equal(response.headers.get('content-type'), 'application/octet-stream');
    assert.equal(await response.text(), 'not markup\n');
  });
});

test('the runtime is served from the package the project installed', async () => {
  await serving(SITE, async (base) => {
    const response = await fetch(`${base}/sheratan/prod/index.js`);

    assert.equal(await response.text(), 'export const signal = 0;\n');
  });
});

test('a project with no runtime installed refuses the path rather than inventing one', async () => {
  await serving({ 'index.html': PAGE }, async (base) => {
    const response = await fetch(`${base}/sheratan/dev/index.js`);

    assert.equal(response.status, 403);
    assert.equal(await response.text(), 'sheratan is not installed in this project');
  });
});

// The URL parse is the defence, not a check afterwards: dot segments are
// resolved before the server sees a path, so a climb lands back inside.
test('a path that tries to climb out of the project lands back inside it', async () => {
  await serving(SITE, async (base) => {
    const response = await fetch(`${base}/../../etc/hosts`);

    assert.equal(response.status, 404);
    assert.equal(await response.text(), 'not found: /etc/hosts');
  });
});

test('a missing file is a missing file, and says which one', async () => {
  await serving(SITE, async (base) => {
    const response = await fetch(`${base}/nowhere.js`);

    assert.equal(response.status, 404);
    assert.equal(await response.text(), 'not found: /nowhere.js');
  });
});

test('a file that will not strip is a different answer from a missing one', async () => {
  await serving({ ...SITE, 'bad.ts': 'export enum Kind { View }\n' }, async (base) => {
    const response = await fetch(`${base}/bad.ts`);
    const failure = (await response.json()) as { type: string; file: string; message: string };

    assert.equal(response.status, 422);
    assert.equal(failure.type, 'error');
    assert.equal(failure.file, 'bad.ts');
    assert.match(failure.message, /enum is not supported/);
  });
});

test('a good save tells every open page to reload', async () => {
  await serving(SITE, async (base, root) => {
    const stream = await fetch(`${base}/__reload`);
    const reader = (stream.body as ReadableStream<Uint8Array>).getReader();

    await reader.read();
    await writeFile(join(root, 'app.ts'), "export const started: string = 'again';\n");

    const { value } = await reader.read();

    assert.match(new TextDecoder().decode(value), /"type":"reload"/);
    await reader.cancel();
  });
});

test('a bad save paints the failure over them instead', async () => {
  await serving(SITE, async (base, root) => {
    const stream = await fetch(`${base}/__reload`);
    const reader = (stream.body as ReadableStream<Uint8Array>).getReader();

    await reader.read();
    await writeFile(join(root, 'app.ts'), 'export enum Kind { View }\n');

    const { value } = await reader.read();
    const event = new TextDecoder().decode(value);

    assert.match(event, /"type":"error"/);
    assert.match(event, /enum is not supported/);
    await reader.cancel();
  });
});

test('a busy port moves the server up rather than stopping it', async () => {
  const blocker = createServer();

  await new Promise<void>((listening) => {
    blocker.listen(0, listening);
  });

  const taken = (blocker.address() as { port: number }).port;

  try {
    using made = project(SITE);
    await using server = await serve({ root: made.root, port: taken, reload: false });

    assert.equal(server.port, taken + 1);
  } finally {
    await new Promise<void>((closed) => {
      blocker.close(() => {
        closed();
      });
    });
  }
});

test('disposing gives the port back', async () => {
  using made = project(SITE);
  const server = await serve({ root: made.root, port: ANY_PORT, reload: false });
  const { port } = server;

  await server[Symbol.asyncDispose]();

  await assert.rejects(async () => fetch(`http://localhost:${String(port)}/`));
});

/** The port the command printed, which is the only place a test can learn it. */
function portIn(said: string): string {
  const [, port = ''] = /http:\/\/localhost:(\d+)\//.exec(said) ?? [];

  return port;
}

test('the command serves the project, and the signal is what stops it', async () => {
  using made = project(SITE);
  const { terminal, out } = recorder();
  const stop = new AbortController();

  assert.equal(await run(['dev', made.root, '--port', '0'], terminal, stop.signal), Exit.Clean);

  const port = portIn(out.join(''));

  try {
    assert.match(out.join(''), /reloads on save/);
    assert.equal((await fetch(`http://localhost:${port}/app.ts`)).status, 200);
  } finally {
    stop.abort();
  }

  await assert.rejects(async () => fetch(`http://localhost:${port}/app.ts`));
});

test('--no-reload says so, and leaves the page alone', async () => {
  using made = project(SITE);
  const { terminal, out } = recorder();
  const stop = new AbortController();

  await run(['dev', made.root, '--port', '0', '--no-reload'], terminal, stop.signal);

  const port = portIn(out.join(''));

  try {
    const markup = await (await fetch(`http://localhost:${port}/`)).text();

    assert.doesNotMatch(out.join(''), /reloads on save/);
    assert.doesNotMatch(markup, /EventSource/);
  } finally {
    stop.abort();
  }
});
