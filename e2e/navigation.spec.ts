/**
 * Getting around: deep links, browser history, unknown routes, and a phone.
 *
 * These are the cases a single-page storefront gets wrong quietly. A deep link
 * that only works when you arrive from the home page is a link nobody can share;
 * a back button that does not restore the previous page is a shopper lost.
 */
import { test, expect, open, productCards, findSimpleProduct, capabilities } from './fixtures.js';

test.describe('deep links', () => {
  const paths = ['/', '/category', '/cart'];

  for (const path of paths) {
    test(`${path} loads directly, not only by navigation`, async ({ page, project }) => {
      await open(page, project.baseURL, path);
      await expect(page.locator('[data-testid="header-home-link"]')).toBeVisible();
      await expect(page.locator('[data-testid="store-unavailable"]')).toHaveCount(0);
    });
  }

  test('a product URL opens cold', async ({ page, project }) => {
    const target = await findSimpleProduct();
    test.skip(target === null, 'this store has no option-free product');
    await open(page, project.baseURL, target!.href);
    await expect(page.locator('[data-testid="pdp-name"]')).not.toBeEmpty();
  });

  test('a category URL opens cold and filters', async ({ page, project }) => {
    // Ask the platform whether this store has categories at all, rather than
    // counting rendered filters: counting before they render reads zero and
    // turns a real test into a skip that wins a race.
    const { storeConfig } = await import('./fixtures.js');
    const { apiUrl, apiVersion, publishableKey } = await storeConfig();
    const categories = (await (
      await fetch(`${apiUrl}/${apiVersion}/headless/products/categories`, {
        headers: { 'x-publishable-key': publishableKey },
      })
    ).json()) as { data?: { slug: string }[] };
    test.skip((categories.data ?? []).length === 0, 'this store genuinely has no categories');

    await open(page, project.baseURL, '/category');
    const filters = page.locator('[data-testid^="plp-filter-"]:not([data-testid="plp-filter-all"])');
    await expect(filters.first()).toBeVisible();

    const href = await filters.first().getAttribute('href');
    await open(page, project.baseURL, href!);
    await expect(
      page.locator('[data-testid="plp-products"], [data-testid="plp-empty"]').first(),
    ).toBeVisible();
  });
});

test.describe('unknown routes', () => {
  test('a route that does not exist says so and keeps the shell', async ({ page, project }) => {
    await open(page, project.baseURL, '/no-such-page');
    await expect(page.getByText(/does not exist/i)).toBeVisible();
    // The header must survive, or the shopper has no way back.
    await expect(page.locator('[data-testid="header-home-link"]')).toBeVisible();
  });

  test('a route the store cannot serve falls through rather than blanking', async ({
    page,
    project,
  }) => {
    const caps = await capabilities();
    test.skip(caps.includes('orders'), 'this store CAN place orders, so /orders exists');
    await open(page, project.baseURL, '/orders');
    await expect(page.getByText(/does not exist/i)).toBeVisible();
  });

  test('a product id that does not exist reports the failure, not a blank page', async ({
    page,
    project,
  }) => {
    await open(page, project.baseURL, '/product/00000000-0000-0000-0000-000000000000');
    await expect(page.locator('[data-testid="error-note"]')).toBeVisible();
    await expect(page.locator('[data-testid="error-retry"]')).toBeVisible();
  });
});

test.describe('browser history', () => {
  test('back returns to the listing from a product', async ({ page, project }) => {
    await open(page, project.baseURL);
    const href = await productCards(page, 'home-products').first().getAttribute('href');
    await page.locator(`a[href="${href}"]`).first().click();
    await page.waitForURL(`**${href}`);
    await expect(page.locator('[data-testid="pdp-name"]')).toBeVisible();

    await page.goBack();
    await expect(page.locator('[data-testid="home-products"]')).toBeVisible();

    await page.goForward();
    await expect(page.locator('[data-testid="pdp-name"]')).toBeVisible();
  });

  test('the header link returns home from anywhere', async ({ page, project }) => {
    await open(page, project.baseURL, '/cart');
    await page.locator('[data-testid="header-home-link"]').click();
    await expect(page.locator('[data-testid="home-products"]')).toBeVisible();
  });
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the compact navigation is reachable and the page does not scroll sideways', async ({
    page,
    project,
  }) => {
    await open(page, project.baseURL);

    // The wide nav hides below md; the compact one must take over, or a phone
    // has no navigation at all.
    await expect(page.getByRole('navigation', { name: /main, compact/i })).toBeVisible();
    await expect(page.locator('[data-testid="header-cart-link"]')).toBeVisible();

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflows, 'the page must not scroll horizontally on a phone').toBe(false);
  });

  test('a product page is usable at phone width', async ({ page, project }) => {
    const target = await findSimpleProduct();
    test.skip(target === null, 'this store has no option-free product');
    await open(page, project.baseURL, target!.href);

    const button = page.locator('[data-testid="pdp-add-to-cart"]');
    await expect(button).toBeVisible();

    // A control smaller than 44px is a control a thumb misses.
    const box = await button.boundingBox();
    expect(box!.height, 'the primary action must be a real touch target').toBeGreaterThanOrEqual(40);
  });
});

test.describe('keyboard', () => {
  test('the first tab reaches a real control, not a void', async ({ page, project }) => {
    await open(page, project.baseURL);
    await page.keyboard.press('Tab');

    const focused = await page.evaluate(() => {
      const el = document.activeElement;
      return el ? { tag: el.tagName, text: (el.textContent ?? '').trim().slice(0, 40) } : null;
    });
    expect(focused, 'tab must move focus somewhere').not.toBeNull();
    expect(['A', 'BUTTON', 'INPUT', 'SELECT']).toContain(focused!.tag);
  });

  test('the option matrix is operable by keyboard', async ({ page, project }) => {
    const { findProductWithOptions } = await import('./fixtures.js');
    const target = await findProductWithOptions();
    test.skip(target === null, 'this store has no multi-option product');

    await open(page, project.baseURL, target!.href);
    const option = page.locator('[data-testid^="pdp-option-"]:not([disabled])').first();
    await option.waitFor();
    await option.focus();
    await page.keyboard.press('Enter');

    // Pressing Enter on a focused option must select it, exactly as a click does.
    await expect(option).toHaveClass(/bg-dt-accent/);
  });
});
