// A static file server that strips TypeScript on the way out. This is the
// prototype of `sheratan dev` (SPEC §10c) — no bundler, no plugins, no config
// — and it moves into the CLI in Week 3, along with `sheratan build`, which is
// the same stripping written to a directory instead of a response. Nobody is
// expected to copy this file into their own app.
//
// The runtime itself needs none of it; see public/no-build.html.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { transform } from 'esbuild';

const root = dirname(fileURLToPath(import.meta.url));
const repo = resolve(root, '../..');
const core = resolve(repo, 'packages/core/dist');
const DEFAULT_PORT = 5173;
const NOT_FOUND = 404;
const FORBIDDEN = 403;
const OK = 200;

const TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.ts': 'text/javascript; charset=utf-8',
};

interface Resolved {
  file: string;
  base: string;
}

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

  // The import map is static markup, so the server is what switches builds.
  if (extname(file) === '.html' && wantsProd) {
    return source.toString('utf8').replaceAll('/sheratan/dev/', '/sheratan/prod/');
  }

  return source;
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const target = locate(url.pathname);

  if (target === undefined || !resolve(target.file).startsWith(target.base + sep)) {
    response.writeHead(FORBIDDEN).end('outside the served directory');

    return;
  }

  try {
    const content = await body(target.file, url.searchParams.get('build') === 'prod');

    response.writeHead(OK, { 'content-type': contentType(target.file) }).end(content);
  } catch {
    response
      .writeHead(NOT_FOUND, { 'content-type': 'text/plain' })
      .end(`not found: ${url.pathname}`);
  }
}

const port = Number(process.env['PORT'] ?? DEFAULT_PORT);

createServer((request, response) => {
  void handle(request, response);
}).listen(port, () => {
  process.stdout.write(`examples/hello on http://localhost:${String(port)}/\n`);
});
