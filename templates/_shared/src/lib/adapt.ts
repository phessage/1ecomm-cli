/**
 * The seam between the commerce API and the dt-ui component contracts.
 *
 * These two models do not agree, and the disagreements are quiet ones:
 *
 *   API                              dt-ui
 *   ---------------------------      ------------------------------
 *   product.name                     DtProduct.name          (same)
 *   product.imageUrl: string|null    DtProduct.image: {src, alt}
 *   price.amount: "49.00" (string)   DtMoney.amount: 49 (number)
 *   (no href — routing is ours)      DtProduct.href          (required)
 *
 * The price one is the dangerous one. Passing the string straight through gives
 * `Intl.NumberFormat` a value it will not format, and the storefront renders
 * blank prices while every type checks. So the conversion lives here, once,
 * with the parse failure made explicit rather than becoming NaN downstream.
 */
import type { DtImage, DtMoney, DtProduct } from '@1ecomm/dt-ui-core';
import type { Money, Product, Variant } from './commerce';

/** A product image the shopper's browser can actually decode, or a placeholder. */
const PLACEHOLDER_IMAGE =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">' +
      '<rect width="400" height="400" fill="#e5e7eb"/></svg>',
  );

export function toMoney(price: Money | null | undefined): DtMoney {
  if (!price) return { amount: 0, currency: 'USD' };
  const amount = Number.parseFloat(price.amount);
  return {
    // A malformed amount becomes 0 rather than NaN: a zero price is visibly
    // wrong and gets reported, where NaN renders as an empty string and ships.
    amount: Number.isFinite(amount) ? amount : 0,
    currency: price.currency,
  };
}

function toImage(url: string | null, alt: string): DtImage {
  return { src: url ?? PLACEHOLDER_IMAGE, alt };
}

/**
 * Map a catalog product onto the card contract.
 *
 * `alt` is the product name rather than an empty string. dt-ui requires the
 * caller to decide, and for a product card the name is the decision: a shopper
 * using a screen reader needs to know which product the image belongs to.
 */
export function toDtProduct(product: Product): DtProduct {
  return {
    id: product.id,
    name: product.name,
    // The ID, not the slug. `GET /v1/headless/products/{id}` answers 400 for a
    // slug, so a pretty URL here produces a product page that cannot load.
    href: `/product/${product.id}`,
    image: toImage(product.imageUrl, product.name),
    price: toMoney(product.price),
    ...(product.description ? { description: product.description } : {}),
    inStock: product.available,
    ...(product.available ? {} : { availability: 'Out of stock' }),
  };
}

export function toDtProducts(products: Product[]): DtProduct[] {
  return products.map(toDtProduct);
}

/**
 * Group variants into the option axes a shopper chooses along.
 *
 * The API returns a flat list whose `selectedOptions` are namespaced
 * (`apparel.size`, `product.color`). A product page needs them as axes —
 * Size: S, M, L — so this inverts the list, preserving first-seen order because
 * the server returns a meaningful one and sorting would scramble S/M/L/XL.
 */
export interface OptionAxis {
  /** Raw key, e.g. `apparel.size`. */
  key: string;
  /** Human label, e.g. `Size`. */
  label: string;
  values: string[];
}

export function toOptionAxes(variants: Variant[]): OptionAxis[] {
  const axes = new Map<string, Set<string>>();
  for (const variant of variants) {
    for (const [key, value] of Object.entries(variant.selectedOptions ?? {})) {
      const values = axes.get(key) ?? new Set<string>();
      values.add(value);
      axes.set(key, values);
    }
  }
  return [...axes].map(([key, values]) => ({
    key,
    label: humanizeOptionKey(key),
    values: [...values],
  }));
}

function humanizeOptionKey(key: string): string {
  const last = key.includes('.') ? key.slice(key.lastIndexOf('.') + 1) : key;
  return last
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (ch) => ch.toUpperCase());
}

/**
 * The variant the shopper has settled on, if any.
 *
 * There are three shapes in the wild and only the middle one is obvious:
 *
 *   - no variants at all: the product is bought by ID alone;
 *   - variants that carry NO options (typically exactly one): there is nothing
 *     to choose, so the sole sellable variant IS the choice;
 *   - variants across option axes: the shopper picks one value per axis.
 *
 * The middle case is the one that bites. Requiring a choice that has no options
 * to offer leaves the product permanently unbuyable, with an add button reading
 * "that combination is unavailable" and no combination to pick.
 */
export function findVariant(
  variants: Variant[],
  chosen: Record<string, string>,
): Variant | undefined {
  if (variants.length === 0) return undefined;

  if (toOptionAxes(variants).length === 0) {
    return variants.find((variant) => variant.available) ?? variants[0];
  }

  const keys = Object.keys(chosen);
  if (keys.length === 0) return undefined;
  return variants.find((variant) =>
    keys.every((key) => variant.selectedOptions?.[key] === chosen[key]),
  );
}

/**
 * Why the add-to-cart button cannot be pressed yet, or undefined when it can.
 *
 * This exists because the platform answers an add with HTTP 400 when a product
 * has variants and none was named. That is correct of the platform and useless
 * to a shopper, so the storefront decides *before* the request and says which
 * choice is outstanding.
 */
export function addToCartBlocker(
  variants: Variant[],
  chosen: Record<string, string>,
  /**
   * Whether the variant list has actually been loaded.
   *
   * This argument exists because of a real defect: while variants were still in
   * flight the list was empty, an empty list means "no options to choose", and
   * so the button rendered as a working "Add to bag" for a product that in fact
   * required a variant. A shopper quick enough to press it got HTTP 400 and a
   * message naming nothing. "Not yet known" and "known to be none" are
   * different answers and must not share a representation.
   */
  variantsLoaded = true,
): string | undefined {
  if (!variantsLoaded) return 'Loading options';
  if (variants.length === 0) return undefined;

  const axes = toOptionAxes(variants);
  const missing = axes.filter((axis) => !chosen[axis.key]);
  if (missing.length > 0) {
    return `Choose ${missing.map((axis) => axis.label.toLowerCase()).join(' and ')}`;
  }

  const variant = findVariant(variants, chosen);
  // With no axes there is nothing to have chosen wrongly, so the only honest
  // reason left is stock.
  if (!variant) return axes.length === 0 ? 'Out of stock' : 'That combination is unavailable';
  if (!variant.available) return 'Out of stock';
  return undefined;
}
