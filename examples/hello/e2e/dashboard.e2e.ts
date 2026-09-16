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

const SCALES: Record<string, number> = { k: 1e3, M: 1e6 };

/** Reads a compact tile value like "12.4k" back into a number. */
/** The fourth tile is the running total of values received. */
const appliedCount = async (page: Page): Promise<number> => {
  const text = await page.locator('.tiles .tile').nth(3).locator('.tile-value').innerText();
  const scale = SCALES[text.slice(-1)];

  if (scale === undefined) return Number(text);

  return Number(text.slice(0, -1)) * scale;
};

test.beforeEach(async ({ page }, testInfo) => {
  await page.goto(appUrl(testInfo.project.name));
  await expect(page.locator(ROW)).toHaveCount(ROWS);
});

test('renders the whole table and keeps applying values', async ({ page }) => {
  const errors = watchConsole(page);

  await expect(page.locator('.tile')).toHaveCount(4);

  const first = await appliedCount(page);

  await expect.poll(async () => appliedCount(page), { timeout: 5000 }).toBeGreaterThan(first);
  await expect(page.locator('.tile.headline .tile-value')).not.toHaveText('0');

  expect(errors).toEqual([]);
});

test('pausing stops applying values, and resuming carries on', async ({ page }) => {
  await page.getByRole('button', { name: 'Pause' }).click();

  const paused = await appliedCount(page);

  await page.waitForTimeout(400);
  expect(await appliedCount(page)).toBe(paused);

  await page.getByRole('button', { name: 'Resume' }).click();
  await expect.poll(async () => appliedCount(page), { timeout: 5000 }).toBeGreaterThan(paused);
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
