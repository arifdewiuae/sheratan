// The golden path through the real thing: a browser, the built runtime, a live
// feed, and no bundler. Runs once per build (see playwright.config.ts).

import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';

import { ROW_HEIGHT_PX } from '../lib/layout.ts';

const ROWS = 500;

/** The heading row is markup, not data, and a spacer is layout. */
const ROW = '.metric:not(.heading)';

/** Virtualising is on by default; the keyed specs are about the other shape. */
const KEYED = { name: 'Virtualise: on' };

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

/** One frame at 60fps, for pacing input the way a hand would. */
const FRAME_MS = 16;

test.beforeEach(async ({ page }, testInfo) => {
  await page.goto(appUrl(testInfo.project.name));
  await expect(page.locator('.tile')).toHaveCount(5);
});

/** Puts every row back in the DOM, for the specs about keyed identity. */
async function unwindow(page: Page): Promise<void> {
  await page.getByRole('button', KEYED).click();
  await expect(page.locator(ROW)).toHaveCount(ROWS);
}

test('renders the whole table and keeps applying values', async ({ page }) => {
  const errors = watchConsole(page);

  await unwindow(page);

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
  await unwindow(page);
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
  // Keyed identity is the un-windowed promise: a windowed row is recycled by
  // position and deliberately does not follow its item (ADR 0003).
  await unwindow(page);

  // Pause too, so the assertions are about one reordering and not a race.
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
  await unwindow(page);
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

test('virtualising keeps the DOM small while the list stays whole', async ({ page }) => {
  const errors = watchConsole(page);

  await page.getByRole('button', { name: 'Pause' }).click();

  const inPage = page.locator('.tiles .tile').nth(4).locator('.tile-value');
  const rendered = await page.locator(ROW).count();

  // Five hundred rows live, a few dozen of them in the page. The tile and the
  // DOM have to agree, or the tile is decoration.
  expect(rendered).toBeLessThan(ROWS);
  await expect(page.locator('.tiles .tile').nth(3).locator('.tile-value')).toHaveText(String(ROWS));
  await expect(inPage).toHaveText(String(rendered));

  const first = await page.locator(`${ROW} .metric-name`).first().innerText();

  // Scrolling is the whole claim: the rows that show change, and the number of
  // them does not, because no row was built to make it happen.
  await page.locator('.metrics').evaluate((list: HTMLElement) => {
    list.scrollTop = list.scrollHeight / 2;
  });

  await expect
    .poll(async () => page.locator(`${ROW} .metric-name`).first().innerText(), { timeout: 5000 })
    .not.toBe(first);

  expect(await page.locator(ROW).count()).toBe(rendered);

  // The scrollbar still describes five hundred rows, because the spacers do.
  const scrollable = await page
    .locator('.metrics')
    .evaluate((list: HTMLElement) => list.scrollHeight);

  expect(scrollable).toBeGreaterThan(ROWS * 20);

  await unwindow(page);
  await expect(inPage).toHaveText(String(ROWS));

  expect(errors).toEqual([]);
});

/** One wheel tick, as Chromium reports it. */
const WHEEL_PX = 120;
const TICKS = 6;

/**
 * Wheel ticks a frame apart, the way a hand produces them. Sequential on
 * purpose — the whole question is what each step does to the one after it —
 * and a programmatic `scrollTop = n` will not do: it settles in a single step
 * and never provokes the compensation this is looking for.
 */
async function wheelDown(page: Page, ticks: number): Promise<void> {
  if (ticks === 0) return;

  await page.mouse.wheel(0, WHEEL_PX);
  await page.waitForTimeout(FRAME_MS);
  await wheelDown(page, ticks - 1);
}

test('a windowed list stays where the wheel left it', async ({ page }) => {
  await page.getByRole('button', { name: 'Pause' }).click();

  const list = page.locator('.metrics');

  await list.hover();
  await wheelDown(page, TICKS);

  // Scroll anchoring is the trap, and it has to be a wheel to catch it: the
  // spacer above the rows changes height on every step, Chrome moves scrollTop
  // to hold its anchor still, and that move fires another scroll. Six ticks
  // used to carry the list to the very bottom on its own.
  await page.waitForTimeout(SETTLE_MS * 3);

  const resting = await list.evaluate((node: HTMLElement) => node.scrollTop);

  expect(resting).toBeLessThan(TICKS * WHEEL_PX + ROW_HEIGHT_PX);
});
