// What every hidden suite is written against (EVAL-TASKS §1.4).
//
// Two origins, and the difference between them is the whole point. The app is
// at `EVAL_ORIGIN`, behind the proxy, and that is the only thing an arm can
// see. The control and inspection surfaces are at `EVAL_BACKEND`, `evalkit`'s
// own address, which the proxy does not serve — a control call made at the
// app's origin is recorded as tampering and voids the run, so a suite that
// reached for one would sabotage every run it scored.
//
// **This is the only file that may name those surfaces.** `test/neutral.test.ts`
// enforces it, along with the rule that no suite names a framework: a suite
// that mentions one has stopped being the same measurement for both arms.

import {
  test as base,
  expect,
  type Page,
  type PlaywrightTestArgs,
  type PlaywrightTestOptions,
  type PlaywrightWorkerArgs,
  type PlaywrightWorkerOptions,
  type TestType,
} from '@playwright/test';

import { Route } from '../evalkit/src/state.ts';
import type { Order } from '../evalkit/src/data.ts';

export { expect, Route };

/**
 * Where the arm's app is, and the only origin a suite navigates to. Exported
 * because a test that installs something before the first script runs has to
 * navigate itself — the `app` fixture has already been there.
 */
export const APP: string = process.env['EVAL_ORIGIN'] ?? '';

/** Where `evalkit` is, directly. Never reachable from the page. */
const BACKEND = process.env['EVAL_BACKEND'] ?? '';

/** How a test aims a refusal: a status, a message, and how many calls it eats. */
export interface Refusal {
  readonly status: number;
  readonly message?: string;
  /** Field messages, for the one status that carries them. */
  readonly errors?: Readonly<Record<string, string>>;
  /** How many calls to refuse. One, unless a test says otherwise. */
  readonly times?: number;
}

/** What a hidden test does to the server between assertions (EVAL-TASKS §1.3). */
export interface Control {
  /** Every later call to `route` waits `ms`. */
  latency(route: Route, ms: number): Promise<void>;
  /** Refuses the next calls to `route`. */
  fail(route: Route, refusal: Refusal): Promise<void>;
  /** Every knob and counter back to how the task started. */
  reset(): Promise<void>;
}

/** What a hidden test may ask about the run. Read-only by construction. */
export interface Inspect {
  /** Calls taken, per route, whether or not they were answered. */
  requests(): Promise<Readonly<Record<string, number>>>;
  /** The orders as they now stand, after any `PATCH`. */
  orders(): Promise<readonly Order[]>;
  /** The bodies `POST /api/orders` accepted, in order. */
  drafts(): Promise<readonly unknown[]>;
}

async function command(name: string, body: unknown = {}): Promise<void> {
  const answer = await fetch(`${BACKEND}/__control/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!answer.ok) throw new Error(`control ${name} answered ${String(answer.status)}`);
}

async function report<T>(name: string): Promise<T> {
  const answer = await fetch(`${BACKEND}/__inspect/${name}`);

  if (!answer.ok) throw new Error(`inspect ${name} answered ${String(answer.status)}`);

  return (await answer.json()) as T;
}

const control: Control = {
  latency: async (route, ms) => command('latency', { route, ms }),
  fail: async (route, refusal) => command('fail', { route, ...refusal }),
  reset: async () => command('reset'),
};

const inspect: Inspect = {
  requests: async () => report<Readonly<Record<string, number>>>('requests'),
  orders: async () => report<readonly Order[]>('orders'),
  drafts: async () => report<readonly unknown[]>('drafts'),
};

/** How a suite spells one of the hooks a task prompt names. */
export function hook(name: string): string {
  return `[data-testid="${name}"]`;
}

/** Where the page records moments when more than one thing was on screen. */
const OVERLAPS = 'evalOverlaps';

/**
 * Records every moment at which more than one of `selectors` was visible.
 *
 * Sampled once per MutationObserver callback rather than once per record: a
 * callback is one batch of changes, which is the closest thing the platform
 * offers to "a frame", and the smallest unit both arms agree on. Sampling per
 * record would see inside a single commit, and what a commit contains is a
 * property of the framework rather than of the app — so a per-record sample
 * would be measuring the arms against different rulers.
 */
export async function watchOverlap(page: Page, selectors: readonly string[]): Promise<void> {
  await page.addInitScript(
    ([key, watched]: [string, readonly string[]]) => {
      const found: string[][] = [];

      Object.defineProperty(window, key, { get: () => found });

      const showing = (): string[] =>
        watched.filter((selector) =>
          [...document.querySelectorAll(selector)].some((node) => node.checkVisibility()),
        );

      const sample = (): void => {
        const shown = showing();

        if (shown.length > 1) found.push(shown);
      };

      new MutationObserver(sample).observe(document, {
        subtree: true,
        childList: true,
        attributes: true,
      });
    },
    [OVERLAPS, selectors] as [string, readonly string[]],
  );
}

/** Every moment {@link watchOverlap} caught. Empty is the only passing answer. */
export async function overlaps(page: Page): Promise<readonly string[][]> {
  return page.evaluate((key: string) => (window as never)[key] as string[][], OVERLAPS);
}

/**
 * What a hidden test is handed. There is deliberately no "page already at the
 * app" fixture: when a load happens relative to a latency or a queued refusal
 * is most of what these suites assert, so every test navigates itself.
 */
export interface Fixtures {
  readonly control: Control;
  readonly inspect: Inspect;
}

/** The `test` every suite imports: Playwright's, plus the two fixtures above. */
export const test: TestType<
  PlaywrightTestArgs & PlaywrightTestOptions & Fixtures,
  PlaywrightWorkerArgs & PlaywrightWorkerOptions
> = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern -- Playwright's fixture signature
  control: async ({}, use) => {
    await control.reset();
    await use(control);
  },

  // eslint-disable-next-line no-empty-pattern -- Playwright's fixture signature
  inspect: async ({}, use) => {
    await use(inspect);
  },
});
