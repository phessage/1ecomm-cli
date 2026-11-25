/**
 * Catalog-titled acceptance for the scaffolded starters (functionality catalog,
 * domain developer-platform). Each test title starts with its catalog test id.
 *
 * Unlike journey.spec.ts / cart.spec.ts, these tests assert the NETWORK contract
 * as well as the rendered result: every rendered claim is compared with the
 * response the storefront actually received from /v1/headless/*. A store that
 * lacks what a case needs (categories with products, a multi-option product, two
 * buyable products) FAILS with the reason — it is never skipped.
 *
 * Source: templates/_shared/src/lib/commerce.ts (GET /products[?categoryId], GET
 * /products/:id/variants, POST /carts, GET /carts/current, POST|PATCH|DELETE
 * /carts/current/items[/:itemId]; x-cart-token header), templates/react|vue routes
 * (home-products, plp-products, plp-filter-<slug>, pdp-*, cart-*, header-cart-count).
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page, Response } from '@playwright/test';
import {
  test,
  expect,
  open,
  productCards,
  chooseAvailableCombination,
  findProductWithOptions,
  fetchVariants,
  storeConfig,
  idFromHref,
} from './fixtures.js';
import { STORE_ID } from './matrix.js';

interface ApiProduct {
  id: string;
  name: string;
  price: { amount: string; currency: string };
}

const pathOf = (url: string) => new URL(url).pathname;
const isProductList = (r: Response) =>
  r.request().method() === 'GET' && /\/v1\/headless\/products$/.test(pathOf(r.url()));
const isItemMutation = (r: Response) =>
  ['PATCH', 'DELETE'].includes(r.request().method()) && /\/v1\/headless\/carts\/current\/items\/[^/]+$/.test(pathOf(r.url()));

async function apiGet<T>(path: string): Promise<T> {
  const { apiUrl, apiVersion, publishableKey } = await storeConfig();
  const res = await fetch(`${apiUrl}/${apiVersion}/headless${path}`, { headers: { 'x-publishable-key': publishableKey } });
  if (!res.ok) throw new Error(`GET ${path} failed with HTTP ${res.status}`);
  return ((await res.json()) as { data: T }).data;
}

/** Two distinct products the platform says can be bought (in stock, or with an in-stock variant). */
async function twoBuyableProducts(): Promise<[{ id: string; href: string }, { id: string; href: string }]> {
  const found: Array<{ id: string; href: string }> = [];
  for (const product of await apiGet<ApiProduct[]>('/products?limit=20')) {
    const variants = await fetchVariants(product.id);
    if (variants.length === 0 || variants.some((v) => v.available)) found.push({ id: product.id, href: `/product/${product.id}` });
    if (found.length === 2) return [found[0]!, found[1]!];
  }
  throw new Error(`Store ${STORE_ID} has fewer than two buyable products; the cart case needs two.`);
}

async function addFromPdp(page: Page, baseURL: string, target: { id: string; href: string }): Promise<Response> {
  await open(page, baseURL, target.href);
  await page.locator('[data-testid="pdp-add-to-cart"]').waitFor();
  await chooseAvailableCombination(page, target.id);
  const [added] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST' && /\/v1\/headless\/carts\/current\/items$/.test(pathOf(r.url()))),
    page.locator('[data-testid="pdp-add-to-cart"]').click(),
  ]);
  await page.waitForURL('**/cart');
  return added;
}

test('developer-platform.headless-api.bootstrap::cli-scaffold-builds — the scaffolded and built starter is configured with the store id it was created for @release', async ({ page, project }) => {
  const config = JSON.parse(await readFile(join(project.directory, 'headless-config.json'), 'utf8')) as { storeId: string };
  expect(config.storeId, 'headless-config.json carries the --store-id').toBe(STORE_ID);
  await expect(readFile(join(project.directory, 'dist', 'index.html'), 'utf8')).resolves.toContain('<');

  const [bootstrap] = await Promise.all([
    page.waitForResponse((r) => pathOf(r.url()) === `/v1/headless/stores/${STORE_ID}/config`),
    page.goto(project.baseURL),
  ]);
  expect(bootstrap.status()).toBe(200);
  expect(((await bootstrap.json()) as { data: { storeId: string } }).data.storeId).toBe(STORE_ID);
  await page.locator('[data-testid="store-booting"]').waitFor({ state: 'detached', timeout: 30_000 });
  await expect(page.locator('[data-testid="store-unavailable"]')).toHaveCount(0);
});

test('developer-platform.headless-api.catalog::starter-renders-live-catalog — home, product, category filter and the variant gate render what the catalog API returned @smoke @release', async ({ page, project, consoleErrors }) => {
  // Home: the rendered cards are the API's products, with the API's names and prices.
  const listed = page.waitForResponse(isProductList);
  await open(page, project.baseURL);
  const response = await listed;
  expect(response.status()).toBe(200);
  const items = ((await response.json()) as { data: ApiProduct[] }).data;
  const cards = productCards(page, 'home-products');
  await expect(cards.first()).toBeVisible();
  const count = await cards.count();
  expect(count, 'more than one product card renders').toBeGreaterThan(1);
  const byId = new Map(items.map((item) => [item.id, item]));
  for (let i = 0; i < Math.min(count, 4); i += 1) {
    const card = cards.nth(i);
    const id = idFromHref((await card.getAttribute('href'))!);
    const item = byId.get(id);
    expect(item, `card ${i} (${id}) is a product the API returned`).toBeTruthy();
    const text = (await card.innerText()).replace(/,/g, '');
    expect(text, `card ${i} shows the API name`).toContain(item!.name);
    expect(text, `card ${i} shows the API price ${item!.price.amount}`).toContain(Number(item!.price.amount).toFixed(2));
  }

  // Product page by id, with a numeric price.
  const firstHref = (await cards.first().getAttribute('href'))!;
  expect(firstHref).toMatch(/^\/product\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  await open(page, project.baseURL, firstHref);
  await expect(page.locator('[data-testid="pdp-name"]')).toHaveText(byId.get(idFromHref(firstHref))!.name);
  await expect(page.locator('[data-testid="pdp-price"]')).toContainText(/\d/);

  // Category filter: pick a category the API says has products; filtering must not empty the grid.
  const categories = await apiGet<Array<{ id: string; slug: string }>>('/products/categories');
  let target: { id: string; slug: string } | undefined;
  for (const category of categories) {
    if ((await apiGet<ApiProduct[]>(`/products?limit=1&categoryId=${encodeURIComponent(category.id)}`)).length > 0) {
      target = category;
      break;
    }
  }
  expect(target, `store ${STORE_ID} needs a category with products to exercise the filter`).toBeTruthy();
  await open(page, project.baseURL, '/category');
  await expect(productCards(page, 'plp-products').first()).toBeVisible();
  const [filtered] = await Promise.all([
    page.waitForResponse((r) => isProductList(r) && new URL(r.url()).searchParams.get('categoryId') === target!.id),
    page.locator(`[data-testid="plp-filter-${target!.slug}"]`).click(),
  ]);
  expect(filtered.status()).toBe(200);
  const filteredItems = ((await filtered.json()) as { data: ApiProduct[] }).data;
  expect(filteredItems.length).toBeGreaterThan(0);
  await expect(productCards(page, 'plp-products')).toHaveCount(filteredItems.length);

  // Variant gate: blocked with a "choose" message until an in-stock combination is chosen.
  const withOptions = await findProductWithOptions();
  expect(withOptions, `store ${STORE_ID} needs a multi-option product to exercise the variant gate`).not.toBeNull();
  await open(page, project.baseURL, withOptions!.href);
  const add = page.locator('[data-testid="pdp-add-to-cart"]');
  await expect(add).toBeDisabled();
  await expect(add).toContainText(/choose/i);
  await chooseAvailableCombination(page, withOptions!.id);
  await expect(add).toBeEnabled();

  expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
});

test('developer-platform.headless-api.cart::starter-cart-behaviour — lines are created, merged and removed through the cart API and persist only in their own session @release', async ({ page, project, browser }) => {
  const [first, second] = await twoBuyableProducts();

  // First add creates the cart (token returned once), then adds the line.
  const created = page.waitForResponse((r) => r.request().method() === 'POST' && /\/v1\/headless\/carts$/.test(pathOf(r.url())));
  const add1 = await addFromPdp(page, project.baseURL, first);
  const createdRes = await created;
  expect(createdRes.ok(), `POST /carts → ${createdRes.status()}`).toBe(true);
  expect(JSON.stringify(await createdRes.json())).toMatch(/hc_/);
  expect(add1.ok(), `POST items → ${add1.status()}`).toBe(true);
  const add2 = await addFromPdp(page, project.baseURL, second);
  expect(add2.ok()).toBe(true);
  expect(add2.request().headers()['x-cart-token'], 'the second add reuses the cart token').toBeTruthy();

  const quantities = page.locator('[data-testid^="cart-quantity-"]');
  await expect(quantities).toHaveCount(2);
  await expect(page.locator('[data-testid="header-cart-count"]')).toHaveText('2');

  // Reload: the same cart comes back from GET /carts/current.
  const [current] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'GET' && /\/v1\/headless\/carts\/current$/.test(pathOf(r.url()))),
    page.reload(),
  ]);
  expect(current.status()).toBe(200);
  const lines = ((await current.json()) as { data: { items: Array<{ id: string; productId: string; quantity: number }> } }).data.items;
  expect(lines.map((l) => l.productId).sort()).toEqual([first.id, second.id].sort());
  await expect(quantities).toHaveCount(2);

  // A fresh browser context is another shopper: empty cart.
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await open(otherPage, project.baseURL, '/cart');
  await expect(otherPage.locator('[data-testid="cart-empty"]')).toBeVisible();
  await other.close();

  // The same variant again merges into one line of 2, and the total moves.
  const summary = page.locator('[data-testid="cart"]');
  const before = await summary.innerText();
  await addFromPdp(page, project.baseURL, first);
  await expect(quantities).toHaveCount(2);
  const firstLine = lines.find((l) => l.productId === first.id)!;
  await expect(page.locator(`[data-testid="cart-quantity-${firstLine.id}"]`)).toHaveText('2');
  const after = await summary.innerText();
  expect(after).toMatch(/[$£€¥₹]\s?\d|\b[A-Z]{3}\s\d/);
  expect(after).not.toContain('NaN');
  expect(after, 'the total changes with the quantity').not.toEqual(before);

  // Decreasing every line to zero sends the line mutations and ends on the empty state.
  for (const line of [firstLine, firstLine, lines.find((l) => l.productId === second.id)!]) {
    const [mutation] = await Promise.all([
      page.waitForResponse(isItemMutation),
      page.locator(`[data-testid="cart-decrease-${line.id}"]`).click(),
    ]);
    expect(mutation.ok(), `${mutation.request().method()} item → ${mutation.status()}`).toBe(true);
    expect(pathOf(mutation.url())).toContain(line.id);
  }
  await expect(page.locator('[data-testid="cart-empty"]')).toBeVisible();
});
