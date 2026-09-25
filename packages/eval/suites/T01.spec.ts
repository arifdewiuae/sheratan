// T01 — Customer list with loading and error states.
//
// The five assertions EVAL-TASKS §3 lists for this task, and nothing else.
// The prompt names four hooks, so those are the only four this may look for:
// asserting on a hook the task never asked for would fail an app that did
// exactly what it was told.
//
// "The table is visible" is therefore read as "a row is visible". The prompt
// gives rows a hook and the table none, so a row is the only evidence of a
// table that every correct app is guaranteed to produce.

import { CUSTOMERS } from '../evalkit/src/data.ts';
import { APP, expect, hook, overlaps, Route, test, watchOverlap } from './harness.ts';

/** §3: "With 800 ms latency". */
const SLOW_MS = 800;

/** §3: "Next request fails with 500". */
const SERVER_ERROR = 500;

/** What the server says when it refuses, and what the page should show. */
const REFUSED = 'The customer service is unavailable.';

/** §3: "Retry after a failure → exactly one new request". */
const ONE_MORE = 1;

const LOADING = hook('loading');
const ERROR = hook('error');
const RETRY = hook('retry');
const ROW = hook('customer-row');

test('the loader shows while the list is on its way, and then stops', async ({ page, control }) => {
  await control.latency(Route.Customers, SLOW_MS);
  await page.goto(APP);

  await expect(page.locator(LOADING)).toBeVisible();
  await expect(page.locator(ROW)).toHaveCount(CUSTOMERS.length);
  await expect(page.locator(LOADING)).not.toBeVisible();
});

/**
 * One row's three cells, present and in the order the prompt fixes. Order
 * matters as much as presence: a row reading "Netherlands Customer 1
 * Company 1" has the right cells in the wrong columns.
 */
function expectCells(text: string, cells: readonly string[]): void {
  let at = -1;

  for (const cell of cells) {
    const found = text.indexOf(cell, at + 1);

    expect(found, `"${cell}" is missing, or comes before the cell it follows`).toBeGreaterThan(at);

    at = found;
  }
}

test('every row the server sent is rendered, in its order, with its cells', async ({
  page,
  control: _fresh,
}) => {
  await page.goto(APP);

  const rows = page.locator(ROW);

  await expect(rows).toHaveCount(CUSTOMERS.length);

  const rendered = await rows.allInnerTexts();

  for (const [index, text] of rendered.entries()) {
    const customer = CUSTOMERS[index];

    expect(customer, `there is no fixture row ${String(index)}`).toBeDefined();

    if (customer === undefined) continue;

    expectCells(text, [customer.name, customer.company, customer.country]);
  }
});

test('a refused load shows the error, with no rows and no loader', async ({ page, control }) => {
  await control.fail(Route.Customers, { status: SERVER_ERROR, message: REFUSED });
  await page.goto(APP);

  await expect(page.locator(ERROR)).toBeVisible();
  await expect(page.locator(ROW)).toHaveCount(0);
  await expect(page.locator(LOADING)).not.toBeVisible();
});

test('retry asks exactly once more, and the list arrives', async ({ page, control, inspect }) => {
  await control.fail(Route.Customers, { status: SERVER_ERROR, message: REFUSED });
  await page.goto(APP);

  await expect(page.locator(RETRY)).toBeVisible();

  const before = (await inspect.requests())[Route.Customers] ?? 0;

  await page.locator(RETRY).click();

  await expect(page.locator(ROW)).toHaveCount(CUSTOMERS.length);

  const after = (await inspect.requests())[Route.Customers] ?? 0;

  expect(after - before).toBe(ONE_MORE);
});

test('never two of the loader, the error and the table at once', async ({ page, control }) => {
  // Installed before anything on the page runs, so the first paint is sampled
  // too. The whole cycle is driven — loading, error, loading again, table —
  // because the transitions are where an app shows two of them at once.
  await watchOverlap(page, [LOADING, ERROR, ROW]);

  await control.latency(Route.Customers, SLOW_MS);
  await control.fail(Route.Customers, { status: SERVER_ERROR, message: REFUSED });

  await page.goto(APP);

  await expect(page.locator(RETRY)).toBeVisible();

  await page.locator(RETRY).click();

  await expect(page.locator(ROW)).toHaveCount(CUSTOMERS.length);

  expect(await overlaps(page)).toEqual([]);
});
