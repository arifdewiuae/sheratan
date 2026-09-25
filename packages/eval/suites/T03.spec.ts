// T03 — Create order form with validation.
//
// The five assertions EVAL-TASKS §3 lists for this task, and nothing else.
//
// The prompt names four hooks — `order-form`, `error-<field>`, `submit` and
// `created` — and gives the three fields no hook at all. It names them:
// "Customer", "Quantity" and "Note". So the fields are found by their
// accessible name, which is what the prompt actually specifies and the one
// way to find them that does not assume markup the task never asked for.
//
// A field error is read as text, not as presence. An app may render the
// element always and fill it, or render it only when there is something to
// say; both do what the prompt asks, and only the text tells them apart.

import {
  CUSTOMERS,
  FIRST_NEW_ORDER_ID,
  NOTE_MAX,
  QUANTITY_MAX,
  QUANTITY_MIN,
} from '../evalkit/src/data.ts';
import { APP, expect, hook, Route, test, type Inspect } from './harness.ts';
import type { Page } from '@playwright/test';

/** §3: "Invalid quantity (0, 1001, 2.5, empty)". */
const INVALID = [String(QUANTITY_MIN - 1), String(QUANTITY_MAX + 1), '2.5', ''];

/** A quantity inside the bounds the prompt states. */
const VALID_QUANTITY = 5;

/** §3: "Server 422 on quantity". */
const UNPROCESSABLE = 422;

/** What the server says about the quantity when it refuses the draft. */
const SERVER_SAYS = 'That quantity is not available this week.';

/** Long enough to look at the button while the request is still in flight. */
const SLOW_MS = 800;

/** §3: "exactly one POST", however many times submit is pressed. */
const ONE = 1;

const FORM = hook('order-form');
const SUBMIT = hook('submit');
const CREATED = hook('created');
const QUANTITY_ERROR = hook('error-quantity');

/** The first customer the server offers, which is the one every test picks. */
const CUSTOMER = CUSTOMERS[0];

/** A note well inside the limit the prompt states. */
const NOTE = 'Leave at the side gate.';

/** Fills the form the way the prompt describes it, by field name. */
async function fillForm(page: Page, quantity: string): Promise<void> {
  await expect(page.locator(FORM)).toBeVisible();

  await page.getByLabel('Customer').selectOption(String(CUSTOMER?.id ?? 0));
  await page.getByLabel('Quantity').fill(quantity);
  await page.getByLabel('Note').fill(NOTE);
}

/** What the page is saying about a field right now, or nothing at all. */
async function messageFor(page: Page, field: string): Promise<string> {
  const locator = page.locator(hook(`error-${field}`));

  if ((await locator.count()) === 0) return '';

  return (await locator.first().innerText()).trim();
}

/** One attempt: typed, submitted, complained about, and never sent. */
async function refusedWithoutAsking(page: Page, inspect: Inspect, quantity: string): Promise<void> {
  await fillForm(page, quantity);
  await page.locator(SUBMIT).click();

  await expect
    .poll(async () => messageFor(page, 'quantity'), {
      message: `nothing was said about the quantity "${quantity}"`,
    })
    .not.toBe('');

  expect((await inspect.requests())[Route.CreateOrder]).toBe(0);
}

test('a quantity outside the bounds is refused without asking the server', async ({
  page,
  control: _fresh,
  inspect,
}) => {
  await page.goto(APP);

  for (const quantity of INVALID) {
    // eslint-disable-next-line no-await-in-loop -- each attempt is judged before the next is typed
    await refusedWithoutAsking(page, inspect, quantity);
  }
});

test('a valid draft is sent once, with the submit button held shut', async ({
  page,
  control,
  inspect,
}) => {
  await control.latency(Route.CreateOrder, SLOW_MS);
  await page.goto(APP);
  await fillForm(page, String(VALID_QUANTITY));

  await page.locator(SUBMIT).click();

  await expect(page.locator(SUBMIT)).toBeDisabled();
  await expect(page.locator(CREATED)).toBeVisible();

  expect(await inspect.drafts()).toEqual([
    { customerId: CUSTOMER?.id, quantity: VALID_QUANTITY, note: NOTE },
  ]);
});

test('pressing submit twice still sends one order', async ({ page, control, inspect }) => {
  await control.latency(Route.CreateOrder, SLOW_MS);
  await page.goto(APP);
  await fillForm(page, String(VALID_QUANTITY));

  await page.locator(SUBMIT).dblclick();
  await expect(page.locator(CREATED)).toBeVisible();

  expect((await inspect.drafts()).length).toBe(ONE);
});

test('a refusal from the server is shown on the field it names', async ({ page, control }) => {
  await control.fail(Route.CreateOrder, {
    status: UNPROCESSABLE,
    errors: { quantity: SERVER_SAYS },
  });

  await page.goto(APP);
  await fillForm(page, String(VALID_QUANTITY));

  await page.locator(SUBMIT).click();

  await expect(page.locator(QUANTITY_ERROR)).toHaveText(SERVER_SAYS);

  // "other fields keep their values": a refusal is not a reason to make
  // somebody type the whole form again.
  await expect(page.getByLabel('Note')).toHaveValue(NOTE);
  await expect(page.getByLabel('Customer')).toHaveValue(String(CUSTOMER?.id ?? 0));
});

test('a created order clears the form and shows its id', async ({ page, control: _fresh }) => {
  await page.goto(APP);
  await fillForm(page, String(VALID_QUANTITY));

  await page.locator(SUBMIT).click();

  await expect(page.locator(CREATED)).toContainText(String(FIRST_NEW_ORDER_ID));
  await expect(page.getByLabel('Quantity')).toHaveValue('');
  await expect(page.getByLabel('Note')).toHaveValue('');

  // The note limit is part of the prompt, and a form that "clears" by leaving
  // the longest field alone has not cleared.
  expect(NOTE.length).toBeLessThan(NOTE_MAX);
});
