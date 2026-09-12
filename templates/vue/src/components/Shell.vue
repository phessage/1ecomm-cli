<script setup lang="ts">
/**
 * Header, footer and the page frame.
 *
 * dt-ui has no header or footer component yet, so these are composed here from
 * its primitives and its semantic tokens. That is deliberate rather than a
 * shortfall: the shell is the part every merchant rebrands first, so it lives in
 * the project as ordinary editable code. It uses only `dt-` tokens, so it
 * repalettes with everything else.
 *
 * The `data-testid` values match the React template exactly, which is what lets
 * one Playwright suite drive both without knowing which framework rendered it.
 */
import { DtIcon } from '@1ecomm/dt-ui-vue';
import { cartCount, can } from '../store';
import { STORE_NAME } from '../config';

const nav = [
  { to: '/', label: 'Home' },
  { to: '/category', label: 'Shop' },
  ...(can('cart') ? [{ to: '/cart', label: 'Cart' }] : []),
];

const slug = (label: string) => label.toLowerCase().replace(/\s+/g, '-');
</script>

<template>
  <div class="flex min-h-screen flex-col">
    <header class="sticky top-0 z-20 border-b border-dt-border bg-dt-surface/90 backdrop-blur">
      <div class="mx-auto flex max-w-7xl items-center gap-6 px-4 py-4 sm:px-6 lg:px-8">
        <RouterLink
          to="/"
          class="text-base font-semibold tracking-tight text-dt-fg"
          data-testid="header-home-link"
        >
          {{ STORE_NAME }}
        </RouterLink>

        <nav class="hidden flex-1 items-center gap-6 md:flex" aria-label="Main">
          <RouterLink
            v-for="item in nav"
            :key="item.to"
            :to="item.to"
            :data-testid="`header-nav-${slug(item.label)}`"
            class="text-sm text-dt-fg-muted transition-colors hover:text-dt-fg"
            active-class="text-dt-accent font-medium"
          >
            {{ item.label }}
          </RouterLink>
        </nav>

        <div class="ml-auto flex items-center gap-2">
          <RouterLink
            to="/cart"
            data-testid="header-cart-link"
            class="relative inline-flex items-center gap-2 rounded-dt-control px-3 py-2 text-sm text-dt-fg hover:bg-dt-surface-sunken"
          >
            <DtIcon name="24/outline/shopping-bag" label="Cart" />
            <span
              v-if="cartCount > 0"
              data-testid="header-cart-count"
              class="inline-flex min-w-5 items-center justify-center rounded-full bg-dt-accent px-1.5 text-xs font-medium text-dt-fg-inverse"
            >
              {{ cartCount }}
            </span>
          </RouterLink>
        </div>
      </div>

      <!-- The same links again, so a phone is not left without navigation. -->
      <nav
        class="flex gap-4 overflow-x-auto border-t border-dt-border px-4 py-2 md:hidden"
        aria-label="Main, compact"
      >
        <RouterLink
          v-for="item in nav"
          :key="item.to"
          :to="item.to"
          class="whitespace-nowrap text-sm text-dt-fg-muted"
          active-class="text-dt-accent"
        >
          {{ item.label }}
        </RouterLink>
      </nav>
    </header>

    <main class="flex-1">
      <slot />
    </main>

    <footer class="mt-16 border-t border-dt-border">
      <div class="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-10 sm:px-6 lg:px-8">
        <nav class="flex flex-wrap gap-x-6 gap-y-2" aria-label="Footer">
          <RouterLink
            v-for="item in nav"
            :key="item.to"
            :to="item.to"
            class="text-sm text-dt-fg-muted hover:text-dt-fg"
          >
            {{ item.label }}
          </RouterLink>
        </nav>
        <p class="text-xs text-dt-fg-muted">Powered by 1Ecomm. Built with dt-ui.</p>
      </div>
    </footer>
  </div>
</template>
