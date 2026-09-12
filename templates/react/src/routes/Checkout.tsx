import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../store';
import { PageHeading } from '../components/Shell';
import { CommerceError } from '../lib/commerce';

/**
 * Checkout preparation.
 *
 * The platform owns every rule here — which countries need a state, which
 * payment methods can place an order, what is still missing — and reports them
 * on each read. So this page renders the server's answer rather than
 * re-implementing the logic, and re-reads after every change.
 *
 * The important gate is `capabilities.requiresHostedCheckout`. An order may be
 * placed from here ONLY for a method that explicitly does not require hosted
 * payment. Anything else needs a payment session the browser cannot fake, so the
 * button is not offered.
 */
interface PaymentMethod {
  id: string;
  name: string;
  description: string | null;
  type: string;
  capabilities?: {
    requiresHostedCheckout?: boolean;
    canPlaceOrder?: boolean;
  };
}

interface ShippingOption {
  id: string;
  name: string;
  description?: string | null;
  price?: { amount: string; currency: string };
}

interface Country {
  code: string;
  name: string;
  stateRequired: boolean;
  postalCodeRequired: boolean;
}

interface CheckoutState {
  ready: boolean;
  missing: string[];
  countries: Country[];
  paymentMethods: PaymentMethod[];
  shippingOptions: ShippingOption[];
  selectedPaymentMethodId: string | null;
  selectedShippingMethodId: string | null;
  customerInfo: { email?: string; firstName?: string; lastName?: string; phone?: string };
  billingAddress: Record<string, string | undefined>;
}

const EMPTY: CheckoutState = {
  ready: false,
  missing: [],
  countries: [],
  paymentMethods: [],
  shippingOptions: [],
  selectedPaymentMethodId: null,
  selectedShippingMethodId: null,
  customerInfo: {},
  billingAddress: {},
};

export function Checkout() {
  const { client, cart } = useStore();
  const [state, setState] = useState<CheckoutState>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<string | null>(null);

  const [form, setForm] = useState({
    email: '',
    firstName: '',
    lastName: '',
    line1: '',
    city: '',
    state: '',
    postalCode: '',
    country: '',
  });

  // One intent key per checkout attempt, created once and REUSED across
  // retries. A fresh key on retry is exactly how one checkout becomes two
  // orders, so it must not be regenerated on re-render.
  const intentKey = useMemo(() => crypto.randomUUID(), []);

  async function read() {
    const next = (await client.getCheckout()) as unknown as CheckoutState;
    setState({ ...EMPTY, ...next });
    setForm((prev) => ({
      ...prev,
      email: next.customerInfo?.email ?? prev.email,
      country: (next.billingAddress?.['country'] as string | undefined) ?? prev.country,
    }));
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await read();
      } catch (cause) {
        if (!cancelled) setError(describe(cause));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  async function act(work: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await work();
      await read();
    } catch (cause) {
      setError(describe(cause));
    } finally {
      setBusy(false);
    }
  }

  const selectedPayment = state.paymentMethods.find((m) => m.id === state.selectedPaymentMethodId);

  // Only a method that explicitly does NOT require hosted checkout can be
  // completed from here.
  const canPlaceOrder =
    client.can('orders') &&
    state.ready &&
    Boolean(selectedPayment?.capabilities?.canPlaceOrder) &&
    selectedPayment?.capabilities?.requiresHostedCheckout === false;

  if (placed) {
    return (
      <div className="mx-auto max-w-xl px-4 py-20 text-center" data-testid="checkout-placed">
        <h1 className="text-2xl font-semibold text-dt-fg">Order placed</h1>
        <p className="mt-3 text-sm text-dt-fg-muted">
          Your order number is <strong className="text-dt-fg">{placed}</strong>. Keep it — you can
          reopen the order with it and your email address.
        </p>
        <Link to="/" className="mt-8 inline-block text-sm text-dt-accent">
          Back to the shop
        </Link>
      </div>
    );
  }

  if (!cart || cart.items.length === 0) {
    return (
      <div className="mx-auto max-w-xl px-4 py-20 text-center">
        <p className="text-sm text-dt-fg-muted">Your bag is empty.</p>
        <Link to="/category" className="mt-6 inline-block text-sm text-dt-accent">
          Find something
        </Link>
      </div>
    );
  }

  const country = state.countries.find((c) => c.code === form.country);

  return (
    <>
      <PageHeading title="Checkout" />
      <div className="mx-auto max-w-2xl px-4 pb-20 sm:px-6 lg:px-8" aria-busy={busy}>
        {loading ? <p className="py-10 text-sm text-dt-fg-muted">Loading checkout…</p> : null}

        {!loading ? (
          <form
            className="mt-8 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void act(() =>
                client.patchCheckout({
                  customerInfo: {
                    email: form.email,
                    firstName: form.firstName,
                    lastName: form.lastName,
                  },
                  billingAddress: {
                    line1: form.line1,
                    city: form.city,
                    ...(form.state ? { state: form.state } : {}),
                    ...(form.postalCode ? { postalCode: form.postalCode } : {}),
                    country: form.country,
                  },
                }),
              );
            }}
          >
            <Field id="email" label="Email" type="email" required value={form.email} onChange={set(setForm, 'email')} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="first-name" label="First name" value={form.firstName} onChange={set(setForm, 'firstName')} />
              <Field id="last-name" label="Last name" value={form.lastName} onChange={set(setForm, 'lastName')} />
            </div>
            <Field id="line1" label="Address" value={form.line1} onChange={set(setForm, 'line1')} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="city" label="City" value={form.city} onChange={set(setForm, 'city')} />
              <label className="block">
                <span className="text-sm font-medium text-dt-fg">Country</span>
                <select
                  id="country"
                  data-testid="checkout-country"
                  value={form.country}
                  onChange={(event) => setForm((prev) => ({ ...prev, country: event.target.value }))}
                  className="mt-1 w-full rounded-dt-control border border-dt-border bg-dt-surface px-3 py-2 text-sm text-dt-fg"
                >
                  <option value="">Choose…</option>
                  {state.countries.map((entry) => (
                    <option key={entry.code} value={entry.code}>
                      {entry.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {/* Which of these the platform requires depends on the country, and
                the platform says so rather than this page guessing. */}
            <div className="grid gap-4 sm:grid-cols-2">
              {country?.stateRequired ? (
                <Field id="state" label="State or province" required value={form.state} onChange={set(setForm, 'state')} />
              ) : null}
              {country?.postalCodeRequired ? (
                <Field id="postal-code" label="Postal code" required value={form.postalCode} onChange={set(setForm, 'postalCode')} />
              ) : null}
            </div>

            <button
              type="submit"
              disabled={busy}
              data-testid="checkout-save-details"
              className="rounded-dt-control bg-dt-accent px-5 py-2.5 text-sm font-medium text-dt-fg-inverse disabled:opacity-50"
            >
              Save details
            </button>
          </form>
        ) : null}

        {state.shippingOptions.length > 0 ? (
          <Section title="Delivery">
            {state.shippingOptions.map((option) => (
              <Radio
                key={option.id}
                name="shipping"
                testId={`checkout-shipping-${option.id}`}
                checked={state.selectedShippingMethodId === option.id}
                onChange={() => void act(() => client.setShippingMethod(option.id))}
                label={option.name}
                hint={option.price ? `${option.price.amount} ${option.price.currency}` : undefined}
              />
            ))}
          </Section>
        ) : null}

        {state.paymentMethods.length > 0 ? (
          <Section title="Payment">
            {state.paymentMethods.map((method) => {
              const hosted = method.capabilities?.requiresHostedCheckout === true;
              return (
                <Radio
                  key={method.id}
                  name="payment"
                  testId={`checkout-payment-${method.id}`}
                  checked={state.selectedPaymentMethodId === method.id}
                  onChange={() => void act(() => client.setPaymentMethod(method.id))}
                  label={method.name}
                  hint={hosted ? 'redirects to the provider' : (method.description ?? undefined)}
                />
              );
            })}
          </Section>
        ) : null}

        {state.missing.length > 0 ? (
          <p className="mt-8 text-sm text-dt-fg-muted" data-testid="checkout-missing">
            Still needed: {state.missing.join(', ')}.
          </p>
        ) : null}

        {error ? (
          <p className="mt-6 text-sm text-dt-danger" role="alert" data-testid="checkout-error">
            {error}
          </p>
        ) : null}

        {canPlaceOrder ? (
          <button
            type="button"
            disabled={busy}
            data-testid="checkout-place-order"
            onClick={() =>
              void (async () => {
                setBusy(true);
                setError(null);
                try {
                  const order = (await client.placeOrder(intentKey)) as { orderNumber?: string };
                  setPlaced(order.orderNumber ?? 'created');
                } catch (cause) {
                  setError(describe(cause));
                } finally {
                  setBusy(false);
                }
              })()
            }
            className="mt-8 w-full rounded-dt-control bg-dt-accent px-6 py-3 text-sm font-medium text-dt-fg-inverse disabled:opacity-50"
          >
            {busy ? 'Placing…' : 'Place order'}
          </button>
        ) : (
          <p className="mt-8 text-sm text-dt-fg-muted" data-testid="checkout-cannot-place">
            {!client.can('orders')
              ? 'This store is set up for checkout preparation but cannot place orders yet.'
              : selectedPayment && selectedPayment.capabilities?.requiresHostedCheckout
                ? 'That payment method completes on the provider’s hosted page, which this starter does not implement yet.'
                : 'Complete the details above to place the order.'}
          </p>
        )}
      </div>
    </>
  );
}

function describe(cause: unknown): string {
  if (cause instanceof CommerceError) {
    return `${cause.message}${cause.requestId ? ` (request ${cause.requestId})` : ''}`;
  }
  return cause instanceof Error ? cause.message : 'Something went wrong.';
}

function set<T extends Record<string, string>>(
  setter: (fn: (prev: T) => T) => void,
  key: keyof T,
): (value: string) => void {
  return (value) => setter((prev) => ({ ...prev, [key]: value }));
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-sm font-medium text-dt-fg">{title}</h2>
      <div className="mt-3 space-y-2">{children}</div>
    </section>
  );
}

function Field(props: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="block" htmlFor={props.id}>
      <span className="text-sm font-medium text-dt-fg">{props.label}</span>
      <input
        id={props.id}
        data-testid={`checkout-${props.id}`}
        type={props.type ?? 'text'}
        required={props.required ?? false}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        className="mt-1 w-full rounded-dt-control border border-dt-border bg-dt-surface px-3 py-2 text-sm text-dt-fg"
      />
    </label>
  );
}

function Radio(props: {
  name: string;
  testId: string;
  checked: boolean;
  onChange: () => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-dt-control border border-dt-border px-4 py-3">
      <input
        type="radio"
        name={props.name}
        data-testid={props.testId}
        checked={props.checked}
        onChange={props.onChange}
        className="accent-dt-accent"
      />
      <span className="text-sm text-dt-fg">{props.label}</span>
      {props.hint ? <span className="ml-auto text-xs text-dt-fg-muted">{props.hint}</span> : null}
    </label>
  );
}
