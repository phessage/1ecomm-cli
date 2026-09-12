<script setup lang="ts">
/**
 * dt-order-summary renders the lines and the totals, so the cart's job is the
 * mapping and the mutations. The totals it wants are DtMoney objects while the
 * API sends decimal strings, so every field goes through `toMoney`.
 */
import { computed, ref } from 'vue';
import { DtEmptyState, DtOrderSummary } from '@1ecomm/dt-ui-vue';
import type { DtCartLine, DtOrderTotals } from '@1ecomm/dt-ui-core';
import { storeState, can, updateItem, removeItem } from '../store';
import { toMoney } from '../lib/adapt';

const busy = ref(false);
const error = ref('');

const cart = computed(() => storeState.cart);

const lines = computed<DtCartLine[]>(() =>
  (cart.value?.items ?? []).map((item) => ({
    id: item.id,
    name: item.name,
    href: `/product/${item.productId}`,
    image: { src: item.imageUrl ?? '', alt: item.name },
    price: toMoney(item.unitPrice),
    quantity: item.quantity,
  })),
);

const totals = computed<DtOrderTotals>(() => {
  const currency = cart.value?.currency ?? 'USD';
  const at = (amount: string) => toMoney({ amount, currency });
  return {
    subtotal: at(cart.value?.totals.subtotal ?? '0'),
    shipping: at(cart.value?.totals.shipping ?? '0'),
    taxes: at(cart.value?.totals.tax ?? '0'),
    total: at(cart.value?.totals.total ?? '0'),
  };
});

async function mutate(work: () => Promise<void>) {
  busy.value = true;
  error.value = '';
  try {
    await work();
  } catch (cause) {
    // Cart mutations are deliberately never retried: an add is not replay-safe,
    // so a failure is shown rather than silently repeated.
    error.value = cause instanceof Error ? cause.message : 'That change did not go through.';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div v-if="!cart || cart.items.length === 0" class="mx-auto max-w-2xl px-4 py-20" data-testid="cart-empty">
    <DtEmptyState
      template="simple"
      title="Your bag is empty"
      description="Once you add something it will show up here."
      icon="24/outline/shopping-bag"
      :action="{ label: 'Start shopping', href: '/category' }"
    />
  </div>

  <div v-else class="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8" data-testid="cart">
    <h1 class="text-2xl font-semibold tracking-tight text-dt-fg">Your bag</h1>

    <div class="mt-8" :aria-busy="busy">
      <DtOrderSummary
        template="card"
        title="Order summary"
        :lines="lines"
        :totals="totals"
        editable
        @line-removed="(line) => mutate(() => removeItem(line.id))"
      />
    </div>

    <!-- Quantity controls sit outside the summary: dt-order-summary reports a
         removal but does not own quantity, and the cart is the thing that knows
         how to talk to the platform. -->
    <ul class="mt-6 space-y-2">
      <li
        v-for="item in cart.items"
        :key="item.id"
        class="flex items-center justify-between gap-4 text-sm"
      >
        <span class="truncate text-dt-fg-muted">{{ item.name }}</span>
        <span class="flex items-center gap-2">
          <button
            type="button"
            :disabled="busy"
            :aria-label="`Decrease quantity of ${item.name}`"
            :data-testid="`cart-decrease-${item.id}`"
            class="rounded-dt-control border border-dt-border px-2 py-1 disabled:opacity-40"
            @click="mutate(() => updateItem(item.id, item.quantity - 1))"
          >
            −
          </button>
          <span :data-testid="`cart-quantity-${item.id}`" class="w-6 text-center text-dt-fg">
            {{ item.quantity }}
          </span>
          <button
            type="button"
            :disabled="busy"
            :aria-label="`Increase quantity of ${item.name}`"
            :data-testid="`cart-increase-${item.id}`"
            class="rounded-dt-control border border-dt-border px-2 py-1 disabled:opacity-40"
            @click="mutate(() => updateItem(item.id, item.quantity + 1))"
          >
            +
          </button>
        </span>
      </li>
    </ul>

    <p v-if="error" class="mt-4 text-sm text-dt-danger" role="alert" data-testid="cart-error">
      {{ error }}
    </p>

    <p v-if="cart.totals.taxIsEstimate" class="mt-6 text-xs text-dt-fg-muted">
      Tax is an estimate until an address is entered at checkout.
    </p>

    <RouterLink
      v-if="can('checkout-preparation')"
      to="/checkout"
      data-testid="cart-checkout-link"
      class="mt-8 inline-block rounded-dt-control bg-dt-accent px-6 py-3 text-sm font-medium text-dt-fg-inverse hover:bg-dt-accent-hover"
    >
      Checkout
    </RouterLink>
    <!-- A store without checkout capability is told so, rather than given a
         button that leads somewhere that cannot work. -->
    <p v-else class="mt-8 text-sm text-dt-fg-muted" data-testid="cart-checkout-unavailable">
      This store is not configured for checkout yet.
    </p>
  </div>
</template>
