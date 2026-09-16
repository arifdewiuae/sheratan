// The golden path through the real thing: a browser, the built runtime, a live
// feed, and no bundler. Runs once per build (see playwright.config.ts).

import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';

const ROWS = 500;

/** The heading row is markup, not data. */
const ROW = '.metric:not(.heading)';

/** The project name decides which build the import map points at. */
function appUrl(project: string): string {
  return project.startsWith('prod') ? '/?build=prod' : '/';
}

function watchConsole(page: Page): string[] {
  const errors: string[] = [];

  page.on('console', (message: ConsoleMessage) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  page.on('pageerror', (error) => errors.push(error.message));

  return errors;
}

/**
 * What the table is showing, right now. The tiles are all rates or ratios, so
 * progress is asserted against the thing a user actually looks at: no counter
 * to trust, and a stalled feed cannot hide behind one that keeps ticking.
 */
const snapshot = async (page: Page): Promise<string> =>
  (await page.locator(`${ROW} .metric-value`).allInnerTexts()).join(',');

/** Long enough for several frames, short enough to keep the suite quick. */
const SETTLE_MS = 400;

test.beforeEach(async ({ page }, testInfo) => {
  await page.goto(appUrl(testInfo.project.name));
  await expect(page.locator(ROW)).toHaveCount(ROWS);
});

test('renders the whole table and keeps applying values', async ({ page }) => {
  const errors = watchConsole(page);

  await expect(page.locator('.tile')).toHaveCount(4);

  const first = await snapshot(page);

  await expect.poll(async () => snapshot(page), { timeout: 5000 }).not.toBe(first);

  // The headline tile is the frame rate, which reads an em dash until the
  // first sample lands. That it becomes a number is the whole claim.
  await expect
    .poll(async () => page.locator('.tile.headline .tile-value').innerText(), {
      timeout: 5000,
    })
    .toMatch(/^[1-9]/u);

  expect(errors).toEqual([]);
});

test('pausing stops applying values, and resuming carries on', async ({ page }) => {
  await page.getByRole('button', { name: 'Pause' }).click();

  // A batch can already be in flight when the click lands; let it finish
  // before the table is read, so this asserts about pausing and not a race.
  await page.waitForTimeout(SETTLE_MS);

  const paused = await snapshot(page);

  await page.waitForTimeout(SETTLE_MS);
  expect(await snapshot(page)).toBe(paused);

  await page.getByRole('button', { name: 'Resume' }).click();
  await expect.poll(async () => snapshot(page), { timeout: 5000 }).not.toBe(paused);
});

test('rows move as values change, and a moved row keeps its node', async ({ page }) => {
  // Pause first, so the assertions are about one reordering and not a race.
  await page.getByRole('button', { name: 'Pause' }).click();

  const marked = page.locator(ROW).first();

  await marked.evaluate((node: HTMLElement) => {
    node.dataset['marked'] = 'yes';
  });

  const name = await marked.locator('.metric-name').innerText();

  // The list holds still by name; ordering by value is what moves rows.
  await page.getByLabel('Sort by').selectOption('value');
  await expect(page.locator(ROW).first().locator('.metric-name')).not.toHaveText(name);

  // The row is somewhere else in the list, but it is the same element.
  const moved = page.locator('[data-marked="yes"]');

  await expect(moved).toHaveCount(1);
  await expect(moved.locator('.metric-name')).toHaveText(name);
});

/** True when the numbers read as a descending column. */
function descending(values: readonly number[]): boolean {
  return values.every((value, index) => index === 0 || (values[index - 1] ?? 0) >= value);
}

test('the default order is by name, and by value it follows the numbers', async ({ page }) => {
  await page.getByRole('button', { name: 'Pause' }).click();

  const names = await page.locator(`${ROW} .metric-name`).allInnerTexts();

  expect(names).toEqual(names.toSorted((left, right) => left.localeCompare(right)));

  await page.getByLabel('Sort by').selectOption('value');

  // The DOM catches up on the next frame, so poll rather than read once.
  await expect
    .poll(
      async () =>
        descending((await page.locator(`${ROW} .metric-value`).allInnerTexts()).map(Number)),
      { timeout: 5000 },
    )
    .toBe(true);
});
