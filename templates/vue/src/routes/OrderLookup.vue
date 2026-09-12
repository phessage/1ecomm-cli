<script setup lang="ts">
/**
 * Guest order status.
 *
 * Always reachable, deliberately: a shopper looking for their order has usually
 * closed the tab they placed it in. This request is never retried
 * automatically — the platform answers the same way for a wrong number and a
 * wrong email, so a retry loop would be indistinguishable from guessing at
 * someone else's order.
 */
import { ref } from 'vue';
import { client } from '../store';
import { CommerceError } from '../lib/commerce';

interface LookedUpOrder {
  orderNumber?: string;
  status?: string;
  placedAt?: string;
  totals?: { total?: { amount?: string; currency?: string } };
  fulfillment?: { mode?: string };
}

const orderNumber = ref('');
const email = ref('');
const order = ref<LookedUpOrder | null>(null);
const error = ref('');
const busy = ref(false);

async function submit() {
  busy.value = true;
  error.value = '';
  order.value = null;
  try {
    order.value = (await client().lookupOrder(orderNumber.value.trim(), email.value.trim())) as LookedUpOrder;
  } catch (cause) {
    error.value =
      cause instanceof CommerceError
        ? `${cause.message}${cause.requestId ? ` (request ${cause.requestId})` : ''}`
        : 'Could not find that order.';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="mx-auto max-w-7xl px-4 pt-10 sm:px-6 lg:px-8">
    <h1 class="text-2xl font-semibold tracking-tight text-dt-fg">Order status</h1>
    <p class="mt-2 max-w-2xl text-sm text-dt-fg-muted">
      Enter your order number and the email you used.
    </p>
  </div>

  <div class="mx-auto max-w-lg px-4 pb-20 sm:px-6 lg:px-8">
    <form class="mt-8 space-y-4" @submit.prevent="submit()">
      <label class="block" for="order-number">
        <span class="text-sm font-medium text-dt-fg">Order number</span>
        <input id="order-number" v-model="orderNumber" data-testid="lookup-order-number" required
          class="mt-1 w-full rounded-dt-control border border-dt-border bg-dt-surface px-3 py-2 text-sm text-dt-fg" />
      </label>
      <label class="block" for="lookup-email">
        <span class="text-sm font-medium text-dt-fg">Email</span>
        <input id="lookup-email" v-model="email" data-testid="lookup-email" type="email" required
          class="mt-1 w-full rounded-dt-control border border-dt-border bg-dt-surface px-3 py-2 text-sm text-dt-fg" />
      </label>
      <button type="submit" :disabled="busy" data-testid="lookup-submit"
        class="rounded-dt-control bg-dt-accent px-5 py-2.5 text-sm font-medium text-dt-fg-inverse disabled:opacity-50">
        {{ busy ? 'Looking…' : 'Find my order' }}
      </button>
    </form>

    <p v-if="error" class="mt-6 text-sm text-dt-danger" role="alert" data-testid="lookup-error">{{ error }}</p>

    <dl v-if="order" class="mt-8 space-y-2 rounded-dt-card border border-dt-border p-6 text-sm" data-testid="lookup-result">
      <div v-if="order.orderNumber" class="flex justify-between gap-4">
        <dt class="text-dt-fg-muted">Order</dt><dd class="text-dt-fg">{{ order.orderNumber }}</dd>
      </div>
      <div v-if="order.status" class="flex justify-between gap-4">
        <dt class="text-dt-fg-muted">Status</dt><dd class="text-dt-fg">{{ order.status }}</dd>
      </div>
      <div v-if="order.totals?.total" class="flex justify-between gap-4">
        <dt class="text-dt-fg-muted">Total</dt>
        <dd class="text-dt-fg">{{ order.totals.total.amount }} {{ order.totals.total.currency }}</dd>
      </div>
    </dl>
  </div>
</template>
