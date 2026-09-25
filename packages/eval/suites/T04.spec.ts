// T04 — Optimistic status toggle with rollback.
//
// The four assertions EVAL-TASKS §3 lists for this task, and nothing else.
// The prompt names `order-row`, `status`, `ship` and `toast`, and gives rows
// no identifier — so rows are addressed by position, and what the server
// thinks is read from the inspection surface rather than from the page.
//
// That pairing is the point of this task: an optimistic app is one whose
// screen and whose server disagree for a while, and an assertion that only
// ever looks at the screen cannot tell the difference between an app that
// updated early and one that never asked.

import { ORDERS, Status } from '../evalkit/src/data.ts';
import { APP, expect, hook, Route, test } from './harness.ts';

/** §3: "800 ms latency", which is the window the badge has to move inside. */
const SLOW_MS = 800;

/** §3: "PATCH fails with 409". */
const CONFLICT = 409;

/** What the server says when it refuses, and what the toast must carry. */
const REFUSED = 'That order has already left the warehouse.';

const ROW = hook('order-row');
const STATUS = hook('status');
const SHIP = hook('ship');
const TOAST = hook('toast');

/** The two orders the concurrency assertion uses, and what they start as. */
const FIRST = 0;
const SECOND = 1;

test('the badge says shipped before the server has answered', async ({
  page,
  control,
  inspect,
}) => {
  await control.latency(Route.ShipOrder, SLOW_MS);
  await page.goto(APP);

  const rows = page.locator(ROW);

  await expect(rows).toHaveCount(ORDERS.length);

  await rows.nth(FIRST).locator(SHIP).click();

  await expect(rows.nth(FIRST).locator(STATUS)).toHaveText(Status.Shipped);

  // Still in flight: the screen moved first, which is the whole claim. Read
  // after the badge, so a page that waited for the server fails here rather
  // than passing on a technicality.
  expect((await inspect.orders())[FIRST]?.status).toBe(ORDERS[FIRST]?.status);
});

test('a refused ship puts the badge back and says why', async ({ page, control }) => {
  // The latency is what makes the rollback observable. Without it, the badge
  // can be asserted on before the optimistic write has even landed — the
  // assertion then passes on the value the row started with, and an app that
  // never rolls anything back passes with it.
  await control.latency(Route.ShipOrder, SLOW_MS);
  await control.fail(Route.ShipOrder, { status: CONFLICT, message: REFUSED });
  await page.goto(APP);

  const rows = page.locator(ROW);

  await expect(rows).toHaveCount(ORDERS.length);

  await rows.nth(FIRST).locator(SHIP).click();

  await expect(rows.nth(FIRST).locator(STATUS)).toHaveText(Status.Shipped);
  await expect(rows.nth(FIRST).locator(STATUS)).toHaveText(ORDERS[FIRST]?.status ?? '');
  await expect(page.locator(TOAST)).toContainText(REFUSED);
});

test('when one of two ships fails, only that row goes back', async ({ page, control, inspect }) => {
  await control.latency(Route.ShipOrder, SLOW_MS);
  await control.fail(Route.ShipOrder, { status: CONFLICT, message: REFUSED });
  await page.goto(APP);

  const rows = page.locator(ROW);

  await expect(rows).toHaveCount(ORDERS.length);

  await rows.nth(FIRST).locator(SHIP).click();

  // Waited for rather than assumed. The refusal is queued for whichever call
  // the server takes first, and clicking twice in a row would leave which one
  // that is to the scheduler.
  await expect.poll(async () => (await inspect.requests())[Route.ShipOrder]).toBe(1);

  await rows.nth(SECOND).locator(SHIP).click();

  // Both moved first — otherwise "only that one reverts" is being asserted
  // about a row that never went anywhere.
  await expect(rows.nth(FIRST).locator(STATUS)).toHaveText(Status.Shipped);
  await expect(rows.nth(SECOND).locator(STATUS)).toHaveText(Status.Shipped);

  await expect(rows.nth(FIRST).locator(STATUS)).toHaveText(ORDERS[FIRST]?.status ?? '');
  await expect(rows.nth(SECOND).locator(STATUS)).toHaveText(Status.Shipped);
});

test('a shipped order is still shipped after a reload', async ({ page, control: _fresh }) => {
  await page.goto(APP);

  const rows = page.locator(ROW);

  await expect(rows).toHaveCount(ORDERS.length);

  await rows.nth(FIRST).locator(SHIP).click();

  await expect(rows.nth(FIRST).locator(STATUS)).toHaveText(Status.Shipped);

  await page.reload();

  await expect(page.locator(ROW).nth(FIRST).locator(STATUS)).toHaveText(Status.Shipped);
});
