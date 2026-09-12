import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { money } from '@1ecomm/dt-ui-core';
import { useStore } from '../store';
import { useAsync } from '../lib/useAsync';
import { addToCartBlocker, findVariant, toMoney, toOptionAxes } from '../lib/adapt';
import { ErrorNote } from '../components/Shell';
import { CommerceError } from '../lib/commerce';

/**
 * The product page.
 *
 * The whole reason this route is hand-composed rather than a dt-ui component is
 * the option matrix. The platform rejects an add-to-cart that omits `variantId`
 * for a product that has variants — HTTP 400, "Cart mutation could not be
 * completed", which tells a shopper nothing. So the page resolves variants
 * first, makes the shopper choose, and only then enables the button.
 */
export function Product() {
  const { id = '' } = useParams();
  const { client, addToCart } = useStore();
  const navigate = useNavigate();

  const product = useAsync(() => client.getProduct(id), [client, id]);
  const productId = product.status === 'ready' ? product.value.id : '';
  const variants = useAsync(
    () => (productId ? client.listVariants(productId) : Promise.resolve([])),
    [client, productId],
  );

  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const variantList = variants.status === 'ready' ? variants.value : [];
  const axes = useMemo(() => toOptionAxes(variantList), [variantList]);
  const selected = findVariant(variantList, chosen);
  const blocker = addToCartBlocker(variantList, chosen);

  if (product.status === 'loading') {
    return <p className="py-24 text-center text-sm text-dt-fg-muted">Loading…</p>;
  }
  if (product.status === 'failed') {
    return <ErrorNote error={product.error} onRetry={product.reload} />;
  }

  const item = product.value;
  const price = selected ? toMoney(selected.price) : toMoney(item.price);

  async function onAdd() {
    if (blocker) return;
    setAdding(true);
    setAddError(null);
    try {
      await addToCart({
        productId: item.id,
        ...(selected ? { variantId: selected.id } : {}),
        quantity: 1,
      });
      navigate('/cart');
    } catch (error) {
      // Surface the platform's own words plus its request ID: a shopper can
      // quote it and a developer can find it in the logs.
      const commerce = error instanceof CommerceError ? error : undefined;
      setAddError(
        commerce
          ? `${commerce.message}${commerce.requestId ? ` (request ${commerce.requestId})` : ''}`
          : 'Could not add that to your bag.',
      );
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="grid gap-10 lg:grid-cols-2">
        <img
          src={item.imageUrl ?? ''}
          alt={item.name}
          data-testid="pdp-image"
          className="w-full rounded-dt-card bg-dt-surface-sunken object-cover"
        />

        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-dt-fg" data-testid="pdp-name">
            {item.name}
          </h1>
          <p className="mt-3 text-xl text-dt-fg" data-testid="pdp-price">
            {money(price)}
          </p>

          {item.description ? (
            <p className="mt-6 text-sm leading-6 text-dt-fg-muted" data-testid="pdp-description">
              {item.description}
            </p>
          ) : null}

          {axes.map((axis) => (
            <fieldset key={axis.key} className="mt-8">
              <legend className="text-sm font-medium text-dt-fg">{axis.label}</legend>
              <div className="mt-3 flex flex-wrap gap-2">
                {axis.values.map((value) => {
                  const isChosen = chosen[axis.key] === value;
                  // Grey out a value that cannot combine with what is already
                  // picked, rather than letting the shopper discover it at the
                  // add button.
                  const reachable = variantList.some(
                    (variant) =>
                      variant.selectedOptions?.[axis.key] === value &&
                      Object.entries(chosen).every(
                        ([k, v]) => k === axis.key || variant.selectedOptions?.[k] === v,
                      ),
                  );
                  return (
                    <button
                      key={value}
                      type="button"
                      disabled={!reachable}
                      data-testid={`pdp-option-${axis.label.toLowerCase()}-${value.toLowerCase()}`}
                      onClick={() => setChosen((prev) => ({ ...prev, [axis.key]: value }))}
                      className={[
                        'rounded-dt-control border px-3 py-2 text-sm transition-colors',
                        isChosen
                          ? 'border-dt-accent bg-dt-accent text-dt-fg-inverse'
                          : 'border-dt-border text-dt-fg hover:border-dt-border-strong',
                        reachable ? '' : 'cursor-not-allowed opacity-40',
                      ].join(' ')}
                    >
                      {value}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ))}

          <button
            type="button"
            onClick={() => void onAdd()}
            disabled={Boolean(blocker) || adding}
            data-testid="pdp-add-to-cart"
            className="mt-10 w-full rounded-dt-control bg-dt-accent px-6 py-3 text-sm font-medium text-dt-fg-inverse hover:bg-dt-accent-hover disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            {adding ? 'Adding…' : (blocker ?? 'Add to bag')}
          </button>

          {addError ? (
            <p className="mt-4 text-sm text-dt-danger" role="alert" data-testid="pdp-add-error">
              {addError}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
