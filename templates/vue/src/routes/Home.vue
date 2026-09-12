<script setup lang="ts">
import { DtProductList, DtIncentives, DtFaq, DtNewsletter } from '@1ecomm/dt-ui-vue';
import { useRouter } from 'vue-router';
import { client } from '../store';
import { useAsync } from '../lib/useAsync';
import { toDtProducts } from '../lib/adapt';
import CategoryTiles from '../components/CategoryTiles.vue';
import { STORE_NAME } from '../config';

const router = useRouter();
const products = useAsync(() => client().listProducts({ limit: 8 }));
const categories = useAsync(() => client().listCategories());
</script>

<template>
  <!-- dt-ui has no hero component, so this is project code — which is where a
       merchant wants it anyway. It uses only dt- tokens, so it follows the
       chosen palette and light/dark mode without knowing which they are. -->
  <section class="border-b border-dt-border bg-dt-surface-sunken">
    <div class="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
      <p class="text-sm font-medium text-dt-accent">New season</p>
      <h1 class="mt-3 max-w-2xl text-4xl font-semibold tracking-tight text-dt-fg sm:text-5xl">
        {{ STORE_NAME }}
      </h1>
      <p class="mt-4 max-w-xl text-base text-dt-fg-muted">
        Everything here is served live by 1Ecomm — real catalog, real stock, real prices.
      </p>
      <button
        type="button"
        data-testid="hero-shop-cta"
        class="mt-8 rounded-dt-control bg-dt-accent px-5 py-3 text-sm font-medium text-dt-fg-inverse hover:bg-dt-accent-hover"
        @click="router.push('/category')"
      >
        Shop everything
      </button>
    </div>
  </section>

  <div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
    <CategoryTiles
      v-if="categories.status.value === 'ready'"
      heading="Shop by category"
      :categories="(categories.value.value ?? []).slice(0, 4)"
    />

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
      data-testid="home-empty"
    >
      This store has no published products yet.
    </p>

    <div v-if="products.status.value === 'ready' && (products.value.value?.length ?? 0) > 0" data-testid="home-products">
      <DtProductList
        template="inline-price-and-cta-link"
        heading="Latest"
        :products="toDtProducts(products.value.value ?? [])"
        :view-all="{ label: 'View all', href: '/category' }"
        add-to-cart-label="Add to bag"
        @add-to-cart="(product) => router.push(product.href)"
      />
    </div>

    <DtIncentives
      template="icons"
      heading="Why shop with us"
      :incentives="[
        { name: 'Free delivery', description: 'On every order, no minimum.', icon: '24/outline/truck' },
        { name: 'Secure checkout', description: 'Payments handled by 1Ecomm.', icon: '24/outline/shield-check' },
        { name: 'Easy returns', description: 'Thirty days, no questions.', icon: '24/outline/receipt-refund' },
      ]"
    />

    <DtFaq
      template="centered-accordion"
      heading="Questions"
      :faqs="[
        { question: 'How long does delivery take?', answer: 'Orders are dispatched within one working day and usually arrive in three to five.' },
        { question: 'Can I change my order?', answer: 'Contact us before it ships and we will amend it where we can.' },
      ]"
    />

    <DtNewsletter
      template="side-by-side"
      heading="Stay in touch"
      description="Occasional emails about new arrivals. No noise."
    />
  </div>
</template>
