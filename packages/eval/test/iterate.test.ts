// The protocol, proved against a fake arm. Every one of these would otherwise
// cost a model run to find out, and two of them — the cap and the test-body
// leak — are failures that would silently produce a publishable number.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  feedbackFor,
  iterate,
  ITERATION_CAP,
  type CleanRun,
  type SuiteRun,
} from '../src/iterate.ts';
import type { Reply, Session } from '../src/session.ts';

const PROMPT = 'Build a Customers page at the app root.';

/** A body an agent must never see, because it says what to write. */
const ASSERTION_BODY = 'await expect(page.getByTestId("loading")).toBeVisible()';

const CLEAN: CleanRun = { ok: true, output: 'No violations.' };

const DIRTY: CleanRun = {
  ok: false,
  output: 'SHR-L002 services/api.contract.ts:12 a contract may not import a transport',
};

const GREEN: SuiteRun = { ok: true, failing: [], raw: 'ok 1 - shows a loading state' };

const RED: SuiteRun = {
  ok: false,
  failing: ['shows a loading state', 'renders 25 rows in server order'],
  raw: `not ok 1 - shows a loading state\n  ${ASSERTION_BODY}`,
};

function fakeSession(): Session & { said: string[] } {
  const said: string[] = [];

  return {
    said,
    id: () => 'fake-session',
    spent: () => said.length,

    async say(message: string): Promise<Reply> {
      said.push(message);

      return { ok: true, text: 'done', turns: 1, costUSD: 1, durationMs: 1, raw: '' };
    },
  };
}

/** A judge that answers from a script, one entry per iteration. */
function scripted(script: readonly (readonly [CleanRun, SuiteRun])[]): {
  clean(): Promise<CleanRun>;
  suite(): Promise<SuiteRun>;
} {
  let at = 0;

  const current = (): readonly [CleanRun, SuiteRun] => script[Math.min(at, script.length - 1)]!;

  return {
    clean: async () => current()[0],

    async suite(): Promise<SuiteRun> {
      const answer = current()[1];

      at += 1;

      return answer;
    },
  };
}

test('a task done first time is one iteration', async () => {
  const session = fakeSession();
  const run = await iterate({ session, judge: scripted([[CLEAN, GREEN]]), prompt: PROMPT });

  assert.equal(run.converged, true);
  assert.equal(run.iterations, 1);
  assert.deepEqual(session.said, [PROMPT]);
});

test('iterations are counted the way a reader would count them', async () => {
  const session = fakeSession();

  const run = await iterate({
    session,
    judge: scripted([
      [CLEAN, RED],
      [DIRTY, RED],
      [CLEAN, GREEN],
    ]),
    prompt: PROMPT,
  });

  assert.equal(run.converged, true);
  assert.equal(run.iterations, 3);
  assert.equal(run.log.at(-1)?.n, 3);

  // The task text once, then one message per failed iteration — the agent is
  // resumed rather than restarted, which is what makes "3" mean anything.
  assert.equal(session.said.length, 3);
  assert.equal(session.said[0], PROMPT);
});

test('a checker that still complains keeps the loop going even with the suite green', async () => {
  const session = fakeSession();

  const run = await iterate({
    session,
    judge: scripted([
      [DIRTY, GREEN],
      [CLEAN, GREEN],
    ]),
    prompt: PROMPT,
  });

  assert.equal(run.converged, true);
  assert.equal(run.iterations, 2);
  assert.match(session.said[1] ?? '', /SHR-L002/);
});

test('not converging is a recorded outcome, at exactly the cap', async () => {
  const session = fakeSession();
  const run = await iterate({ session, judge: scripted([[DIRTY, RED]]), prompt: PROMPT });

  assert.equal(run.converged, false);
  assert.equal(run.iterations, ITERATION_CAP);
  assert.equal(run.log.length, ITERATION_CAP);

  // The cap is a stop, not a last round of advice: nothing is said after it.
  assert.equal(session.said.length, ITERATION_CAP);
});

test('a lower cap is honoured, so a smoke run cannot quietly cost ten', async () => {
  const session = fakeSession();
  const run = await iterate({ session, judge: scripted([[DIRTY, RED]]), prompt: PROMPT, cap: 2 });

  assert.equal(run.iterations, 2);
});

test('the agent is never shown a test body', async () => {
  const session = fakeSession();

  await iterate({
    session,
    judge: scripted([
      [CLEAN, RED],
      [CLEAN, GREEN],
    ]),
    prompt: PROMPT,
  });

  for (const message of session.said) {
    assert.ok(!message.includes(ASSERTION_BODY), `a test body leaked into: ${message}`);
    assert.ok(!message.includes('not ok 1'), `raw suite output leaked into: ${message}`);
  }

  assert.match(session.said[1] ?? '', /shows a loading state/);
  assert.match(session.said[1] ?? '', /renders 25 rows in server order/);
});

test('reaching for a test-only surface is recorded on the run', async () => {
  const session = fakeSession();

  const run = await iterate({
    session,
    judge: scripted([[CLEAN, GREEN]]),
    prompt: PROMPT,
    tampering: () => ['/__inspect/requests'],
  });

  assert.deepEqual(run.tampering, ['/__inspect/requests']);
});

test('the checker speaks in full and the suite speaks in names', () => {
  const message = feedbackFor(DIRTY, RED);

  assert.match(message, /a contract may not import a transport/);
  assert.match(message, /- shows a loading state/);
  assert.ok(!message.includes(ASSERTION_BODY));
});

test('a suite that fails without naming anything says so rather than saying nothing', () => {
  const message = feedbackFor(CLEAN, { ok: false, failing: [], raw: 'the runner crashed' });

  assert.match(message, /none of them reported a name/);
  assert.ok(!message.includes('the runner crashed'));
});
