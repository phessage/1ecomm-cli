/**
 * Routes must follow the store's capabilities.
 *
 * A catalog-only store scaffolded with a checkout route gets a page that is
 * reachable and always fails, which is worse than no page. These tests read the
 * store's live capability list and assert the generated project agrees with it.
 */
import { test, expect, open, addAnythingToCart, capabilities } from './fixtures.js';

test('the checkout link appears only when the store can prepare a checkout', async ({ page, project }) => {
  const caps = await capabilities();
  // An empty cart shows the empty state, so put something in it first.
  await addAnythingToCart(page, project.baseURL);

  if (caps.includes('checkout-preparation')) {
    await expect(page.locator('[data-testid="cart-checkout-link"]')).toBeVisible();
  } else {
    await expect(page.locator('[data-testid="cart-checkout-unavailable"]')).toBeVisible();
  }
});

test('order lookup is absent when the store cannot place orders', async ({ page, project }) => {
  const caps = await capabilities();
  test.skip(caps.includes('orders'), 'this store CAN place orders, so the route should exist');

  await open(page, project.baseURL, '/orders');
  // The CLI omitted the route entirely, so the router falls through.
  await expect(page.locator('body')).toContainText(/does not exist/i);
});

test('checkout refuses to place an order the store cannot place', async ({ page, project }) => {
  const caps = await capabilities();
  test.skip(!caps.includes('checkout-preparation'), 'no checkout route was scaffolded');
  test.skip(caps.includes('orders'), 'this store can place orders; that path needs a real order test');

  // No conditional skip here: a test that opts out when the first product needs
  // a choice would opt out forever on a catalog like this one.
  await addAnythingToCart(page, project.baseURL);
  await page.locator('[data-testid="cart-checkout-link"]').click();
  await page.waitForURL('**/checkout');

  await expect(page.locator('[data-testid="checkout-place-order"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="checkout-cannot-place"]')).toBeVisible();
});
