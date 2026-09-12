<script setup lang="ts">
/**
 * The product page.
 *
 * The reason this route is hand-composed rather than a dt-ui component is the
 * option matrix. The platform rejects an add-to-cart that omits `variantId` for
 * a product that has variants — HTTP 400, "Cart mutation could not be
 * completed", which tells a shopper nothing. So the page resolves variants
 * first, makes the shopper choose, and only then enables the button.
 */
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { money } from '@1ecomm/dt-ui-core';
import { client, addToCart } from '../store';
import { useAsync } from '../lib/useAsync';
import { addToCartBlocker, findVariant, toMoney, toOptionAxes } from '../lib/adapt';
import { CommerceError } from '../lib/commerce';

const route = useRoute();
const router = useRouter();
const id = String(route.params['id'] ?? '');

const product = useAsync(() => client().getProduct(id));
const variants = useAsync(() => client().listVariants(id));

const chosen = ref<Record<string, string>>({});
const adding = ref(false);
const addError = ref('');

const variantsLoaded = computed(() => variants.status.value === 'ready');
const variantList = computed(() => (variantsLoaded.value ? (variants.value.value ?? []) : []));
const axes = computed(() => toOptionAxes(variantList.value));
const selected = computed(() => findVariant(variantList.value, chosen.value));
const blocker = computed(() =>
  addToCartBlocker(variantList.value, chosen.value, variantsLoaded.value),
);
const price = computed(() =>
  selected.value ? toMoney(selected.value.price) : toMoney(product.value.value?.price ?? null),
);

/** Can this value still combine with what is already picked? */
function reachable(key: string, value: string): boolean {
  return variantList.value.some(
    (variant) =>
      variant.selectedOptions?.[key] === value &&
      Object.entries(chosen.value).every(([k, v]) => k === key || variant.selectedOptions?.[k] === v),
  );
}

async function onAdd() {
  if (blocker.value || !product.value.value) return;
  // The button should already have prevented this. Checked again because the
  // cost of being wrong is a shopper seeing HTTP 400.
  if (variantList.value.length > 0 && !selected.value) return;
  adding.value = true;
  addError.value = '';
  try {
    await addToCart({
      productId: product.value.value.id,
      ...(selected.value ? { variantId: selected.value.id } : {}),
      quantity: 1,
    });
    await router.push('/cart');
  } catch (error) {
    // Surface the platform's own words plus its request ID: a shopper can quote
    // it and a developer can find it in the logs.
    const commerce = error instanceof CommerceError ? error : undefined;
    addError.value = commerce
      ? `${commerce.message}${commerce.requestId ? ` (request ${commerce.requestId})` : ''}`
      : 'Could not add that to your bag.';
  } finally {
    adding.value = false;
  }
}
</script>

<template>
  <p v-if="product.status.value === 'loading'" class="py-24 text-center text-sm text-dt-fg-muted">
    Loading…
  </p>

  <div
    v-else-if="product.status.value === 'failed'"
    class="mx-auto my-10 max-w-xl rounded-dt-card border border-dt-border-strong bg-dt-surface-sunken p-6 text-center"
    data-testid="error-note"
    role="alert"
  >
    <p class="text-sm text-dt-fg">{{ product.error.value }}</p>
    <button
      type="button"
      data-testid="error-retry"
      class="mt-4 rounded-dt-control bg-dt-accent px-4 py-2 text-sm font-medium text-dt-fg-inverse"
      @click="product.reload()"
    >
      Try again
    </button>
  </div>

  <div v-else-if="product.value.value" class="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
    <div class="grid gap-10 lg:grid-cols-2">
      <img
        :src="product.value.value.imageUrl ?? ''"
        :alt="product.value.value.name"
        data-testid="pdp-image"
        class="w-full rounded-dt-card bg-dt-surface-sunken object-cover"
      />

      <div>
        <h1 class="text-2xl font-semibold tracking-tight text-dt-fg" data-testid="pdp-name">
          {{ product.value.value.name }}
        </h1>
        <p class="mt-3 text-xl text-dt-fg" data-testid="pdp-price">{{ money(price) }}</p>

        <p
          v-if="product.value.value.description"
          class="mt-6 text-sm leading-6 text-dt-fg-muted"
          data-testid="pdp-description"
        >
          {{ product.value.value.description }}
        </p>

        <fieldset v-for="axis in axes" :key="axis.key" class="mt-8">
          <legend class="text-sm font-medium text-dt-fg">{{ axis.label }}</legend>
          <div class="mt-3 flex flex-wrap gap-2">
            <button
              v-for="value in axis.values"
              :key="value"
              type="button"
              :disabled="!reachable(axis.key, value)"
              :data-testid="`pdp-option-${axis.label.toLowerCase()}-${value.toLowerCase()}`"
              :class="[
                'rounded-dt-control border px-3 py-2 text-sm transition-colors',
                chosen[axis.key] === value
                  ? 'border-dt-accent bg-dt-accent text-dt-fg-inverse'
                  : 'border-dt-border text-dt-fg hover:border-dt-border-strong',
                reachable(axis.key, value) ? '' : 'cursor-not-allowed opacity-40',
              ]"
              @click="chosen = { ...chosen, [axis.key]: value }"
            >
              {{ value }}
            </button>
          </div>
        </fieldset>

        <button
          type="button"
          :disabled="Boolean(blocker) || adding"
          data-testid="pdp-add-to-cart"
          class="mt-10 w-full rounded-dt-control bg-dt-accent px-6 py-3 text-sm font-medium text-dt-fg-inverse hover:bg-dt-accent-hover disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          @click="onAdd()"
        >
          {{ adding ? 'Adding…' : (blocker ?? 'Add to bag') }}
        </button>

        <p v-if="addError" class="mt-4 text-sm text-dt-danger" role="alert" data-testid="pdp-add-error">
          {{ addError }}
        </p>
      </div>
    </div>
  </div>
</template>
