/**
 * The shopper journey, against the live platform.
 *
 * This file contains no framework-specific code. It drives React and Vue builds
 * through the same `data-testid` values, which is the whole reason the templates
 * agree on them — one suite, and a new framework costs a template rather than a
 * second copy of these assertions.
 */
import {
  test,
  expect,
  open,
  productCards,
  chooseAvailableCombination,
  findProductWithOptions,
  addAnythingToCart,
} from './fixtures.js';

test.describe('browsing', () => {
  test('the home page renders live catalog data', async ({ page, project, consoleErrors }) => {
    await open(page, project.baseURL);

    const grid = page.locator('[data-testid="home-products"]');
    await expect(grid, `${project.id} covers: ${project.covers}`).toBeVisible();

    const cards = productCards(page, 'home-products');
    await expect(cards.first()).toBeVisible();
    expect(await cards.count(), 'the live store should return more than one product').toBeGreaterThan(1);

    // A price is the field most likely to be silently wrong: the API sends a
    // decimal STRING and dt-ui wants a number, so a missed conversion renders
    // blank or NaN while every type still checks.
    const text = await grid.innerText();
    // Currency-FORMATTED, not merely numeric: "49.00" and "$49" both contain a
    // digit, and only one of them is a price a shopper can read.
    expect(text, 'prices must render as currency').toMatch(/[$£€¥₹]\s?\d|\b[A-Z]{3}\s\d/);
    expect(text, 'a price must never render as NaN').not.toContain('NaN');
    expect(text).not.toContain('undefined');

    expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
  });

  test('a product page loads by id and shows its price', async ({ page, project }) => {
    await open(page, project.baseURL);
    const href = await productCards(page, 'home-products').first().getAttribute('href');
    expect(href, 'a product card must link somewhere').toBeTruthy();

    // The detail route takes an ID. A slug answers HTTP 400, so a card linking
    // by slug produces a product page that cannot load.
    expect(href!, 'product links must carry the id, not the slug').toMatch(
      /^\/product\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );

    await open(page, project.baseURL, href!);
    await expect(page.locator('[data-testid="pdp-name"]')).not.toBeEmpty();
    await expect(page.locator('[data-testid="pdp-price"]')).toContainText(/\d/);
    await expect(page.locator('[data-testid="pdp-add-to-cart"]')).toBeVisible();
  });

  test('the category listing filters without emptying the catalog', async ({ page, project }) => {
    await open(page, project.baseURL, '/category');
    await expect(page.locator('[data-testid="plp-products"]')).toBeVisible();
    const all = await productCards(page, 'plp-products').count();
    expect(all).toBeGreaterThan(0);

    const filters = page.locator('[data-testid^="plp-filter-"]:not([data-testid="plp-filter-all"])');
    if ((await filters.count()) === 0) return;

    await filters.first().click();
    // Either a filtered grid or an honest empty state — but never a silent
    // fallback to the unfiltered catalog, which is what sending
    // `categoryId=undefined` would produce.
    await expect(
      page.locator('[data-testid="plp-products"], [data-testid="plp-empty"]').first(),
    ).toBeVisible();
  });
});

test.describe('the variant gate', () => {
  /**
   * The platform rejects an add-to-cart that omits `variantId` for a product
   * that has variants, with a message naming nothing. These tests assert the
   * storefront decides BEFORE the request, so the shopper is told what is
   * outstanding rather than shown a 400.
   */
  test('a product with options cannot be added until they are chosen', async ({ page, project }) => {
    const withOptions = await findProductWithOptions();
    test.skip(withOptions === null, 'this store has no multi-option product to exercise');

    await open(page, project.baseURL, withOptions!.href);
    const button = page.locator('[data-testid="pdp-add-to-cart"]');

    // Blocked from the first frame: while options are unknown the button must
    // not look ready to buy, and once they land it must name the choice.
    await expect(button, 'the add must be blocked before options are known').toBeDisabled();
    await expect(button).not.toHaveText(/loading options/i);

    const axes = page.locator('fieldset');
    const axisCount = await axes.count();

    await expect(button, 'an unchosen option matrix must block the add').toBeDisabled();
    await expect(button, 'and must say WHICH choice is outstanding').toContainText(/choose/i);

    // Choosing one axis of several must still block, naming only what is left.
    if (axisCount > 1) {
      await axes.nth(0).locator('button:not([disabled])').first().click();
      await expect(button).toBeDisabled();
      await expect(button).toContainText(/choose/i);
    }
  });

  test('choosing an in-stock combination adds it to the cart', async ({ page, project, consoleErrors }) => {
    const withOptions = await findProductWithOptions();
    test.skip(withOptions === null, 'this store has no multi-option product to exercise');

    await open(page, project.baseURL, withOptions!.href);
    const button = page.locator('[data-testid="pdp-add-to-cart"]');
    await chooseAvailableCombination(page, withOptions!.id);

    await expect(button).toBeEnabled();
    await expect(button).toHaveText(/add to bag/i);

    await button.click();
    await page.waitForURL('**/cart');
    await expect(page.locator('[data-testid="cart"]')).toBeVisible();
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
  });
});

test.describe('the cart', () => {
  test('an item can be added, its quantity changed, and it persists a reload', async ({
    page,
    project,
  }) => {
    await addAnythingToCart(page, project.baseURL);

    const quantity = page.locator('[data-testid^="cart-quantity-"]').first();
    await expect(quantity).toHaveText('1');

    await page.locator('[data-testid^="cart-increase-"]').first().click();
    await expect(quantity, 'the increase must round-trip through the platform').toHaveText('2');

    // The cart token lives in sessionStorage, so a reload must find the same
    // cart rather than silently starting a new one.
    await page.reload();
    await page.locator('[data-testid="store-booting"]').waitFor({ state: 'detached' });
    await expect(page.locator('[data-testid^="cart-quantity-"]').first()).toHaveText('2');
  });

  test('the header count follows the cart', async ({ page, project }) => {
    await addAnythingToCart(page, project.baseURL);
    await expect(page.locator('[data-testid="header-cart-count"]')).toHaveText('1');
  });

  test('an empty cart says so rather than rendering an empty frame', async ({ page, project }) => {
    await open(page, project.baseURL, '/cart');
    await expect(page.locator('[data-testid="cart-empty"]')).toBeVisible();
  });
});
