/**
 * The palette and appearance a developer chose must be what the browser paints.
 *
 * dt-ui's two axes are data attributes on <html>, so theming is an attribute
 * change rather than a build. That claim is cheap to make and easy to get
 * wrong — a token that resolves to nothing renders as transparent, which looks
 * deliberate.
 */
import { test, expect, open } from './fixtures.js';

test('the chosen palette and appearance reach the document', async ({ page, project }) => {
  await open(page, project.baseURL);

  const root = page.locator('html');
  await expect(root, 'the palette must be the one the CLI was given').toHaveAttribute(
    'data-dt-palette',
    project.palette,
  );
  await expect(root).toHaveAttribute('data-dt-theme', project.appearance);
});

test('dt-ui tokens resolve to real colours rather than nothing', async ({ page, project }) => {
  await open(page, project.baseURL);

  const tokens = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return {
      surface: style.getPropertyValue('--color-dt-surface').trim(),
      fg: style.getPropertyValue('--color-dt-fg').trim(),
      accent: style.getPropertyValue('--color-dt-accent').trim(),
      bodyBackground: getComputedStyle(document.body).backgroundColor,
    };
  });

  for (const [name, value] of Object.entries(tokens)) {
    expect(value, `--color-dt-${name} must resolve to something`).not.toBe('');
  }
  // A transparent body means the stylesheet did not load, which otherwise looks
  // like a deliberate design.
  expect(tokens.bodyBackground).not.toBe('rgba(0, 0, 0, 0)');
});

/**
 * Computed colours come back in the colour space they were declared in, and
 * Tailwind v4 declares oklch. Parsing only `rgb(...)` would fail on a page that
 * is painted perfectly — so this reads the channels through the browser, which
 * already knows how to convert whatever it was given.
 */
async function luminanceOf(page: import('@playwright/test').Page, selector: string): Promise<number> {
  return page.evaluate((sel) => {
    const node = sel === 'body' ? document.body : document.querySelector(sel);
    if (!node) throw new Error(`No element for ${sel}`);
    const declared = getComputedStyle(node).backgroundColor;

    // Round-trip through a canvas: it accepts any CSS colour and hands back
    // sRGB bytes, so the test does not need a colour-space implementation.
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d')!;
    context.fillStyle = declared;
    context.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
    if (a === 0) return -1;
    return (r! * 0.299 + g! * 0.587 + b! * 0.114) / 255;
  }, selector);
}

test('the accent is actually painted, not merely declared', async ({ page, project }) => {
  await open(page, project.baseURL);
  const cta = page.locator('[data-testid="hero-shop-cta"]');
  await expect(cta).toBeVisible();

  const background = await cta.evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(background, 'the accent button must have a real background').not.toBe('rgba(0, 0, 0, 0)');
  expect(background, 'and must resolve to a colour, not an unresolved var()').not.toContain('var(');

  const luminance = await luminanceOf(page, '[data-testid="hero-shop-cta"]');
  expect(luminance, 'a transparent accent means the palette never loaded').toBeGreaterThanOrEqual(0);
});

test('dark and light differ where the matrix covers both', async ({ page, project }) => {
  test.skip(project.appearance === 'system', 'system follows the runner, so it proves nothing here');
  await open(page, project.baseURL);

  const luminance = await luminanceOf(page, 'body');
  expect(luminance, 'a transparent body means the stylesheet never loaded').toBeGreaterThanOrEqual(0);

  if (project.appearance === 'dark') {
    expect(luminance, 'a dark storefront must have a dark body').toBeLessThan(0.5);
  } else {
    expect(luminance, 'a light storefront must have a light body').toBeGreaterThan(0.5);
  }
});
