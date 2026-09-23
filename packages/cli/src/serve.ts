// `sheratan dev` (SPEC §10c): a static file server that strips types on the
// way out. No bundler, no plugins, no config — `dev` and `build` differ only
// in where the stripped output goes, and they strip with the same function.
//
// It reloads on a good save and paints the failure over the page on a bad one,
// because finding out at the next request is how a dev server wastes an
// afternoon (A2: fail loudly and early).

import { watch, type FSWatcher } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
import { dirname, extname, join, relative } from 'node:path';

import { ENCODING, INDEX_FILE, PAGE_FILE, RUNTIME, SOURCE_FILE } from './project.ts';
import { stripTypes } from './strip.ts';

/** Which app to serve, and how. */
export interface DevOptions {
  /** The folder holding `index.html`, served at `/`. */
  readonly root: string;
  /** The port to take, or the first of the ports to try. */
  readonly port: number;
  /** Reload open pages on save. An e2e run turns it off so it cannot race. */
  readonly reload: boolean;
}

/** A running dev server. Disposing it closes the port and the watchers. */
export interface DevServer extends AsyncDisposable {
  /** The port it actually took, which is not always the one asked for. */
  readonly port: number;
}

/** A save that will not strip, in the shape the page's overlay reads (SPEC A3). */
interface Failure {
  readonly type: typeof Event.Error;
  /** Relative to the app root, so it reads the same as an editor's tab. */
  readonly file: string;
  readonly message: string;
}

/** A busy port is someone else's dev server, not a reason to refuse to start. */
const PORT_ATTEMPTS = 10;

const OK = 200;

const FORBIDDEN = 403;

const NOT_FOUND = 404;

const UNPROCESSABLE = 422;

const JSON_INDENT = 2;

/** The two `errno` codes this server tells apart, named where they are read. */
const NO_SUCH_FILE = 'ENOENT';

const PORT_IN_USE = 'EADDRINUSE';

/** What the page is told, and what the client in it matches on. */
const Event = {
  /** The save was good: pull the page again. */
  Reload: 'reload',
  /** The save will not strip: paint it over the page instead. */
  Error: 'error',
} as const;

/** One of the events the reload stream carries. */
type Event = (typeof Event)[keyof typeof Event];

/** A request's URL is parsed against an origin; only the path is ever used. */
const ORIGIN = 'http://localhost';

/** A file inside the app to resolve the runtime from; it need not exist. */
const RESOLVE_FROM = 'sheratan.dev';

const TEXT = 'text/plain';

const JSON_TYPE = 'application/json; charset=utf-8';

const CONTENT_TYPE = 'content-type';

/** Where the page listens for "something changed" and "something broke". */
const RELOAD_PATH = '/__reload';

/** An editor can touch several files for one save; wait for the flurry to end. */
const RELOAD_DEBOUNCE_MS = 40;

/** How long the browser waits before reconnecting, so a restart reconnects. */
const RELOAD_RETRY_MS = 300;

/** Only sources the page actually loads; everything else is noise. */
const WATCHED = new Set(['.css', '.html', '.js', '.ts']);

/** Generated trees: a test report landing here is not an edit to react to. */
const IGNORED = ['node_modules', 'test-results', 'playwright-report', 'dist'];

/** The runtime is served from the package the project installed, under one path. */
const RUNTIME_PATH = '/sheratan/';

/** One request, once its path and build mode have been worked out. */
interface Asked {
  readonly request: IncomingMessage;
  readonly path: string;
  readonly file: string;
  readonly production: boolean;
}

/** What a browser asks for when it is navigating rather than fetching. */
const PAGE_TYPE = 'text/html';

/** `?build=prod` swaps the import map over, so both builds run the same page. */
const BUILD = 'build';

const PRODUCTION = 'prod';

const TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': JSON_TYPE,
  '.map': JSON_TYPE,
  '.svg': 'image/svg+xml',
  '.ts': 'text/javascript; charset=utf-8',
};

/** A file to serve, resolved from the path a request asked for. */
interface Resolved {
  readonly file: string;
}

/**
 * The dev client: reloads on a good save, and paints the failure over the page
 * on a bad one, so a broken file is visible without reading the terminal.
 */
const RELOAD_CLIENT = `<script>
(() => {
  const box = document.createElement('pre');
  box.style.cssText = 'position:fixed;inset:auto 0 0 0;margin:0;padding:18px 20px;max-height:50vh;overflow:auto;background:#000;color:#fafaf8;font:12px/1.7 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;z-index:2147483647;border-top:2px solid #fafaf8';
  new EventSource('${RELOAD_PATH}').onmessage = (event) => {
    const report = JSON.parse(event.data);
    if (report.type === '${Event.Reload}') { location.reload(); return; }
    box.textContent = report.file + '\\n\\n' + report.message;
    if (!box.isConnected) document.body.append(box);
  };
})();
</script>`;

function contentType(file: string): string {
  return TYPES[extname(file)] ?? 'application/octet-stream';
}

/** Where the runtime this project installed keeps both of its builds. */
function distIn(root: string): string | undefined {
  try {
    return dirname(dirname(createRequire(join(root, RESOLVE_FROM)).resolve(RUNTIME)));
  } catch {
    return undefined;
  }
}

/** A page under `?build=prod` reads the same markup against the other build. */
function page(markup: string, production: boolean, reload: boolean): string {
  const built = production ? markup.replaceAll('/sheratan/dev/', '/sheratan/prod/') : markup;

  return reload ? built.replace('</body>', `${RELOAD_CLIENT}</body>`) : built;
}

/**
 * A deep link: the browser navigating to a path the app routes itself, rather
 * than fetching a file. A missing asset keeps its 404 — an HTML body where a
 * `.js` was expected sends you hunting for the wrong bug.
 */
function isNavigation(request: IncomingMessage, pathname: string): boolean {
  return (
    extname(pathname) === '' &&
    !pathname.startsWith(RUNTIME_PATH) &&
    (request.headers.accept ?? '').includes(PAGE_TYPE)
  );
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === NO_SUCH_FILE;
}

class Dev implements DevServer {
  readonly port: number;

  private readonly options: DevOptions;

  private readonly dist: string | undefined;

  private readonly server: Server;

  private readonly listeners = new Set<ServerResponse>();

  private readonly watchers: FSWatcher[] = [];

  private pending: NodeJS.Timeout | undefined;

  constructor(options: DevOptions, server: Server, port: number) {
    this.options = options;
    this.server = server;
    this.port = port;
    this.dist = distIn(options.root);
  }

  /** Serves one request: the reload stream, a file, or the reason it cannot. */
  async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    // Node gives every server request a url; the optional type is the client's.
    const url = new URL(request.url as string, ORIGIN);

    if (url.pathname === RELOAD_PATH) {
      this.subscribe(response);

      return;
    }

    // `new URL` resolves dot segments before anything sees them, so a path
    // cannot climb out of the root: /../../etc/hosts arrives as /etc/hosts and
    // is looked for inside the project, where it is simply not found.
    const target = this.locate(url.pathname);

    if (target === undefined) {
      response.writeHead(FORBIDDEN).end('sheratan is not installed in this project');

      return;
    }

    const asked: Asked = {
      request,
      path: url.pathname,
      file: target.file,
      production: url.searchParams.get(BUILD) === PRODUCTION,
    };

    try {
      await this.send(response, target.file, asked.production);
    } catch (error: unknown) {
      await this.orRoute(response, asked, error);
    }
  }

  private async send(response: ServerResponse, file: string, production: boolean): Promise<void> {
    const content = await this.body(file, production);
    const headers = { [CONTENT_TYPE]: contentType(file), 'cache-control': 'no-store' };

    response.writeHead(OK, headers).end(content);
  }

  /**
   * A path with no file behind it is either a route the app resolves itself or
   * a mistake, and only the first gets the page. A static host is told the
   * same thing by `build`, which writes it as `404.html`.
   */
  private async orRoute(response: ServerResponse, asked: Asked, error: unknown): Promise<void> {
    if (!isMissing(error) || !isNavigation(asked.request, asked.path)) {
      this.refuse(response, asked.file, error, asked.path);

      return;
    }

    const index = join(this.options.root, INDEX_FILE);

    try {
      await this.send(response, index, asked.production);
    } catch (missing: unknown) {
      this.refuse(response, index, missing, asked.path);
    }
  }

  /** Watches the app, so a save is reported at once rather than at the next request. */
  watchSources(): void {
    const changed = (_event: string, name: string | null): void => {
      const file = name ?? '';

      if (IGNORED.some((tree) => file.includes(tree)) || !WATCHED.has(extname(file))) return;

      clearTimeout(this.pending);

      this.pending = setTimeout(() => {
        void this.announce(join(this.options.root, file));
      }, RELOAD_DEBOUNCE_MS);
    };

    this.watchers.push(watch(this.options.root, { recursive: true }, changed));
  }

  async [Symbol.asyncDispose](): Promise<void> {
    clearTimeout(this.pending);

    for (const watcher of this.watchers) watcher.close();

    for (const listener of this.listeners) listener.end();

    await new Promise<void>((done) => {
      this.server.close(() => {
        done();
      });
    });
  }

  /** The app root, plus the runtime under one path of its own. */
  private locate(pathname: string): Resolved | undefined {
    const clean = pathname === '/' ? `/${INDEX_FILE}` : pathname;
    const { root } = this.options;

    if (!clean.startsWith(RUNTIME_PATH)) return { file: join(root, clean) };

    if (this.dist === undefined) return undefined;

    return { file: join(this.dist, clean.slice(RUNTIME_PATH.length)) };
  }

  private async body(file: string, production: boolean): Promise<string | Buffer> {
    const source = await readFile(file);

    if (extname(file) === SOURCE_FILE) return stripTypes(source.toString(ENCODING));

    if (extname(file) !== PAGE_FILE) return source;

    return page(source.toString(ENCODING), production, this.options.reload);
  }

  /**
   * A missing file and a file that will not strip are different answers. The
   * second arriving as a 404 sends you looking for a path problem you do not have.
   */
  private refuse(response: ServerResponse, file: string, error: unknown, path: string): void {
    if (isMissing(error)) {
      response.writeHead(NOT_FOUND, { [CONTENT_TYPE]: TEXT }).end(`not found: ${path}`);

      return;
    }

    const failure = this.describe(file, error);
    const headers = { [CONTENT_TYPE]: JSON_TYPE };

    response.writeHead(UNPROCESSABLE, headers).end(JSON.stringify(failure, null, JSON_INDENT));
  }

  private describe(file: string, error: unknown): Failure {
    return {
      type: Event.Error,
      file: relative(this.options.root, file),
      message: error instanceof Error ? error.message : String(error),
    };
  }

  /** Holds the response open and writes one line per change (SSE). */
  private subscribe(response: ServerResponse): void {
    response.writeHead(OK, {
      [CONTENT_TYPE]: 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });

    response.write(`retry: ${String(RELOAD_RETRY_MS)}\n\n`);
    this.listeners.add(response);

    response.on('close', () => {
      this.listeners.delete(response);
    });
  }

  /** A good save reloads every open page; a bad one paints the failure over them. */
  private async announce(file: string): Promise<void> {
    const payload = (await this.verify(file)) ?? { type: Event.Reload };

    for (const listener of this.listeners) {
      listener.write(`data: ${JSON.stringify(payload)}\n\n`);
    }
  }

  /** Strips the file that changed, so a bad save is reported and not served. */
  private async verify(file: string): Promise<Failure | undefined> {
    if (extname(file) !== SOURCE_FILE) return undefined;

    try {
      stripTypes(await readFile(file, ENCODING));

      return undefined;
    } catch (error: unknown) {
      return this.describe(file, error);
    }
  }
}

/** One attempt at one port, resolving with the port the server actually took. */
async function bind(server: Server, port: number): Promise<number> {
  const { promise, resolve, reject } = Promise.withResolvers<number>();

  const failed = (error: Error): void => {
    reject(error);
  };

  server.once('error', failed);

  server.listen(port, () => {
    server.removeListener('error', failed);

    // A listening TCP server always reports an address; the union in the
    // types is for the pipe and socket forms this server never takes.
    resolve((server.address() as AddressInfo).port);
  });

  return promise;
}

/** Takes the next free port rather than dying on a server you forgot to stop. */
async function listen(server: Server, port: number, attempts: number): Promise<number> {
  try {
    return await bind(server, port);
  } catch (error: unknown) {
    const busy = (error as NodeJS.ErrnoException).code === PORT_IN_USE;

    if (!busy || attempts === 0) throw error;

    return listen(server, port + 1, attempts - 1);
  }
}

/**
 * Serves `root` with types stripped on the way out, and resolves once it is
 * listening. The process stays alive because the server does, until `signal`
 * aborts or the caller disposes it.
 *
 * @example
 * await using dev = await serve({ root: 'app', port: 5173, reload: true });
 */
export async function serve(options: DevOptions, signal?: AbortSignal): Promise<DevServer> {
  const server = createServer();
  const port = await listen(server, options.port, PORT_ATTEMPTS);
  const dev = new Dev(options, server, port);

  server.on('request', (request, response) => {
    void dev.handle(request, response);
  });

  if (options.reload) dev.watchSources();

  signal?.addEventListener('abort', () => {
    void dev[Symbol.asyncDispose]();
  });

  return dev;
}
