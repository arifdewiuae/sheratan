// Style scoping in a real browser (SPEC §9a). This is the only spec that runs
// on all three engines, because §9a is the one mechanism with no fallback
// path: an app whose modules style each other is broken, and nothing logs it.
//
// It came out of a measurement, not a hunch. Gecko keys a scoping root on the
// attribute *name*, so `@scope ([data-module="a"])` and
// `@scope ([data-module="b"])` collapse into one scope and the first sheet
// wins both — but only when the two modules are siblings, which examples/hello
// happens not to have. The root is a class now, and this spec is what keeps it
// one.

import { expect, test, type Page } from '@playwright/test';

const FIXTURE = '/e2e/fixtures/styling.html';

/** What styling.css's `base` layer paints, and what nothing should end up. */
const BASE = 'rgb(1, 1, 1)';

const ALPHA = 'rgb(10, 10, 10)';
const BETA = 'rgb(20, 20, 20)';

/** `--fixture-token`, declared on `:root` in the `tokens` layer. */
const TOKEN = 'rgb(40, 40, 40)';

function row(page: Page, module: string): ReturnType<Page['locator']> {
  return page.locator(`[data-row="${module}"]`);
}

const colourOf = async (page: Page, module: string): Promise<string> =>
  row(page, module).evaluate((element) => globalThis.getComputedStyle(element).color);

test.beforeEach(async ({ page }) => {
  await page.goto(FIXTURE);
});

test('a module sheet reaches its own rows through the import', async ({ page }) => {
  await expect(row(page, 'alpha')).toBeVisible();

  // Also the layer assertion: styling.css's `base` rule is the more specific
  // of the two, so anything other than ALPHA means layer order was not applied
  // across the `@import`.
  expect(await colourOf(page, 'alpha')).toBe(ALPHA);
});

test('a sibling module is not styled by its neighbour', async ({ page }) => {
  // The one that fails in Gecko when the scoping root is an attribute value.
  expect(await colourOf(page, 'beta')).toBe(BETA);
  expect(await colourOf(page, 'beta')).not.toBe(ALPHA);
});

test('the lower boundary stops a parent module at a nested one', async ({ page }) => {
  const decoration = await row(page, 'gamma').evaluate(
    (element) => globalThis.getComputedStyle(element).textDecorationLine,
  );

  // `underline` is alpha's, and gamma is inside alpha. Only the `to (…)`
  // boundary keeps it out; no other rule in the fixture could.
  expect(decoration).toBe('none');
});

test('tokens inherit into a scoped sheet across the boundary', async ({ page }) => {
  // gamma's own colour is `var(--fixture-token)`, declared on `:root` two
  // module boundaries up. This is the single channel §9a gives global design.
  expect(await colourOf(page, 'gamma')).toBe(TOKEN);
  expect(await colourOf(page, 'gamma')).not.toBe(BASE);
});
