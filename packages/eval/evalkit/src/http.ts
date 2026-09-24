// The small amount of HTTP every handler needs, in one file so no handler
// hand-rolls a header or a status number.

import type { IncomingMessage, ServerResponse } from 'node:http';

/** The statuses this server sends. Nothing writes a bare number. */
export const Status = {
  Ok: 200,
  NoContent: 204,
  BadRequest: 400,
  Unauthorized: 401,
  NotFound: 404,
  Conflict: 409,
  Unprocessable: 422,
  ServerError: 500,
} as const;

/** One of {@link Status}. */
export type Status = (typeof Status)[keyof typeof Status];

const JSON_TYPE = 'application/json; charset=utf-8';

/**
 * Agents drive this from a page the harness serves on another port, and a
 * browser will not send the request at all without these.
 */
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'access-control-allow-headers': 'content-type',
} as const;

/** No caching anywhere: a cached answer would make a seeded run unrepeatable. */
const NO_STORE = { 'cache-control': 'no-store' } as const;

/** Writes `body` as JSON. The only way this server answers. */
export function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': JSON_TYPE, ...CORS, ...NO_STORE });
  response.end(JSON.stringify(body));
}

/** Writes an empty answer, for `DELETE` and the preflight. */
export function sendEmpty(response: ServerResponse, status: number): void {
  response.writeHead(status, { ...CORS, ...NO_STORE });
  response.end();
}

/** The shape every error body takes (EVAL-TASKS §6). */
export function sendError(response: ServerResponse, status: number, error: string): void {
  sendJson(response, status, { error });
}

/**
 * The request's JSON body, or `undefined` when it is absent or malformed —
 * which the caller reports as a 400 rather than throwing, because an agent
 * sending a bad body should see the server say so.
 */
export async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) chunks.push(chunk as Buffer);

  const text = Buffer.concat(chunks).toString('utf8');

  if (text === '') return undefined;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Watches for the caller hanging up, and reports whether it has.
 *
 * It has to be armed *before* the answer is awaited, not sampled after: the
 * close arrives as an event, and by the time a handler thinks to look the
 * listener is the only thing that saw it. Reading `request.destroyed` instead
 * is wrong in the other direction — Node destroys a request stream as soon as
 * it has been fully read, so every normal call looks aborted.
 */
export function watchClient(request: IncomingMessage, response: ServerResponse): () => boolean {
  let gone = false;

  const mark = (): void => {
    if (!response.writableEnded) gone = true;
  };

  request.on('aborted', mark);
  response.on('close', mark);

  return () => gone || (response.destroyed && !response.writableEnded);
}

/** `pathname` and `searchParams`, with the host it arrived on filled in. */
export function urlOf(request: IncomingMessage): URL {
  return new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
}
