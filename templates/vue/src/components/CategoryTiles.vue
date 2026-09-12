<script setup lang="ts">
/**
 * Category tiles.
 *
 * Written rather than reusing `dt-product-list`, because a category is not a
 * product. `DtProduct` requires a price, so routing categories through it
 * printed "$0" under every tile — a real price, for a thing that has none.
 *
 * dt-ui has no category component yet. When it gains one, this goes away.
 */
import type { Category } from '../lib/commerce';

defineProps<{ heading: string; categories: Category[] }>();
</script>

<template>
  <section v-if="categories.length > 0" class="py-12" data-testid="home-categories">
    <h2 class="text-lg font-semibold tracking-tight text-dt-fg">{{ heading }}</h2>
    <ul class="mt-6 grid grid-cols-2 gap-x-6 gap-y-8 lg:grid-cols-4">
      <li v-for="category in categories" :key="category.id">
        <RouterLink
          :to="`/category/${category.slug || category.id}`"
          :data-testid="`home-category-${category.slug}`"
          class="group block"
        >
          <div class="aspect-square overflow-hidden rounded-dt-card bg-dt-surface-sunken">
            <img
              v-if="category.imageUrl"
              :src="category.imageUrl"
              :alt="category.name"
              class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
          </div>
          <p class="mt-3 text-sm font-medium text-dt-fg">{{ category.name }}</p>
          <p v-if="category.description" class="mt-1 line-clamp-2 text-sm text-dt-fg-muted">
            {{ category.description }}
          </p>
        </RouterLink>
      </li>
    </ul>
  </section>
</template>
