// A form in a real browser (SPEC §6 Forms, §9 Intents): the `<form>` reports
// its fields on every input, the messages follow what was typed, the server's
// refusal lands under the field it names, and a double submit sends one rule.

import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';

/** The project name decides which build the import map points at. */
function appUrl(project: string, path = '/'): string {
  return project.startsWith('prod') ? `${path}?build=prod` : path;
}

function watchConsole(page: Page): string[] {
  const errors: string[] = [];

  page.on('console', (message: ConsoleMessage) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  page.on('pageerror', (error) => errors.push(error.message));

  return errors;
}

const TAKEN = 'This metric already has a rule';

/** Longer than the in-memory store takes to answer (`services/alerts.memory.ts`). */
const STORE_SETTLES_MS = 1000;

/** Opens the alerts screen and waits for the one rule the store starts with. */
async function openAlerts(page: Page, project: string): Promise<void> {
  await page.goto(appUrl(project, '/alerts'));
  await expect(page.locator('[data-rule]')).toHaveCount(1);
}

const message = (page: Page, field: string) => page.locator(`[data-message="${field}"]`);

async function fillIn(page: Page, metric: string, above: string, below: string): Promise<void> {
  await page.getByLabel('Metric').selectOption(metric);
  await page.getByLabel('Alarm at or above').fill(above);
  await page.getByLabel('Clear under').fill(below);
}

test('the dashboard links to the alert rules', async ({ page }, testInfo) => {
  const errors = watchConsole(page);

  await page.goto(appUrl(testInfo.project.name));
  await page.getByRole('link', { name: 'Alerts' }).click();

  await expect(page.locator('[data-module="alerts"]')).toBeVisible();
  await expect(page.locator('[data-rule]')).toContainText('latency');

  expect(errors).toEqual([]);
});

test('a message waits for its own field, and a submit shows the rest', async ({
  page,
}, testInfo) => {
  const errors = watchConsole(page);

  await openAlerts(page, testInfo.project.name);
  await page.getByLabel('Alarm at or above').fill('ninety');

  await expect(message(page, 'above')).toHaveText('Enter a number');
  await expect(message(page, 'metric')).toBeHidden();

  await page.getByRole('button', { name: 'Add rule' }).click();

  await expect(message(page, 'metric')).toHaveText('Choose a metric');
  await expect(message(page, 'below')).toHaveText('Enter a number');
  await expect(page.locator('[data-rule]'), 'nothing was sent').toHaveCount(1);

  await page.getByLabel('Alarm at or above').fill('90');

  await expect(message(page, 'above')).toBeHidden();

  expect(errors).toEqual([]);
});

test('a kept rule is listed and the form empties', async ({ page }, testInfo) => {
  const errors = watchConsole(page);

  await openAlerts(page, testInfo.project.name);
  await fillIn(page, 'queue', '90', '60');
  await page.getByRole('button', { name: 'Add rule' }).click();

  await expect(page.getByRole('button', { name: 'Saving…' })).toBeDisabled();
  await expect(page.locator('[data-rule]')).toHaveCount(2);
  await expect(page.locator('[data-rule]').last()).toContainText('alarm at 90, clear under 60');

  await expect(page.getByLabel('Metric')).toHaveValue('');
  await expect(page.getByLabel('Alarm at or above')).toHaveValue('');
  await expect(message(page, 'above'), 'a fresh form shows nothing').toBeHidden();

  expect(errors).toEqual([]);
});

test("the server's refusal stays under its field until that field changes", async ({
  page,
}, testInfo) => {
  const errors = watchConsole(page);

  await openAlerts(page, testInfo.project.name);
  await fillIn(page, 'latency', '900', '800');
  await page.getByRole('button', { name: 'Add rule' }).click();

  await expect(message(page, 'metric')).toHaveText(TAKEN);
  await expect(page.getByLabel('Alarm at or above'), 'what was typed is kept').toHaveValue('900');

  await page.getByLabel('Clear under').fill('700');

  await expect(message(page, 'metric'), 'another field changing keeps it').toHaveText(TAKEN);

  await page.getByLabel('Metric').selectOption('queue');

  await expect(message(page, 'metric')).toBeHidden();

  expect(errors).toEqual([]);
});

test('two submits in one frame send one rule', async ({ page }, testInfo) => {
  const errors = watchConsole(page);

  // The store answers after a delay, and a second send would queue behind the
  // first: only a clock the test owns can say "both would have answered by now".
  await page.clock.install();
  await page.goto(appUrl(testInfo.project.name, '/alerts'));
  await page.clock.runFor(STORE_SETTLES_MS);
  await expect(page.locator('[data-rule]')).toHaveCount(1);
  await fillIn(page, 'queue', '90', '60');

  // Both before the browser paints, so the disabled button cannot be what stops the second.
  await page.locator('form').evaluate((form: HTMLFormElement) => {
    form.requestSubmit();
    form.requestSubmit();
  });

  await page.clock.runFor(STORE_SETTLES_MS * 2);

  await expect(page.locator('[data-rule]')).toHaveCount(2);
  // A second send would have been refused as a duplicate, and its refusal would land here.
  await expect(message(page, 'metric'), 'the second submit sent nothing').toBeHidden();

  expect(errors).toEqual([]);
});
