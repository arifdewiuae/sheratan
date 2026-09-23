// Routing in a real browser (SPEC §9b). Everything the router does is decided
// by the Navigation API, which happy-dom does not implement, so this is the
// only place interception, restoration and deep links are actually proved.

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

/**
 * Marks the document, so a later assertion can tell a client-side navigation
 * from a full page load: a real load throws the mark away with the document.
 */
async function markDocument(page: Page): Promise<void> {
  await page.evaluate(() => {
    (globalThis as unknown as { sheratanKeptDocument?: boolean }).sheratanKeptDocument = true;
  });
}

const documentKept = async (page: Page): Promise<boolean> =>
  page.evaluate(
    () =>
      (globalThis as unknown as { sheratanKeptDocument?: boolean }).sheratanKeptDocument === true,
  );

test('a link swaps the screen without loading a new document', async ({ page }, testInfo) => {
  const errors = watchConsole(page);

  await page.goto(appUrl(testInfo.project.name));
  await expect(page.locator('[data-module="dashboard"]')).toBeVisible();

  await markDocument(page);
  await page.getByRole('link', { name: 'Orders' }).click();

  await expect(page.locator('[data-screen="table"]')).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/orders');
  expect(await documentKept(page), 'the document survived, so nothing reloaded').toBe(true);

  expect(errors).toEqual([]);
});

test('the layout survives moving between the screens inside it', async ({ page }, testInfo) => {
  const errors = watchConsole(page);

  await page.goto(appUrl(testInfo.project.name, '/orders'));
  await expect(page.locator('[data-screen="table"]')).toBeVisible();

  // Mark the shell's own element. A rebuilt shell is a different element, and
  // the mark goes with the one it replaced — which is the whole claim nested
  // layouts make, and the only way to see it from outside.
  await page.evaluate(() => {
    document.querySelector('[data-module="orders"]')?.setAttribute('data-kept', 'yes');
  });

  await page.locator('[data-order="7"]').click();

  await expect(page.locator('[data-screen="detail"]')).toBeVisible();
  await expect(page.locator('[data-order-id]')).toHaveAttribute('data-order-id', '7');

  await expect(
    page.locator('[data-module="orders"][data-kept="yes"]'),
    'the shell was never unmounted',
  ).toBeVisible();

  expect(errors).toEqual([]);
});

test('one screen, new params: the detail updates without being rebuilt', async ({
  page,
}, testInfo) => {
  const errors = watchConsole(page);

  await page.goto(appUrl(testInfo.project.name, '/orders/7'));
  await expect(page.locator('[data-field="name"]')).toBeVisible();

  const first = await page.locator('[data-field="name"]').innerText();

  await page.evaluate(() => {
    globalThis.navigation.navigate('/orders/8');
  });

  await expect(page.locator('[data-order-id]')).toHaveAttribute('data-order-id', '8');
  await expect(page.locator('[data-field="name"]')).not.toHaveText(first);

  expect(errors).toEqual([]);
});

test('back and forward move between screens, and restore the scroll position', async ({
  page,
}, testInfo) => {
  const errors = watchConsole(page);

  await page.goto(appUrl(testInfo.project.name, '/orders'));
  await expect(page.locator('[data-screen="table"]')).toBeVisible();

  await page.evaluate(() => {
    globalThis.scrollTo(0, 400);
  });

  const left = await page.evaluate(() => Math.round(globalThis.scrollY));

  expect(left, 'the table is long enough to scroll, or this proves nothing').toBeGreaterThan(0);

  await page.locator('[data-order="7"]').click();
  await expect(page.locator('[data-screen="detail"]')).toBeVisible();

  await page.goBack();
  await expect(page.locator('[data-screen="table"]')).toBeVisible();

  // `intercept()` restores this itself: the router asks for neither
  // `scroll: 'manual'` nor a position of its own.
  await expect
    .poll(async () => page.evaluate(() => Math.round(globalThis.scrollY)), { timeout: 5000 })
    .toBe(left);

  await page.goForward();
  await expect(page.locator('[data-screen="detail"]')).toBeVisible();

  expect(errors).toEqual([]);
});

test('a deep link is a real URL: typed in, reloaded, and still the same screen', async ({
  page,
}, testInfo) => {
  const errors = watchConsole(page);

  await page.goto(appUrl(testInfo.project.name, '/orders/7'));

  await expect(page.locator('[data-screen="detail"]')).toBeVisible();
  await expect(page.locator('[data-order-id]')).toHaveAttribute('data-order-id', '7');

  await page.reload();

  await expect(page.locator('[data-screen="detail"]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('a URL no table claims is the app saying so, not the server', async ({ page }, testInfo) => {
  const errors = watchConsole(page);

  await page.goto(appUrl(testInfo.project.name, '/nothing/here'));

  await expect(page.locator('[data-screen="not-found"]')).toBeVisible();
  await expect(page.locator('[data-path]')).toHaveText('/nothing/here');

  expect(errors).toEqual([]);
});
