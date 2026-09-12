/**
 * The adapter between the commerce API and the dt-ui contracts.
 *
 * This file is shipped verbatim into every generated project, so its rules are
 * the storefront's rules. Two of the cases below are regressions for defects
 * this work actually shipped and then found.
 *
 * It is tested here rather than only through the browser because the browser
 * cannot see some of it: `Intl.NumberFormat` coerces a numeric string, so a
 * price passed through unconverted RENDERS CORRECTLY and fails only later, in
 * arithmetic or in a consumer that does not coerce. A rendered-output test can
 * never catch that; a unit test can.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  addToCartBlocker,
  findVariant,
  toDtProduct,
  toMoney,
  toOptionAxes,
} from '../templates/_shared/src/lib/adapt.ts';

const product = {
  id: '0bc2bd0b-516c-445a-b895-5596c81965b1',
  slug: 'parkas-demo-product-sample',
  name: 'Parkas',
  description: 'Warm',
  imageUrl: 'https://cdn.example/parka.webp',
  price: { amount: '49.00', currency: 'USD' },
  available: true,
};

const variant = (id: string, options: Record<string, string>, available = true) => ({
  id,
  title: id,
  price: { amount: '49.00', currency: 'USD' },
  selectedOptions: options,
  available,
});

describe('money', () => {
  test('a decimal STRING becomes a number', () => {
    // The API sends "49.00"; DtMoney.amount is typed as a number. Passing the
    // string through type-checks nowhere and renders fine anyway, because Intl
    // coerces — which is exactly why this assertion is here.
    const result = toMoney({ amount: '49.00', currency: 'USD' });
    assert.equal(typeof result.amount, 'number');
    assert.equal(result.amount, 49);
    assert.equal(result.currency, 'USD');
  });

  test('a malformed amount becomes 0, never NaN', () => {
    // A zero price is visibly wrong and gets reported. NaN renders as an empty
    // string and ships.
    const result = toMoney({ amount: 'not-a-price', currency: 'USD' });
    assert.equal(result.amount, 0);
    assert.ok(!Number.isNaN(result.amount));
  });

  test('a missing price does not throw', () => {
    assert.deepEqual(toMoney(null), { amount: 0, currency: 'USD' });
  });
});

describe('product cards', () => {
  test('link by ID, never by slug', () => {
    // GET /v1/headless/products/{id} answers HTTP 400 for a slug, so a pretty
    // URL here produces a product page that cannot load.
    assert.equal(toDtProduct(product).href, `/product/${product.id}`);
  });

  test('the image alt is the product name, not empty', () => {
    assert.equal(toDtProduct(product).image.alt, 'Parkas');
  });

  test('a product with no image still gets a decodable src', () => {
    const card = toDtProduct({ ...product, imageUrl: null });
    assert.ok(card.image.src.length > 0);
  });

  test('an unavailable product says so', () => {
    const card = toDtProduct({ ...product, available: false });
    assert.equal(card.inStock, false);
    assert.equal(card.availability, 'Out of stock');
  });
});

describe('option axes', () => {
  test('namespaced keys become human labels, in server order', () => {
    const axes = toOptionAxes([
      variant('a', { 'apparel.size': 'S', 'product.color': 'Green' }),
      variant('b', { 'apparel.size': 'M', 'product.color': 'Black' }),
    ]);
    assert.deepEqual(
      axes.map((axis) => [axis.key, axis.label, axis.values]),
      [
        ['apparel.size', 'Size', ['S', 'M']],
        ['product.color', 'Color', ['Green', 'Black']],
      ],
    );
  });

  test('sizes keep the order the server sent, not alphabetical', () => {
    // Sorting would scramble S/M/L/XL into L/M/S/XL.
    const axes = toOptionAxes([
      variant('a', { 'apparel.size': 'S' }),
      variant('b', { 'apparel.size': 'M' }),
      variant('c', { 'apparel.size': 'L' }),
      variant('d', { 'apparel.size': 'XL' }),
    ]);
    assert.deepEqual(axes[0]?.values, ['S', 'M', 'L', 'XL']);
  });
});

describe('the add-to-cart gate', () => {
  const withAxes = [
    variant('green-s', { 'product.color': 'Green', 'apparel.size': 'S' }),
    variant('green-m', { 'product.color': 'Green', 'apparel.size': 'M' }, false),
  ];

  test('REGRESSION: blocked while the variants are still loading', () => {
    // The defect: an empty list meant "nothing to choose", so the button read a
    // working "Add to bag" for a product that required a variant. A shopper
    // quick enough to press it got HTTP 400 naming nothing.
    assert.equal(addToCartBlocker([], {}, false), 'Loading options');
    assert.equal(addToCartBlocker(withAxes, {}, false), 'Loading options');
  });

  test('a product with genuinely no variants is buyable', () => {
    assert.equal(addToCartBlocker([], {}, true), undefined);
  });

  test('REGRESSION: one variant carrying no options is buyable', () => {
    // The defect: this read as "that combination is unavailable", with no
    // combination to choose, leaving the product permanently unbuyable.
    const sole = [variant('only', {})];
    assert.equal(addToCartBlocker(sole, {}, true), undefined);
    assert.equal(findVariant(sole, {})?.id, 'only');
  });

  test('an unchosen matrix names every outstanding choice', () => {
    const blocker = addToCartBlocker(withAxes, {}, true);
    assert.match(blocker ?? '', /choose/i);
    assert.match(blocker ?? '', /color/i);
    assert.match(blocker ?? '', /size/i);
  });

  test('a partly chosen matrix names only what is left', () => {
    const blocker = addToCartBlocker(withAxes, { 'product.color': 'Green' }, true);
    assert.match(blocker ?? '', /size/i);
    assert.ok(!/color/i.test(blocker ?? ''), `should not still ask for colour: ${blocker}`);
  });

  test('an out-of-stock combination says so, not "unavailable"', () => {
    const blocker = addToCartBlocker(
      withAxes,
      { 'product.color': 'Green', 'apparel.size': 'M' },
      true,
    );
    assert.equal(blocker, 'Out of stock');
  });

  test('a combination that does not exist is named as such', () => {
    const blocker = addToCartBlocker(
      withAxes,
      { 'product.color': 'Green', 'apparel.size': 'XXL' },
      true,
    );
    assert.equal(blocker, 'That combination is unavailable');
  });

  test('a complete, in-stock choice clears the gate', () => {
    assert.equal(
      addToCartBlocker(withAxes, { 'product.color': 'Green', 'apparel.size': 'S' }, true),
      undefined,
    );
    assert.equal(
      findVariant(withAxes, { 'product.color': 'Green', 'apparel.size': 'S' })?.id,
      'green-s',
    );
  });
});
