import { useState, type FormEvent } from 'react';
import { useStore } from '../store';
import { PageHeading } from '../components/Shell';
import { CommerceError } from '../lib/commerce';

interface LookedUpOrder {
  orderNumber?: string;
  status?: string;
  placedAt?: string;
  totals?: { total?: { amount?: string; currency?: string } };
  fulfillment?: { mode?: string; pickupStatus?: string | null };
}

/**
 * Guest order status.
 *
 * Always reachable, deliberately: a shopper looking for their order has usually
 * closed the tab they placed it in, and a lookup hidden behind a completed
 * checkout is a lookup they cannot get to.
 *
 * This request is never retried automatically. The platform answers the same way
 * for a wrong number and a wrong email, so a retry loop would be indistinguishable
 * from guessing at someone else's order.
 */
export function OrderLookup() {
  const { client } = useStore();
  const [orderNumber, setOrderNumber] = useState('');
  const [email, setEmail] = useState('');
  const [order, setOrder] = useState<LookedUpOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setOrder(null);
    try {
      setOrder((await client.lookupOrder(orderNumber.trim(), email.trim())) as LookedUpOrder);
    } catch (cause) {
      setError(
        cause instanceof CommerceError
          ? `${cause.message}${cause.requestId ? ` (request ${cause.requestId})` : ''}`
          : 'Could not find that order.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeading title="Order status" lede="Enter your order number and the email you used." />
      <div className="mx-auto max-w-lg px-4 pb-20 sm:px-6 lg:px-8">
        <form className="mt-8 space-y-4" onSubmit={(event) => void submit(event)}>
          <label className="block" htmlFor="order-number">
            <span className="text-sm font-medium text-dt-fg">Order number</span>
            <input
              id="order-number"
              data-testid="lookup-order-number"
              required
              value={orderNumber}
              onChange={(event) => setOrderNumber(event.target.value)}
              className="mt-1 w-full rounded-dt-control border border-dt-border bg-dt-surface px-3 py-2 text-sm text-dt-fg"
            />
          </label>
          <label className="block" htmlFor="lookup-email">
            <span className="text-sm font-medium text-dt-fg">Email</span>
            <input
              id="lookup-email"
              data-testid="lookup-email"
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-1 w-full rounded-dt-control border border-dt-border bg-dt-surface px-3 py-2 text-sm text-dt-fg"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            data-testid="lookup-submit"
            className="rounded-dt-control bg-dt-accent px-5 py-2.5 text-sm font-medium text-dt-fg-inverse disabled:opacity-50"
          >
            {busy ? 'Looking…' : 'Find my order'}
          </button>
        </form>

        {error ? (
          <p className="mt-6 text-sm text-dt-danger" role="alert" data-testid="lookup-error">
            {error}
          </p>
        ) : null}

        {order ? (
          <dl className="mt-8 space-y-2 rounded-dt-card border border-dt-border p-6 text-sm" data-testid="lookup-result">
            <Row label="Order" value={order.orderNumber} />
            <Row label="Status" value={order.status} />
            <Row label="Placed" value={order.placedAt} />
            <Row
              label="Total"
              value={
                order.totals?.total
                  ? `${order.totals.total.amount} ${order.totals.total.currency}`
                  : undefined
              }
            />
            <Row label="Fulfillment" value={order.fulfillment?.mode} />
          </dl>
        ) : null}
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value?: string | undefined }) {
  if (!value) return null;
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-dt-fg-muted">{label}</dt>
      <dd className="text-dt-fg">{value}</dd>
    </div>
  );
}
