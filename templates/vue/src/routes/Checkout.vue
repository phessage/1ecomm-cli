<script setup lang="ts">
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
 * payment; anything else needs a payment session the browser cannot fake.
 */
import { computed, onMounted, ref } from 'vue';
import { client, storeState, can, refreshCart } from '../store';
import { CommerceError } from '../lib/commerce';

interface PaymentMethod {
  id: string;
  name: string;
  description: string | null;
  capabilities?: { requiresHostedCheckout?: boolean; canPlaceOrder?: boolean };
}
interface ShippingOption { id: string; name: string; price?: { amount: string; currency: string } }
interface Country { code: string; name: string; stateRequired: boolean; postalCodeRequired: boolean }
interface CheckoutState {
  ready: boolean;
  missing: string[];
  countries: Country[];
  paymentMethods: PaymentMethod[];
  shippingOptions: ShippingOption[];
  selectedPaymentMethodId: string | null;
  selectedShippingMethodId: string | null;
}

const EMPTY: CheckoutState = {
  ready: false, missing: [], countries: [], paymentMethods: [], shippingOptions: [],
  selectedPaymentMethodId: null, selectedShippingMethodId: null,
};

const state = ref<CheckoutState>({ ...EMPTY });
const loading = ref(true);
const busy = ref(false);
const error = ref('');
const placed = ref('');

const form = ref({ email: '', firstName: '', lastName: '', line1: '', city: '', state: '', postalCode: '', country: '' });

// One intent key per checkout attempt, created once and REUSED across retries.
// A fresh key on retry is exactly how one checkout becomes two orders.
const intentKey = crypto.randomUUID();

const cart = computed(() => storeState.cart);
const country = computed(() => state.value.countries.find((c) => c.code === form.value.country));
const selectedPayment = computed(() =>
  state.value.paymentMethods.find((m) => m.id === state.value.selectedPaymentMethodId),
);
const canPlaceOrder = computed(
  () =>
    can('orders') &&
    state.value.ready &&
    Boolean(selectedPayment.value?.capabilities?.canPlaceOrder) &&
    selectedPayment.value?.capabilities?.requiresHostedCheckout === false,
);

function describe(cause: unknown): string {
  if (cause instanceof CommerceError) {
    return `${cause.message}${cause.requestId ? ` (request ${cause.requestId})` : ''}`;
  }
  return cause instanceof Error ? cause.message : 'Something went wrong.';
}

async function read() {
  state.value = { ...EMPTY, ...((await client().getCheckout()) as unknown as CheckoutState) };
}

async function act(work: () => Promise<unknown>) {
  busy.value = true;
  error.value = '';
  try {
    await work();
    await read();
  } catch (cause) {
    error.value = describe(cause);
  } finally {
    busy.value = false;
  }
}

async function saveDetails() {
  await act(() =>
    client().patchCheckout({
      customerInfo: { email: form.value.email, firstName: form.value.firstName, lastName: form.value.lastName },
      billingAddress: {
        line1: form.value.line1,
        city: form.value.city,
        ...(form.value.state ? { state: form.value.state } : {}),
        ...(form.value.postalCode ? { postalCode: form.value.postalCode } : {}),
        country: form.value.country,
      },
    }),
  );
}

async function place() {
  busy.value = true;
  error.value = '';
  try {
    const order = (await client().placeOrder(intentKey)) as { orderNumber?: string };
    placed.value = order.orderNumber ?? 'created';
    await refreshCart();
  } catch (cause) {
    error.value = describe(cause);
  } finally {
    busy.value = false;
  }
}

onMounted(async () => {
  try {
    await read();
  } catch (cause) {
    error.value = describe(cause);
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div v-if="placed" class="mx-auto max-w-xl px-4 py-20 text-center" data-testid="checkout-placed">
    <h1 class="text-2xl font-semibold text-dt-fg">Order placed</h1>
    <p class="mt-3 text-sm text-dt-fg-muted">
      Your order number is <strong class="text-dt-fg">{{ placed }}</strong>. Keep it — you can
      reopen the order with it and your email address.
    </p>
    <RouterLink to="/" class="mt-8 inline-block text-sm text-dt-accent">Back to the shop</RouterLink>
  </div>

  <div v-else-if="!cart || cart.items.length === 0" class="mx-auto max-w-xl px-4 py-20 text-center">
    <p class="text-sm text-dt-fg-muted">Your bag is empty.</p>
    <RouterLink to="/category" class="mt-6 inline-block text-sm text-dt-accent">Find something</RouterLink>
  </div>

  <div v-else class="mx-auto max-w-2xl px-4 pb-20 sm:px-6 lg:px-8" :aria-busy="busy">
    <div class="pt-10">
      <h1 class="text-2xl font-semibold tracking-tight text-dt-fg">Checkout</h1>
    </div>

    <p v-if="loading" class="py-10 text-sm text-dt-fg-muted">Loading checkout…</p>

    <form v-else class="mt-8 space-y-4" @submit.prevent="saveDetails()">
      <label class="block" for="checkout-email">
        <span class="text-sm font-medium text-dt-fg">Email</span>
        <input id="checkout-email" v-model="form.email" data-testid="checkout-email" type="email" required
          class="mt-1 w-full rounded-dt-control border border-dt-border bg-dt-surface px-3 py-2 text-sm text-dt-fg" />
      </label>
      <div class="grid gap-4 sm:grid-cols-2">
        <label class="block" for="checkout-first-name">
          <span class="text-sm font-medium text-dt-fg">First name</span>
          <input id="checkout-first-name" v-model="form.firstName" data-testid="checkout-first-name"
            class="mt-1 w-full rounded-dt-control border border-dt-border bg-dt-surface px-3 py-2 text-sm text-dt-fg" />
        </label>
        <label class="block" for="checkout-last-name">
          <span class="text-sm font-medium text-dt-fg">Last name</span>
          <input id="checkout-last-name" v-model="form.lastName" data-testid="checkout-last-name"
            class="mt-1 w-full rounded-dt-control border border-dt-border bg-dt-surface px-3 py-2 text-sm text-dt-fg" />
        </label>
      </div>
      <label class="block" for="checkout-line1">
        <span class="text-sm font-medium text-dt-fg">Address</span>
        <input id="checkout-line1" v-model="form.line1" data-testid="checkout-line1"
          class="mt-1 w-full rounded-dt-control border border-dt-border bg-dt-surface px-3 py-2 text-sm text-dt-fg" />
      </label>
      <div class="grid gap-4 sm:grid-cols-2">
        <label class="block" for="checkout-city">
          <span class="text-sm font-medium text-dt-fg">City</span>
          <input id="checkout-city" v-model="form.city" data-testid="checkout-city"
            class="mt-1 w-full rounded-dt-control border border-dt-border bg-dt-surface px-3 py-2 text-sm text-dt-fg" />
        </label>
        <label class="block" for="checkout-country">
          <span class="text-sm font-medium text-dt-fg">Country</span>
          <select id="checkout-country" v-model="form.country" data-testid="checkout-country"
            class="mt-1 w-full rounded-dt-control border border-dt-border bg-dt-surface px-3 py-2 text-sm text-dt-fg">
            <option value="">Choose…</option>
            <option v-for="entry in state.countries" :key="entry.code" :value="entry.code">{{ entry.name }}</option>
          </select>
        </label>
      </div>
      <!-- Which of these the platform requires depends on the country, and the
           platform says so rather than this page guessing. -->
      <div class="grid gap-4 sm:grid-cols-2">
        <label v-if="country?.stateRequired" class="block" for="checkout-state">
          <span class="text-sm font-medium text-dt-fg">State or province</span>
          <input id="checkout-state" v-model="form.state" data-testid="checkout-state" required
            class="mt-1 w-full rounded-dt-control border border-dt-border bg-dt-surface px-3 py-2 text-sm text-dt-fg" />
        </label>
        <label v-if="country?.postalCodeRequired" class="block" for="checkout-postal-code">
          <span class="text-sm font-medium text-dt-fg">Postal code</span>
          <input id="checkout-postal-code" v-model="form.postalCode" data-testid="checkout-postal-code" required
            class="mt-1 w-full rounded-dt-control border border-dt-border bg-dt-surface px-3 py-2 text-sm text-dt-fg" />
        </label>
      </div>
      <button type="submit" :disabled="busy" data-testid="checkout-save-details"
        class="rounded-dt-control bg-dt-accent px-5 py-2.5 text-sm font-medium text-dt-fg-inverse disabled:opacity-50">
        Save details
      </button>
    </form>

    <section v-if="state.shippingOptions.length > 0" class="mt-10">
      <h2 class="text-sm font-medium text-dt-fg">Delivery</h2>
      <div class="mt-3 space-y-2">
        <label v-for="option in state.shippingOptions" :key="option.id"
          class="flex cursor-pointer items-center gap-3 rounded-dt-control border border-dt-border px-4 py-3">
          <input type="radio" name="shipping" :data-testid="`checkout-shipping-${option.id}`"
            :checked="state.selectedShippingMethodId === option.id" class="accent-dt-accent"
            @change="act(() => client().setShippingMethod(option.id))" />
          <span class="text-sm text-dt-fg">{{ option.name }}</span>
        </label>
      </div>
    </section>

    <section v-if="state.paymentMethods.length > 0" class="mt-10">
      <h2 class="text-sm font-medium text-dt-fg">Payment</h2>
      <div class="mt-3 space-y-2">
        <label v-for="method in state.paymentMethods" :key="method.id"
          class="flex cursor-pointer items-center gap-3 rounded-dt-control border border-dt-border px-4 py-3">
          <input type="radio" name="payment" :data-testid="`checkout-payment-${method.id}`"
            :checked="state.selectedPaymentMethodId === method.id" class="accent-dt-accent"
            @change="act(() => client().setPaymentMethod(method.id))" />
          <span class="text-sm text-dt-fg">{{ method.name }}</span>
          <span v-if="method.capabilities?.requiresHostedCheckout" class="ml-auto text-xs text-dt-fg-muted">
            redirects to the provider
          </span>
        </label>
      </div>
    </section>

    <p v-if="state.missing.length > 0" class="mt-8 text-sm text-dt-fg-muted" data-testid="checkout-missing">
      Still needed: {{ state.missing.join(', ') }}.
    </p>

    <p v-if="error" class="mt-6 text-sm text-dt-danger" role="alert" data-testid="checkout-error">{{ error }}</p>

    <button v-if="canPlaceOrder" type="button" :disabled="busy" data-testid="checkout-place-order"
      class="mt-8 w-full rounded-dt-control bg-dt-accent px-6 py-3 text-sm font-medium text-dt-fg-inverse disabled:opacity-50"
      @click="place()">
      {{ busy ? 'Placing…' : 'Place order' }}
    </button>
    <p v-else class="mt-8 text-sm text-dt-fg-muted" data-testid="checkout-cannot-place">
      <template v-if="!can('orders')">
        This store is set up for checkout preparation but cannot place orders yet.
      </template>
      <template v-else-if="selectedPayment?.capabilities?.requiresHostedCheckout">
        That payment method completes on the provider’s hosted page, which this starter does not implement yet.
      </template>
      <template v-else>Complete the details above to place the order.</template>
    </p>
  </div>
</template>
