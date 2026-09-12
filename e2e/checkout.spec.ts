/**
 * Checkout preparation, driven the way a shopper drives it.
 *
 * The platform owns every rule here — which countries need a state, which
 * payment methods can complete an order, what is still outstanding — and the
 * page renders the server's answer rather than re-implementing it. So these
 * tests assert that the page FOLLOWS the platform, not that it agrees with a
 * hard-coded expectation.
 */
import { test, expect, open, addAnythingToCart, capabilities } from './fixtures.js';

/**
 * Put an item in the bag and land on a checkout page that has finished loading.
 *
 * The page reads its state from the platform after mount, so arriving at the
 * URL is not the same as the form being ready. Asserting before that read lands
 * measures an empty form and calls it a missing country list.
 */
async function reachCheckout(page: import('@playwright/test').Page, baseURL: string) {
  await addAnythingToCart(page, baseURL);
  await page.locator('[data-testid="cart-checkout-link"]').click();
  await page.waitForURL('**/checkout');
  await expect(page.getByText(/loading checkout/i)).toHaveCount(0);
  await expect(page.locator('[data-testid="checkout-country"]')).toBeVisible();
  // The placeholder is always there; a real option means the platform answered.
  await expect(
    page.locator('[data-testid="checkout-country"] option:not([value=""])').first(),
  ).toBeAttached();
}

/** Country codes the form offers, in the order the platform sent them. */
async function offeredCountries(page: import('@playwright/test').Page): Promise<string[]> {
  return page
    .locator('[data-testid="checkout-country"] option')
    .evaluateAll((nodes) => nodes.map((n) => (n as HTMLOptionElement).value).filter(Boolean));
}

test.describe('reaching checkout', () => {
  test('an empty bag sends the shopper back to the catalog', async ({ page, project }) => {
    const caps = await capabilities();
    test.skip(!caps.includes('checkout-preparation'), 'no checkout route was scaffolded');

    await open(page, project.baseURL, '/checkout');
    await expect(page.getByText(/your bag is empty/i)).toBeVisible();
    // And offers a way out, rather than being a dead end.
    await expect(page.getByRole('link', { name: /find something/i })).toBeVisible();
  });

  test('the form renders the countries the platform supports', async ({ page, project }) => {
    const caps = await capabilities();
    test.skip(!caps.includes('checkout-preparation'), 'no checkout route was scaffolded');

    await reachCheckout(page, project.baseURL);

    await expect(page.locator('[data-testid="checkout-country"]')).toBeVisible();
    const codes = await offeredCountries(page);
    expect(codes.length, 'the country list must come from the platform').toBeGreaterThan(0);
  });
});

test.describe('the platform decides which fields are required', () => {
  test('choosing a country reveals the fields that country needs', async ({ page, project }) => {
    const caps = await capabilities();
    test.skip(!caps.includes('checkout-preparation'), 'no checkout route was scaffolded');

    await reachCheckout(page, project.baseURL);
    const country = page.locator('[data-testid="checkout-country"]');
    const codes = await offeredCountries(page);
    expect(codes.length).toBeGreaterThan(0);

    // Which fields a country needs is the platform's rule, reported on every
    // checkout read. The page must follow it rather than asking for the same
    // fields everywhere.
    let sawConditionalField = false;
    for (const code of codes.slice(0, 5)) {
      await country.selectOption(code);
      await expect(country).toHaveValue(code);
      const state = await page.locator('[data-testid="checkout-state"]').count();
      const postal = await page.locator('[data-testid="checkout-postal-code"]').count();
      if (state > 0 || postal > 0) sawConditionalField = true;
    }

    // If no country ever revealed one, the conditional rendering is dead code.
    expect(
      sawConditionalField,
      'no country required a state or postal code; the rule is not wired to the form',
    ).toBe(true);
  });

  test('saving details reports what is still outstanding', async ({ page, project }) => {
    const caps = await capabilities();
    test.skip(!caps.includes('checkout-preparation'), 'no checkout route was scaffolded');

    await reachCheckout(page, project.baseURL);

    await page.locator('[data-testid="checkout-email"]').fill('shopper@example.com');
    await page.locator('[data-testid="checkout-first-name"]').fill('Alex');
    await page.locator('[data-testid="checkout-last-name"]').fill('Shopper');
    await page.locator('[data-testid="checkout-line1"]').fill('1 Test Street');
    await page.locator('[data-testid="checkout-city"]').fill('Vancouver');

    const codes = await offeredCountries(page);
    await page.locator('[data-testid="checkout-country"]').selectOption(codes[0]!);

    for (const extra of ['checkout-state', 'checkout-postal-code']) {
      const field = page.locator(`[data-testid="${extra}"]`);
      if (await field.count()) await field.fill(extra.includes('state') ? 'BC' : 'V6B1A1');
    }

    await page.locator('[data-testid="checkout-save-details"]').click();

    // Either the platform accepts it and offers the next step, or it says what
    // is still missing. Both are answers; silence is not.
    await expect(
      page
        .locator(
          '[data-testid="checkout-missing"], [data-testid="checkout-cannot-place"], [data-testid="checkout-place-order"], [data-testid="checkout-error"]',
        )
        .first(),
    ).toBeVisible();
  });
});

test.describe('the order gate', () => {
  test('a store that cannot place orders offers no order button', async ({ page, project }) => {
    const caps = await capabilities();
    test.skip(!caps.includes('checkout-preparation'), 'no checkout route was scaffolded');
    test.skip(caps.includes('orders'), 'this store CAN place orders; that path needs a real order test');

    await reachCheckout(page, project.baseURL);

    await expect(page.locator('[data-testid="checkout-place-order"]')).toHaveCount(0);
    const reason = page.locator('[data-testid="checkout-cannot-place"]');
    await expect(reason).toBeVisible();
    // It must say WHY, not merely be absent.
    await expect(reason).toContainText(/cannot place orders|complete the details|hosted/i);
  });
});
