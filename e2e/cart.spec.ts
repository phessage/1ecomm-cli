/**
 * The cart, beyond adding one thing.
 *
 * Every mutation here goes through the live platform. None is retried: adding
 * an item is not replay-safe, so a failure must surface to the shopper rather
 * than silently doubling a line.
 */
import {
  test,
  expect,
  open,
  addAnythingToCart,
  findSimpleProduct,
  findProductWithOptions,
  chooseAvailableCombination,
  capabilities,
} from './fixtures.js';

test('removing the last line returns the empty state', async ({ page, project }) => {
  await addAnythingToCart(page, project.baseURL);
  await expect(page.locator('[data-testid="cart"]')).toBeVisible();

  await page.locator('[data-testid^="cart-remove-"]').first().click();
  await expect(page.locator('[data-testid="cart-empty"]')).toBeVisible();
  await expect(page.locator('[data-testid="header-cart-count"]')).toHaveCount(0);
});

test('decreasing to zero removes the line rather than storing a zero quantity', async ({
  page,
  project,
}) => {
  await addAnythingToCart(page, project.baseURL);
  await page.locator('[data-testid^="cart-decrease-"]').first().click();
  await expect(page.locator('[data-testid="cart-empty"]')).toBeVisible();
});

test('two different products become two lines', async ({ page, project }) => {
  const simple = await findSimpleProduct();
  const withOptions = await findProductWithOptions();
  test.skip(!simple || !withOptions, 'this store has fewer than two distinct products');

  for (const target of [simple!, withOptions!]) {
    await open(page, project.baseURL, target.href);
    await page.locator('[data-testid="pdp-add-to-cart"]').waitFor();
    await chooseAvailableCombination(page, target.id);
    await page.locator('[data-testid="pdp-add-to-cart"]').click();
    await page.waitForURL('**/cart');
  }

  await expect(page.locator('[data-testid^="cart-quantity-"]')).toHaveCount(2);
  await expect(page.locator('[data-testid="header-cart-count"]')).toHaveText('2');
});

test('the same variant twice becomes one line of two', async ({ page, project }) => {
  const target = (await findSimpleProduct()) ?? (await findProductWithOptions());
  test.skip(target === null, 'this store has nothing buyable');

  for (let i = 0; i < 2; i++) {
    await open(page, project.baseURL, target!.href);
    await page.locator('[data-testid="pdp-add-to-cart"]').waitFor();
    await chooseAvailableCombination(page, target!.id);
    await page.locator('[data-testid="pdp-add-to-cart"]').click();
    await page.waitForURL('**/cart');
  }

  // Merged, not duplicated: the platform keys a line on product + variant.
  await expect(page.locator('[data-testid^="cart-quantity-"]')).toHaveCount(1);
  await expect(page.locator('[data-testid^="cart-quantity-"]').first()).toHaveText('2');
});

test('totals move with the cart and are never blank', async ({ page, project }) => {
  await addAnythingToCart(page, project.baseURL);
  const summary = page.locator('[data-testid="cart"]');

  const before = await summary.innerText();
  expect(before, 'the summary must show currency').toMatch(/[$£€¥₹]\s?\d|\b[A-Z]{3}\s\d/);
  expect(before).not.toContain('NaN');

  await page.locator('[data-testid^="cart-increase-"]').first().click();
  await expect(page.locator('[data-testid^="cart-quantity-"]').first()).toHaveText('2');

  const after = await summary.innerText();
  expect(after, 'doubling the quantity must change the total').not.toEqual(before);
  expect(after).not.toContain('NaN');
});

test('the estimate caveat is shown while tax is an estimate', async ({ page, project }) => {
  // Saying "tax is an estimate" is a correctness claim, not decoration: the
  // platform reports taxIsEstimate and the shopper is entitled to know.
  await addAnythingToCart(page, project.baseURL);
  await expect(page.getByText(/tax is an estimate/i)).toBeVisible();
});

test('a cart survives a reload but does not leak into a fresh session', async ({
  page,
  project,
  browser,
}) => {
  await addAnythingToCart(page, project.baseURL);
  await page.reload();
  await page.locator('[data-testid="store-booting"]').waitFor({ state: 'detached' });
  await expect(page.locator('[data-testid="cart"]')).toBeVisible();

  // A different browser context is a different shopper. Seeing the first
  // shopper's bag would mean the cart token escaped its session.
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await open(otherPage, project.baseURL, '/cart');
  await expect(otherPage.locator('[data-testid="cart-empty"]')).toBeVisible();
  await other.close();
});

test('the checkout link reflects what the store can do', async ({ page, project }) => {
  const caps = await capabilities();
  await addAnythingToCart(page, project.baseURL);

  if (caps.includes('checkout-preparation')) {
    await expect(page.locator('[data-testid="cart-checkout-link"]')).toBeVisible();
  } else {
    await expect(page.locator('[data-testid="cart-checkout-unavailable"]')).toBeVisible();
  }
});

test('no inert quantity control is rendered', async ({ page, project }) => {
  /**
   * Regression for a defect found by screenshotting the cart.
   *
   * dt-order-summary's `editable` mode renders its own per-line quantity
   * <select> which emits nothing and issues no request — verified in a browser,
   * where changing it left the cart untouched. It is switched off here, so the
   * page shows exactly one set of quantity controls and that set works.
   *
   * If dt-ui gains a working quantity output, this test is what says so.
   */
  await addAnythingToCart(page, project.baseURL);
  await expect(
    page.locator('[data-testid^="dt-order-summary-quantity-"]'),
    'dt-ui\'s inert quantity select must not be rendered',
  ).toHaveCount(0);

  // And exactly one working control set remains.
  await expect(page.locator('[data-testid^="cart-increase-"]')).toHaveCount(1);
  await expect(page.locator('[data-testid^="cart-remove-"]')).toHaveCount(1);
});
