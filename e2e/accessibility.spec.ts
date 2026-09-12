/**
 * Every route must pass axe, in the palette and appearance it was built with.
 *
 * Running per matrix entry rather than once is the point: a token pair that
 * clears AA on a light surface can fail on a sunken dark one, and only rendering
 * that combination can tell. It is also how this suite found the defect recorded
 * below.
 */
import AxeBuilder from '@axe-core/playwright';
import { test, expect, open } from './fixtures.js';

/**
 * Palettes whose ACCENT fails WCAG AA contrast, verified by axe on real pages.
 *
 * This is an upstream dt-ui defect, not a storefront one: the same markup passes
 * on `indigo` and `ember` and fails on `jade`, in both React and Vue. dt-ui ships
 * 24 palettes and its own axe suite never varies the palette, so 23 of them have
 * never been contrast-tested.
 *
 * Recorded rather than ignored, and deliberately narrow. Contrast violations
 * from a palette on this list are reported and tolerated; a contrast violation
 * from a palette NOT on this list fails, and so does any violation of any other
 * kind. The list is the thing that must shrink.
 */
const PALETTES_WITH_KNOWN_CONTRAST_DEFECTS = new Set(['jade']);

const ROUTES = ['/', '/category', '/cart'];

function summarise(violations: { id: string; impact?: string | null | undefined; help: string; nodes: { target: unknown[] }[] }[]) {
  return violations.map(
    (violation) =>
      `${violation.id} (${violation.impact}): ${violation.help}\n    ` +
      violation.nodes
        .slice(0, 4)
        .map((node) => node.target.join(' '))
        .join('\n    '),
  );
}

async function audit(page: import('@playwright/test').Page) {
  return new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
}

/**
 * Split what axe found into what this project owns and what it inherits.
 *
 * Anything that is not the known palette-contrast defect is a real failure here,
 * including a contrast failure on a palette that was previously fine.
 */
function partition(
  violations: Awaited<ReturnType<typeof audit>>['violations'],
  palette: string,
) {
  const tolerated = PALETTES_WITH_KNOWN_CONTRAST_DEFECTS.has(palette);
  const ours = violations.filter((v) => !(tolerated && v.id === 'color-contrast'));
  const inherited = violations.filter((v) => tolerated && v.id === 'color-contrast');
  return { ours, inherited };
}

for (const route of ROUTES) {
  test(`axe is clean on ${route}`, async ({ page, project }) => {
    await open(page, project.baseURL, route);
    await page.locator('main').waitFor({ state: 'visible' }).catch(() => undefined);
    // dt-ui's overlay components animate in; scanning mid-animation measures a
    // state no shopper ever sees.
    await page.waitForTimeout(500);

    const { ours, inherited } = partition((await audit(page)).violations, project.palette);

    if (inherited.length > 0) {
      // Visible in the run, so the known defect cannot quietly become permanent.
      test.info().annotations.push({
        type: 'known dt-ui palette defect',
        description: `${project.palette}: ${summarise(inherited).join(' | ')}`,
      });
    }

    const found = summarise(ours);
    expect(found, `${project.id} ${route}\n${found.join('\n')}`).toEqual([]);
  });
}

test('the product page passes axe with its option matrix rendered', async ({ page, project }) => {
  await open(page, project.baseURL);
  const href = await page
    .locator('[data-testid="home-products"] a[href^="/product/"]')
    .first()
    .getAttribute('href');
  await open(page, project.baseURL, href!);
  await page.locator('[data-testid="pdp-add-to-cart"]').waitFor();

  const { ours } = partition((await audit(page)).violations, project.palette);
  const found = summarise(ours);
  expect(found, found.join('\n')).toEqual([]);
});

/**
 * The storefront's own markup must be accessible regardless of palette.
 *
 * Contrast aside, these are the failures a template author causes: an image
 * without alt text, a control without a name, a heading level skipped. Asserting
 * them separately means a palette defect can never mask one.
 */
test('no structural accessibility failures, whatever the palette', async ({ page, project }) => {
  await open(page, project.baseURL);
  const structural = (await audit(page)).violations.filter((v) => v.id !== 'color-contrast');
  const found = summarise(structural);
  expect(found, `${project.id}\n${found.join('\n')}`).toEqual([]);
});
