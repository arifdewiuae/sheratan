// The Week-1 gate (SPEC §12, EVAL): the runtime runs from a static file server
// with no build step of any kind — plain JavaScript, published ESM.

import { expect, test, type Page } from '@playwright/test';

const ROWS = 50;

function errorsOf(page: Page): string[] {
  const errors: string[] = [];

  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  page.on('pageerror', (error) => errors.push(error.message));

  return errors;
}

const applied = async (page: Page): Promise<number> =>
  Number(await page.locator('.tiles .tile').nth(1).locator('.tile-value').innerText());

test('the zero-build page renders and keeps updating', async ({ page }) => {
  const errors = errorsOf(page);

  await page.goto('/public/no-build.html');

  await expect(page.locator('.metric')).toHaveCount(ROWS);
  await expect(page.locator('.tile.headline .tile-value')).toBeVisible();

  const first = await applied(page);

  await expect.poll(async () => applied(page), { timeout: 5000 }).toBeGreaterThan(first);

  // Ordered by name, so the rows hold still while the numbers move — all of
  // it without a build step in sight.
  const names = await page.locator('.metric .metric-name').allInnerTexts();

  expect(names).toEqual(names.toSorted((left, right) => left.localeCompare(right)));

  expect(errors).toEqual([]);
});
