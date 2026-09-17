// A static file server that strips TypeScript on the way out. This is the
// prototype of `sheratan dev` (SPEC §10c) — no bundler, no plugins, no config
// — and it moves into the CLI in Week 3, along with `sheratan build`, which is
// the same stripping written to a directory instead of a response. Nobody is
// expected to copy this file into their own app.
//
// The runtime itself needs none of it; see public/no-build.html.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { watch } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { transform, type TransformFailure } from 'esbuild';

const root = dirname(fileURLToPath(import.meta.url));
const repo = resolve(root, '../..');
const core = resolve(repo, 'packages/core/dist');
const DEFAULT_PORT = 5173;

/** A busy port is someone else's dev server, not a reason to refuse to start. */
const PORT_ATTEMPTS = 10;

const NOT_FOUND = 404;
const FORBIDDEN = 403;
const UNPROCESSABLE = 422;
const OK = 200;
const JSON_INDENT = 2;

/** Where the page listens for "something changed" and "something broke". */
const RELOAD_PATH = '/__reload';

/** An editor can touch several files for one save; wait for the flurry to end. */
const RELOAD_DEBOUNCE_MS = 40;

/** How long the browser waits before reconnecting, so a restart reconnects. */
const RELOAD_RETRY_MS = 300;

/** Only sources the page actually loads; everything else is noise. */
const WATCHED = new Set(['.css', '.html', '.js', '.ts']);

/** Generated trees. A test report landing here is not an edit to react to. */
const IGNORED = ['node_modules', 'test-results', 'playwright-report', 'dist'];

/**
 * Reloading a page out from under an assertion is how a dev convenience
 * becomes a flaky suite, so the e2e run turns the whole thing off.
 */
const RELOADS = process.env['SHERATAN_RELOAD'] !== 'off';

const TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.ts': 'text/javascript; charset=utf-8',
};

/**
 * A compile failure, reduced to what a person needs to fix it and shaped so a
 * tool can read it too (SPEC A3). `sheratan dev` gives this a stable `SHR-`
 * code when the CLI lands; see TASKS.
 */
interface Failure {
  readonly type: 'error';
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly message: string;
  readonly source: string;
}

/** Where in the file, when the compiler knows; zeroes when it does not. */
interface Where {
  readonly line: number;
  readonly column: number;
  readonly source: string;
}

interface Resolved {
  file: string;
  base: string;
}

const NOWHERE: Where = { line: 0, column: 0, source: '' };

const listeners = new Set<ServerResponse>();

/** One line per event, to every page that has the dev client open. */
function notify(payload: Failure | { type: 'reload' }): void {
  for (const listener of listeners) listener.write(`data: ${JSON.stringify(payload)}\n\n`);
}

/** Holds the response open and writes one line per change (SSE). */
function subscribe(response: ServerResponse): void {
  response.writeHead(OK, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });

  response.write(`retry: ${String(RELOAD_RETRY_MS)}\n\n`);
  listeners.add(response);

  response.on('close', () => {
    listeners.delete(response);
  });
}

function isTransformFailure(error: unknown): error is TransformFailure {
  return error instanceof Error && Array.isArray((error as Partial<TransformFailure>).errors);
}

function whereIn(error: unknown): Where {
  const location = isTransformFailure(error) ? error.errors[0]?.location : undefined;

  if (location == null) return NOWHERE;

  return { line: location.line, column: location.column, source: location.lineText };
}

function textOf(error: unknown): string {
  const first = isTransformFailure(error) ? error.errors[0] : undefined;

  return first?.text ?? String(error);
}

function describe(file: string, error: unknown): Failure {
  return {
    type: 'error',
    file: relative(repo, file),
    message: textOf(error),
    ...whereIn(error),
  };
}

/**
 * The dev client. It reloads on a good save and paints the compiler's own words
 * over the page on a bad one, so a syntax error is visible without a refresh
 * and without reading the terminal.
 */
const RELOAD_CLIENT = `<script>
(() => {
  const box = document.createElement('pre');
  box.style.cssText = 'position:fixed;inset:auto 0 0 0;margin:0;padding:18px 20px;max-height:50vh;overflow:auto;background:#000;color:#fafaf8;font:12px/1.7 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;z-index:2147483647;border-top:2px solid #fafaf8';
  new EventSource('${RELOAD_PATH}').onmessage = (event) => {
    const report = JSON.parse(event.data);
    if (report.type === 'reload') { location.reload(); return; }
    box.textContent = report.file + ':' + report.line + ':' + report.column + '\\n\\n' + report.message + '\\n\\n' + report.source;
    if (!box.isConnected) document.body.append(box);
  };
})();
</script>`;

/** Maps a URL path to a file, keeping every request inside a served root. */
function locate(pathname: string): Resolved | undefined {
  const clean = pathname === '/' ? '/index.html' : pathname;

  if (clean.startsWith('/sheratan/')) {
    return { file: join(core, clean.slice('/sheratan/'.length)), base: core };
  }

  // public/no-build.html reaches the package by relative path, which is what a
  // plain static server at the repository root sees too.
  if (clean.startsWith('/packages/')) {
    return { file: join(repo, clean), base: repo };
  }

  return { file: join(root, clean), base: root };
}

function contentType(file: string): string {
  return TYPES[extname(file)] ?? 'application/octet-stream';
}

async function body(file: string, wantsProd: boolean): Promise<string | Buffer> {
  const source = await readFile(file);

  if (extname(file) === '.ts') {
    const { code } = await transform(source.toString('utf8'), { loader: 'ts', target: 'es2022' });

    return code;
  }

  if (extname(file) === '.html') {
    // The import map is static markup, so the server is what switches builds.
    const markup = wantsProd
      ? source.toString('utf8').replaceAll('/sheratan/dev/', '/sheratan/prod/')
      : source.toString('utf8');

    if (!RELOADS) return markup;

    return markup.replace('</body>', `${RELOAD_CLIENT}</body>`);
  }

  return source;
}

/**
 * A missing file and a file that will not compile are different answers. The
 * second used to arrive as a 404, which sends you looking for a path problem
 * you do not have.
 */
function fail(response: ServerResponse, file: string, error: unknown, pathname: string): void {
  if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
    response.writeHead(NOT_FOUND, { 'content-type': 'text/plain' }).end(`not found: ${pathname}`);

    return;
  }

  const failure = describe(file, error);

  process.stdout.write(`${failure.file}:${String(failure.line)} ${failure.message}\n`);

  const headers = { 'content-type': 'application/json; charset=utf-8' };

  response.writeHead(UNPROCESSABLE, headers).end(JSON.stringify(failure, null, JSON_INDENT));
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://localhost');

  if (url.pathname === RELOAD_PATH) {
    subscribe(response);

    return;
  }

  const target = locate(url.pathname);

  if (target === undefined || !resolve(target.file).startsWith(target.base + sep)) {
    response.writeHead(FORBIDDEN).end('outside the served directory');

    return;
  }

  try {
    const content = await body(target.file, url.searchParams.get('build') === 'prod');

    response
      .writeHead(OK, { 'content-type': contentType(target.file), 'cache-control': 'no-store' })
      .end(content);
  } catch (error: unknown) {
    fail(response, target.file, error, url.pathname);
  }
}

/** Compiles the file that just changed, so a bad save is reported, not served. */
async function verify(file: string): Promise<Failure | undefined> {
  if (extname(file) !== '.ts') return undefined;

  try {
    await transform(await readFile(file, 'utf8'), { loader: 'ts', target: 'es2022' });

    return undefined;
  } catch (error: unknown) {
    return describe(file, error);
  }
}

/** A good save reloads every open page; a bad one paints the error over them. */
async function announce(file: string): Promise<void> {
  const failure = await verify(file);

  notify(failure ?? { type: 'reload' });
}

/**
 * Watches the example and the built runtime. Reporting a broken save at once,
 * rather than on the next request, is the whole point: waiting to find out is
 * how a dev server wastes your afternoon (A2, fail loudly and early).
 *
 * A full reload rather than a module swap: the app is one `render()` call, so
 * there is no state worth preserving and nothing to get subtly wrong.
 */
function watchSources(): void {
  let pending: NodeJS.Timeout | undefined;

  const changed = (_event: string, name: string | Buffer | null): void => {
    const file = typeof name === 'string' ? name : '';

    if (IGNORED.some((tree) => file.includes(tree)) || !WATCHED.has(extname(file))) return;

    clearTimeout(pending);

    pending = setTimeout(() => {
      void announce(join(root, file));
    }, RELOAD_DEBOUNCE_MS);
  };

  for (const directory of [root, core]) {
    try {
      watch(directory, { recursive: true }, changed);
    } catch {
      process.stdout.write(`not watching ${directory} (build it first)\n`);
    }
  }
}

/** Takes the next free port rather than dying on a server you forgot to stop. */
function start(port: number, attemptsLeft: number): void {
  const server = createServer((request, response) => {
    void handle(request, response);
  });

  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code !== 'EADDRINUSE' || attemptsLeft === 0) throw error;

    process.stdout.write(`port ${String(port)} is busy\n`);
    start(port + 1, attemptsLeft - 1);
  });

  server.listen(port, () => {
    if (RELOADS) watchSources();
    const how = RELOADS ? ' (reloads on save)' : '';

    process.stdout.write(`examples/hello on http://localhost:${String(port)}/${how}\n`);
  });
}

start(Number(process.env['PORT'] ?? DEFAULT_PORT), PORT_ATTEMPTS);
