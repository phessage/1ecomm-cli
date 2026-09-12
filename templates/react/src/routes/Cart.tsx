import { useState } from 'react';
import { Link } from 'react-router-dom';
import { DtEmptyState, DtOrderSummary } from '@1ecomm/dt-ui-react';
import type { DtCartLine, DtOrderTotals } from '@1ecomm/dt-ui-core';
import { useStore } from '../store';
import { toMoney } from '../lib/adapt';
import type { Cart as CartModel } from '../lib/commerce';

/**
 * dt-order-summary renders the lines and the totals, so the cart's job is the
 * mapping and the mutations. Note the totals it wants are DtMoney objects while
 * the API sends decimal strings, so every field goes through `toMoney` rather
 * than being handed over as-is.
 */
function toLines(cart: CartModel): DtCartLine[] {
  return cart.items.map((item) => ({
    id: item.id,
    name: item.name,
    href: `/product/${item.productId}`,
    image: { src: item.imageUrl ?? '', alt: item.name },
    price: toMoney(item.unitPrice),
    quantity: item.quantity,
  }));
}

function toTotals(cart: CartModel): DtOrderTotals {
  const currency = cart.currency;
  const at = (amount: string) => toMoney({ amount, currency });
  return {
    subtotal: at(cart.totals.subtotal),
    shipping: at(cart.totals.shipping),
    taxes: at(cart.totals.tax),
    total: at(cart.totals.total),
  };
}

export function Cart() {
  const { cart, client, updateItem, removeItem } = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function mutate(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (cause) {
      // Cart mutations are deliberately never retried: an add is not replay-safe,
      // so a failure is shown rather than silently repeated.
      setError(cause instanceof Error ? cause.message : 'That change did not go through.');
    } finally {
      setBusy(false);
    }
  }

  if (!cart || cart.items.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20" data-testid="cart-empty">
        <DtEmptyState
          template="simple"
          title="Your bag is empty"
          description="Once you add something it will show up here."
          icon="24/outline/shopping-bag"
          action={{ label: 'Start shopping', href: '/category' }}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8" data-testid="cart">
      <h1 className="text-2xl font-semibold tracking-tight text-dt-fg">Your bag</h1>

      <div className="mt-8" aria-busy={busy}>
        {/*
          `editable` is deliberately OFF. It renders dt-ui's own per-line
          quantity <select>, and that select emits nothing and issues no
          request — verified in a browser: changing it leaves the cart
          untouched. A control that looks like it worked and did not is worse
          than no control, so the quantity and remove actions below are the
          project's own, and they talk to the platform.
        */}
        <DtOrderSummary
          template="card"
          title="Order summary"
          lines={toLines(cart)}
          totals={toTotals(cart)}
        />
      </div>

      {/* The working controls. */}
      <ul className="mt-6 space-y-2">
        {cart.items.map((item) => (
          <li key={item.id} className="flex items-center justify-between gap-4 text-sm">
            <span className="truncate text-dt-fg-muted">{item.name}</span>
            <span className="flex items-center gap-2">
              <button
                type="button"
                disabled={busy}
                aria-label={`Decrease quantity of ${item.name}`}
                data-testid={`cart-decrease-${item.id}`}
                onClick={() => void mutate(() => updateItem(item.id, item.quantity - 1))}
                className="rounded-dt-control border border-dt-border px-2 py-1 disabled:opacity-40"
              >
                −
              </button>
              <span data-testid={`cart-quantity-${item.id}`} className="w-6 text-center text-dt-fg">
                {item.quantity}
              </span>
              <button
                type="button"
                disabled={busy}
                aria-label={`Increase quantity of ${item.name}`}
                data-testid={`cart-increase-${item.id}`}
                onClick={() => void mutate(() => updateItem(item.id, item.quantity + 1))}
                className="rounded-dt-control border border-dt-border px-2 py-1 disabled:opacity-40"
              >
                +
              </button>
              <button
                type="button"
                disabled={busy}
                aria-label={`Remove ${item.name}`}
                data-testid={`cart-remove-${item.id}`}
                onClick={() => void mutate(() => removeItem(item.id))}
                className="ml-2 rounded-dt-control px-2 py-1 text-dt-fg-muted hover:text-dt-danger disabled:opacity-40"
              >
                Remove
              </button>
            </span>
          </li>
        ))}
      </ul>

      {error ? (
        <p className="mt-4 text-sm text-dt-danger" role="alert" data-testid="cart-error">
          {error}
        </p>
      ) : null}

      {cart.totals.taxIsEstimate ? (
        <p className="mt-6 text-xs text-dt-fg-muted">
          Tax is an estimate until an address is entered at checkout.
        </p>
      ) : null}

      {client.can('checkout-preparation') ? (
        <Link
          to="/checkout"
          data-testid="cart-checkout-link"
          className="mt-8 inline-block rounded-dt-control bg-dt-accent px-6 py-3 text-sm font-medium text-dt-fg-inverse hover:bg-dt-accent-hover"
        >
          Checkout
        </Link>
      ) : (
        // A store without checkout capability gets told so, rather than a button
        // that leads somewhere that cannot work.
        <p className="mt-8 text-sm text-dt-fg-muted" data-testid="cart-checkout-unavailable">
          This store is not configured for checkout yet.
        </p>
      )}
    </div>
  );
}
