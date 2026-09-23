// The optional peer dependency: when the compiler is missing, the command says
// so and says what to install. Everything else that throws stays a fault.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { INSTALL_TYPESCRIPT, isMissingTypescript, MISSING_TYPESCRIPT } from '../src/peer.ts';
import { reasonFor } from '../src/run.ts';

/** What Node throws when a package cannot be resolved. */
const notFound = (message: string): Error =>
  Object.assign(new Error(message), { code: 'ERR_MODULE_NOT_FOUND' });

test('the compiler missing is recognised by both the code and the package', () => {
  assert.ok(
    isMissingTypescript(
      notFound(
        "Cannot find package 'typescript' imported from /app/node_modules/sheratan/dist/cli/sheratan.js",
      ),
    ),
  );

  assert.ok(isMissingTypescript(notFound("Cannot find module 'typescript/unstable/sync'")));
});

test('another package missing is not advice about TypeScript', () => {
  assert.equal(isMissingTypescript(notFound("Cannot find package 'happy-dom'")), false);
});

test('a fault in the checker is not the compiler missing', () => {
  assert.equal(isMissingTypescript(new Error("could not open 'tsconfig.json'")), false);
  assert.equal(isMissingTypescript('typescript'), false);
});

test('the message names what is missing and what to install', () => {
  assert.match(MISSING_TYPESCRIPT, /sheratan check needs the TypeScript compiler/);
  assert.match(INSTALL_TYPESCRIPT, /npm install -D typescript@7/);
});

test('the compiler missing reads as an install line, not as a project fault', () => {
  const missing = notFound("Cannot find package 'typescript'");

  assert.equal(reasonFor(missing), `${MISSING_TYPESCRIPT}\n\n${INSTALL_TYPESCRIPT}`);

  assert.equal(
    reasonFor(new Error('could not open tsconfig.json')),
    'could not open tsconfig.json',
  );
});
