// SHR-L007 (SPEC §5b): a promise-returning contract method takes an
// AbortSignal. What counts as "returns a promise" is structural — a type with
// a callable `then` — and what counts as taking a signal is the parameter
// list, wherever in it the signal sits.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { RuleCode } from '../src/index.ts';
import { only, type Files } from './project.ts';

/** SHR-L007's own findings: a contract here stands alone, with no module using it. */
const check = only(RuleCode.Cancellable);

const CONTRACT = 'services/feed.contract.ts';

const contract = (body: string): Files => ({
  [CONTRACT]: `export interface FeedApi {\n${body}}\n`,
});

const found = (files: Files): (readonly [string, number, string])[] =>
  check(files).map((finding) => [finding.file, finding.range.line, finding.message] as const);

test('a promise-returning method with no signal is told how to take one', () => {
  assert.deepEqual(check(contract('  rows(): Promise<number[]>;\n')), [
    {
      code: 'SHR-L007',
      severity: 'error',
      file: CONTRACT,
      range: { line: 2, column: 3 },
      message:
        'FeedApi.rows returns Promise<number[]> and takes no AbortSignal, so a caller cannot cancel it; allowed on a contract: every promise-returning method takes one.',
      fix: 'Give it a signal the caller can abort — rows(…, signal: AbortSignal), or an options object carrying one — and hand it to the transport, so an effect can drop the request in onDispose().',
      docs: 'https://sheratan.dev/errors/SHR-L007',
    },
  ]);
});

test('a signal is a signal wherever it sits in the parameters', () => {
  assert.deepEqual(
    check(
      contract(
        '  first(signal: AbortSignal): Promise<number>;\n' +
          '  second(page: number, signal: AbortSignal): Promise<number>;\n' +
          '  third(options: { page: number; signal: AbortSignal }): Promise<number>;\n' +
          '  fourth(options: { signal?: AbortSignal }): Promise<number>;\n' +
          '  fifth(controller: AbortController): Promise<number>;\n',
      ),
    ),
    [],
  );
});

test('a method that returns nothing to await needs no signal', () => {
  assert.deepEqual(
    check(
      contract(
        '  subscribe(onBatch: (ticks: readonly number[]) => void): void;\n' +
          '  latest(): number;\n' +
          '  teardown(): () => void;\n',
      ),
    ),
    [],
  );
});

test('a promise is what you can await, not what is called Promise', () => {
  const thenable = found(
    contract('  rows(): { then(resolve: (rows: readonly number[]) => void): void };\n'),
  );

  assert.deepEqual(
    thenable.map(([, line]) => line),
    [2],
  );

  assert.match(thenable[0]?.[2] ?? '', /takes no AbortSignal/);
});

test('a property of function type is a method too', () => {
  assert.deepEqual(
    found(contract('  rows: () => Promise<number[]>;\n')).map(([, line]) => line),
    [2],
  );
});

test('a contract written as a type alias is a contract', () => {
  assert.deepEqual(
    found({ [CONTRACT]: 'export type FeedApi = {\n  rows(): Promise<number[]>;\n};\n' }).map(
      ([, line]) => line,
    ),
    [2],
  );
});

test('a method inherited from a base interface is reported where it is declared', () => {
  assert.deepEqual(
    found({
      [CONTRACT]:
        'interface Base {\n  rows(): Promise<number[]>;\n}\n\nexport interface FeedApi extends Base {\n  latest(): number;\n}\n',
    }),
    [
      [
        CONTRACT,
        2,
        'FeedApi.rows returns Promise<number[]> and takes no AbortSignal, so a caller cannot cancel it; allowed on a contract: every promise-returning method takes one.',
      ],
    ],
  );
});

test('only a contract is a contract: an adapter and a lib type are not', () => {
  const promised = 'export interface FeedApi {\n  rows(): Promise<number[]>;\n}\n';

  assert.deepEqual(
    check({
      'services/feed.http.ts': promised,
      'lib/types.ts': promised,
      'modules/todo/index.ts': "export const kind = 'view';\n",
      'modules/todo/todo.view.ts': `${promised}export const todoView = (): string => 'todo';\n`,
    }),
    [],
  );
});

test('a contract with no types at all is reported nowhere', () => {
  assert.deepEqual(check({ [CONTRACT]: 'export const NAME = "feed";\n' }), []);
});

test('a contract that re-exports its type still declares it', () => {
  assert.deepEqual(
    found({
      'lib/feed.ts': 'export interface FeedApi {\n  rows(): Promise<number[]>;\n}\n',
      [CONTRACT]: "export type { FeedApi } from '../lib/feed.ts';\n",
    }).map(([file, line]) => [file, line]),
    [['lib/feed.ts', 2]],
  );
});

test("a package's type is reported against the contract that exports it, not inside the package", () => {
  const findings = found({ [CONTRACT]: "export type { Mutation } from 'sheratan';\n" });

  assert.deepEqual(
    findings.map(([file, line]) => [file, line]),
    [[CONTRACT, 1]],
  );

  assert.match(
    findings[0]?.[2] ?? '',
    /Mutation\.run returns Promise<void> and takes no AbortSignal/,
  );
});

test('a file that exports nothing hands out nothing to check', () => {
  assert.deepEqual(check({ [CONTRACT]: 'const feed = 1;\n' }), []);
});

test('a method a mapped type produced is reported at the contract', () => {
  assert.deepEqual(
    found({
      [CONTRACT]: "export type FeedApi = { [K in 'rows' | 'totals']: () => Promise<number> };\n",
    }),
    [
      [
        CONTRACT,
        1,
        'FeedApi.rows returns Promise<number> and takes no AbortSignal, so a caller cannot cancel it; allowed on a contract: every promise-returning method takes one.',
      ],
      [
        CONTRACT,
        1,
        'FeedApi.totals returns Promise<number> and takes no AbortSignal, so a caller cannot cancel it; allowed on a contract: every promise-returning method takes one.',
      ],
    ],
  );
});
