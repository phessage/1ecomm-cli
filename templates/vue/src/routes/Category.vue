<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { DtProductList } from '@1ecomm/dt-ui-vue';
import { client } from '../store';
import { useAsync } from '../lib/useAsync';
import { toDtProducts } from '../lib/adapt';

const route = useRoute();
const slug = computed(() => (route.params['slug'] ? String(route.params['slug']) : undefined));

const categories = useAsync(() => client().listCategories());
const current = computed(() => (categories.value.value ?? []).find((c) => c.slug === slug.value));

// Filtering is by category ID, not slug, so the listing waits for categories to
// resolve. Asking earlier would send `categoryId=undefined` and quietly return
// the whole catalog while looking like a working filter.
const products = useAsync(async () => {
  if (slug.value && categories.status.value !== 'ready') return [];
  const id = current.value?.id;
  return client().listProducts({ limit: 24, ...(id ? { categoryId: id } : {}) });
});
</script>

<template>
  <div class="mx-auto max-w-7xl px-4 pt-10 sm:px-6 lg:px-8">
    <h1 class="text-2xl font-semibold tracking-tight text-dt-fg">
      {{ current?.name ?? 'Everything' }}
    </h1>
    <p v-if="current?.description" class="mt-2 max-w-2xl text-sm text-dt-fg-muted">
      {{ current.description }}
    </p>
  </div>

  <div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
    <nav
      v-if="(categories.value.value?.length ?? 0) > 0"
      class="flex flex-wrap gap-2 pt-6"
      aria-label="Categories"
    >
      <RouterLink
        to="/category"
        data-testid="plp-filter-all"
        :class="[
          'rounded-dt-control border px-3 py-1.5 text-sm',
          slug ? 'border-dt-border text-dt-fg-muted' : 'border-dt-accent text-dt-accent',
        ]"
      >
        All
      </RouterLink>
      <RouterLink
        v-for="category in categories.value.value ?? []"
        :key="category.id"
        :to="`/category/${category.slug}`"
        :data-testid="`plp-filter-${category.slug}`"
        :class="[
          'rounded-dt-control border px-3 py-1.5 text-sm',
          category.slug === slug
            ? 'border-dt-accent text-dt-accent'
            : 'border-dt-border text-dt-fg-muted hover:text-dt-fg',
        ]"
      >
        {{ category.name }}
      </RouterLink>
    </nav>

    <div
      v-if="products.status.value === 'failed'"
      class="mx-auto my-10 max-w-xl rounded-dt-card border border-dt-border-strong bg-dt-surface-sunken p-6 text-center"
      data-testid="error-note"
      role="alert"
    >
      <p class="text-sm text-dt-fg">{{ products.error.value }}</p>
      <button
        type="button"
        data-testid="error-retry"
        class="mt-4 rounded-dt-control bg-dt-accent px-4 py-2 text-sm font-medium text-dt-fg-inverse"
        @click="products.reload()"
      >
        Try again
      </button>
    </div>

    <p v-if="products.status.value === 'loading'" class="py-16 text-center text-sm text-dt-fg-muted">
      Loading products…
    </p>
    <p
      v-if="products.status.value === 'ready' && products.value.value?.length === 0"
      class="py-16 text-center text-sm text-dt-fg-muted"
      data-testid="plp-empty"
    >
      Nothing here yet.
    </p>
    <div
      v-if="products.status.value === 'ready' && (products.value.value?.length ?? 0) > 0"
      data-testid="plp-products"
    >
      <DtProductList template="simple" :products="toDtProducts(products.value.value ?? [])" />
    </div>
  </div>
</template>
