/**
 * What the storefront does when the platform does not cooperate.
 *
 * The rule these enforce is "fail closed, and say so". A shop that quietly
 * renders sample products when the API is down is worse than one that reports
 * being unavailable, because nobody finds out until an order does not arrive.
 */
import { test, expect, open, findSimpleProduct, findProductWithOptions, chooseAvailableCombination } from './fixtures.js';
import { STORE_ID, BOOTSTRAP_URL } from './matrix.js';

test('a failed bootstrap reports unavailable rather than rendering a shop', async ({ page, project }) => {
  await page.route('**/v1/headless/stores/**/config', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/problem+json',
      body: JSON.stringify({ detail: 'Injected outage', code: 'HEADLESS_HTTP_503' }),
    }),
  );

  await page.goto(project.baseURL);
  await expect(page.locator('[data-testid="store-unavailable"]')).toBeVisible();
  await expect(page.locator('body')).toContainText('Injected outage');
  // The thing that must NOT happen.
  await expect(page.locator('[data-testid="home-products"]')).toHaveCount(0);
});

test('a failed catalog read offers a retry rather than an empty grid', async ({ page, project }) => {
  let fail = true;
  await page.route('**/v1/headless/products?*', async (route) => {
    if (fail) {
      fail = false;
      return route.fulfill({
        status: 500,
        contentType: 'application/problem+json',
        body: JSON.stringify({ detail: 'Injected catalog failure' }),
      });
    }
    return route.fallback();
  });

  await open(page, project.baseURL);
  const note = page.locator('[data-testid="error-note"]');
  await expect(note, 'a failed read must be distinguishable from an empty catalog').toBeVisible();
  await expect(note).toContainText('Injected catalog failure');

  // And the retry must actually re-request, not just clear the message.
  await page.locator('[data-testid="error-retry"]').click();
  await expect(page.locator('[data-testid="home-products"]')).toBeVisible();
});

test('a rejected add-to-cart surfaces the platform message', async ({ page, project }) => {
  // Pick a product the UI can actually reach an enabled button on, rather than
  // skipping when the first one happens to need a choice.
  const target = (await findSimpleProduct()) ?? (await findProductWithOptions());
  expect(target, 'this store must have something buyable').not.toBeNull();
  await open(page, project.baseURL, target!.href);

  const button = page.locator('[data-testid="pdp-add-to-cart"]');
  await button.waitFor();
  await chooseAvailableCombination(page, target!.id);

  // Injected only once the button is genuinely ready, so the failure under test
  // is the platform refusing a well-formed add — not the page being caught
  // mid-load with nothing chosen.
  await page.route('**/carts/current/items', (route) =>
    route.fulfill({
      status: 400,
      contentType: 'application/problem+json',
      body: JSON.stringify({ detail: 'Injected cart refusal', requestId: 'req-test-1' }),
    }),
  );

  await button.click();
  const error = page.locator('[data-testid="pdp-add-error"]');
  await expect(error).toBeVisible();
  await expect(error).toContainText('Injected cart refusal');
  // The request ID is what lets a developer find it in the logs.
  await expect(error).toContainText('req-test-1');
});

test('an expired cart token is discarded rather than looping', async ({ page, project }) => {
  await open(page, project.baseURL, '/cart');
  await page.evaluate(() => sessionStorage.setItem('1ecomm.cartToken', 'hc_definitely-not-valid'));

  await page.route('**/carts/current', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/problem+json',
      body: JSON.stringify({ detail: 'Cart token is no longer valid' }),
    }),
  );

  await page.reload();
  await page.locator('[data-testid="store-booting"]').waitFor({ state: 'detached' });

  // A revoked token is a normal end of life, not an error the shopper should see.
  await expect(page.locator('[data-testid="cart-empty"]')).toBeVisible();
  await expect(page.locator('[data-testid="store-unavailable"]')).toHaveCount(0);
});

test('the add button stays blocked until variants are known', async ({ page, project }) => {
  /**
   * Regression for a defect this suite found. While the variant list was in
   * flight it was empty, an empty list means "nothing to choose", and so the
   * button rendered as a working "Add to bag" for a product that required a
   * variant. Clicking it in that window posted no variantId and the platform
   * answered HTTP 400 with a message naming nothing.
   *
   * The variants response is held open here so that window is wide enough to
   * observe deliberately, instead of being a race that fails one run in five.
   */
  const productId = await firstProductWithOptions();
  test.skip(productId === null, 'this store has no multi-option product');

  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/products/*/variants', async (route) => {
    await held;
    return route.fallback();
  });

  await page.goto(`${project.baseURL}/product/${productId}`);
  await page.locator('[data-testid="store-booting"]').waitFor({ state: 'detached' });

  const button = page.locator('[data-testid="pdp-add-to-cart"]');
  await button.waitFor();
  await expect(button, 'a product whose options are unknown must not look ready to buy').toBeDisabled();

  release();
  // Once they land, the real gate takes over and names the outstanding choice.
  await expect(button).toContainText(/choose/i);
  await expect(button).toBeDisabled();
});

async function firstProductWithOptions(): Promise<string | null> {
  const config = await (await fetch(`${BOOTSTRAP_URL}/v1/headless/stores/${STORE_ID}/config`)).json();
  const { apiUrl, apiVersion, publishableKey } = config.data;
  const list = await (
    await fetch(`${apiUrl}/${apiVersion}/headless/products?limit=8`, {
      headers: { 'x-publishable-key': publishableKey },
    })
  ).json();
  for (const product of list.data ?? []) {
    const variants = await (
      await fetch(`${apiUrl}/${apiVersion}/headless/products/${product.id}/variants`, {
        headers: { 'x-publishable-key': publishableKey },
      })
    ).json();
    const axes = new Set((variants.data ?? []).flatMap((v: { selectedOptions?: Record<string, string> }) => Object.keys(v.selectedOptions ?? {})));
    if (axes.size > 0) return product.id;
  }
  return null;
}
