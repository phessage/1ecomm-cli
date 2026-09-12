/**
 * The bridge between a Playwright project and the real storefront behind it.
 *
 * Playwright's `project.name` is the matrix entry's id, so every spec can ask
 * "which build am I driving?" and report failures in terms a human can act on.
 */
import { test as base, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { MANIFEST_PATH, type BuiltProject, type Manifest } from './global-setup.js';
import { STORE_ID, BOOTSTRAP_URL } from './matrix.js';

function manifest(): Manifest {
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as Manifest;
}

export const test = base.extend<{ project: BuiltProject; consoleErrors: string[] }>({
  project: async ({}, use, testInfo) => {
    const found = manifest().projects.find((p) => p.id === testInfo.project.name);
    if (!found) throw new Error(`No built project for "${testInfo.project.name}".`);
    await use(found);
  },

  /**
   * Console and page errors, collected for the whole test.
   *
   * A storefront that renders correctly while throwing in the console is a
   * storefront with a bug that has not surfaced yet. Specs assert this is empty.
   */
  consoleErrors: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    });
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    await use(errors);
  },
});

export { expect };

/**
 * Open a route and wait for the store to finish bootstrapping.
 *
 * Every route is behind one bootstrap call, so a spec that starts asserting
 * immediately races it. Waiting for the boot placeholder to GO is the honest
 * signal — and if the store failed, this surfaces that instead of timing out on
 * a selector that was never going to appear.
 */
export async function open(page: Page, baseURL: string, path = '/'): Promise<void> {
  await page.goto(`${baseURL}${path}`);
  await page.locator('[data-testid="store-booting"]').waitFor({ state: 'detached', timeout: 30_000 });
  const unavailable = page.locator('[data-testid="store-unavailable"]');
  if (await unavailable.count()) {
    throw new Error(`The storefront failed to bootstrap:\n${await page.locator('body').innerText()}`);
  }
}

/** Product-card links on a listing, excluding the section's "view all". */
export function productCards(page: Page, container: string) {
  return page.locator(`[data-testid="${container}"] a[href^="/product/"]`);
}

// ---------------------------------------------------------------------------
// Platform helpers, shared by every spec.
//
// These talk to the API directly. That is deliberate: choosing the product under
// test by what the platform says it is makes the run deterministic, and it turns
// "the UI disagrees with the API" into a failure rather than a silent skip.

export interface ApiVariant {
  id: string;
  available: boolean;
  selectedOptions: Record<string, string>;
}

let cachedConfig: { apiUrl: string; apiVersion: string; publishableKey: string } | null = null;

/** The store's public runtime config, fetched once per worker. */
export async function storeConfig() {
  if (cachedConfig) return cachedConfig;
  const res = await fetch(`${BOOTSTRAP_URL}/v1/headless/stores/${STORE_ID}/config`);
  if (!res.ok) throw new Error(`Store bootstrap failed with HTTP ${res.status}`);
  const body = (await res.json()) as { data: NonNullable<typeof cachedConfig> };
  cachedConfig = body.data;
  return cachedConfig;
}

export async function fetchVariants(productId: string): Promise<ApiVariant[]> {
  const { apiUrl, apiVersion, publishableKey } = await storeConfig();
  const res = await fetch(`${apiUrl}/${apiVersion}/headless/products/${productId}/variants`, {
    headers: { 'x-publishable-key': publishableKey },
  });
  if (!res.ok) throw new Error(`Variant read failed with HTTP ${res.status}`);
  const body = (await res.json()) as { data: ApiVariant[] };
  return body.data ?? [];
}

export async function listProducts(limit = 8): Promise<{ id: string }[]> {
  const { apiUrl, apiVersion, publishableKey } = await storeConfig();
  const res = await fetch(`${apiUrl}/${apiVersion}/headless/products?limit=${limit}`, {
    headers: { 'x-publishable-key': publishableKey },
  });
  if (!res.ok) throw new Error(`Catalog read failed with HTTP ${res.status}`);
  const body = (await res.json()) as { data: { id: string }[] };
  return body.data ?? [];
}

/** The product id embedded in a /product/<id> href. */
export function idFromHref(href: string): string {
  return href.slice(href.lastIndexOf('/') + 1);
}

/**
 * A product whose variants span at least one option axis, or null.
 *
 * Resolved through the API rather than by walking the rendered grid. Reading
 * hrefs out of the DOM was both slow and racy: one `evaluateAll` can catch a
 * partially rendered list, and a short list makes the search find nothing, which
 * reads as "this store has no such product" rather than "the test looked early".
 */
export async function findProductWithOptions(): Promise<{ href: string; id: string } | null> {
  for (const product of await listProducts()) {
    const variants = await fetchVariants(product.id);
    const axes = new Set(variants.flatMap((v) => Object.keys(v.selectedOptions ?? {})));
    if (axes.size > 0) return { href: `/product/${product.id}`, id: product.id };
  }
  return null;
}

/** A product that can be bought with no choices at all, or null. */
export async function findSimpleProduct(): Promise<{ href: string; id: string } | null> {
  for (const product of await listProducts()) {
    const variants = await fetchVariants(product.id);
    const axes = new Set(variants.flatMap((v) => Object.keys(v.selectedOptions ?? {})));
    if (axes.size === 0 && (variants.length === 0 || variants.some((v) => v.available))) {
      return { href: `/product/${product.id}`, id: product.id };
    }
  }
  return null;
}

/**
 * Drive the option matrix to a combination the PLATFORM says is in stock.
 *
 * Throws rather than returning false, because the reason matters: "no stock",
 * "the page rendered no options the API says exist" and "the button never
 * enabled" are three different findings, and a boolean loses all of them.
 */
export async function chooseAvailableCombination(page: Page, productId: string): Promise<void> {
  const button = page.locator('[data-testid="pdp-add-to-cart"]');

  // Wait out the variant load before deciding anything. Counting fieldsets
  // first would read zero while the options are still in flight, and "no
  // options" and "options not known yet" lead to opposite conclusions.
  await expect(button).not.toHaveText(/loading options/i);

  const variants = await fetchVariants(productId);
  const available = variants.filter((variant) => variant.available);
  const apiAxes = new Set(variants.flatMap((v) => Object.keys(v.selectedOptions ?? {})));

  if (variants.length > 0 && available.length === 0) {
    throw new Error(
      `The platform reports no in-stock variant for ${productId} (${variants.length} variants).`,
    );
  }

  const axes = await page.locator('fieldset').count();
  if (axes === 0) {
    if (apiAxes.size > 0) {
      throw new Error(
        `The page rendered no option axes, but the API reports ${apiAxes.size} ` +
          `(${[...apiAxes].join(', ')}) for ${productId}. Button reads "${await button.innerText()}".`,
      );
    }
    await expect(button).toBeEnabled();
    return;
  }

  // Try each in-stock variant in turn. The first is usually fine, but a
  // combination can sell out between the read and the click, and failing the
  // whole test on that would be failing on inventory rather than on the code.
  let lastError: unknown;
  for (const variant of available.slice(0, 3)) {
    try {
      for (const [key, value] of Object.entries(variant.selectedOptions ?? {})) {
        const axis = key.includes('.') ? key.slice(key.lastIndexOf('.') + 1) : key;
        const option = page.locator(
          `[data-testid="pdp-option-${axis.toLowerCase()}-${value.toLowerCase()}"]`,
        );
        await option.waitFor({ timeout: 10_000 });
        await option.click();
      }
      await expect(button).toBeEnabled({ timeout: 10_000 });
      return;
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    `Could not reach an enabled add button for ${productId}. ` +
      `Button reads "${await button.innerText()}". Last error: ${String(lastError)}`,
  );
}

/** Put one item in the cart, choosing options where the product needs them. */
export async function addAnythingToCart(page: Page, baseURL: string): Promise<void> {
  const target = (await findSimpleProduct()) ?? (await findProductWithOptions());
  if (!target) throw new Error('No product in this store can be added to a cart.');

  await open(page, baseURL, target.href);
  await page.locator('[data-testid="pdp-add-to-cart"]').waitFor();
  await chooseAvailableCombination(page, target.id);
  await page.locator('[data-testid="pdp-add-to-cart"]').click();
  await page.waitForURL('**/cart');
  await page.locator('[data-testid="cart"]').waitFor();
}

/**
 * The store's live capability list.
 *
 * Read from the platform on every call rather than baked into the matrix: a
 * capability can be revoked while the suite is running, and a test that asserts
 * against a stale list fails on the wrong thing.
 */
export async function capabilities(): Promise<string[]> {
  const res = await fetch(`${BOOTSTRAP_URL}/v1/headless/stores/${STORE_ID}/config`);
  if (!res.ok) throw new Error(`Store bootstrap failed with HTTP ${res.status}`);
  const body = (await res.json()) as { data: { capabilities?: string[] } };
  return body.data.capabilities ?? [];
}
