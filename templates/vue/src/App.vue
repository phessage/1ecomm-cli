<script setup lang="ts">
import Shell from './components/Shell.vue';
import { storeState } from './store';
import config from '../headless-config.json';
</script>

<template>
  <div
    v-if="storeState.phase === 'loading'"
    class="flex min-h-screen items-center justify-center text-dt-fg-muted"
  >
    <p data-testid="store-booting">Opening the store…</p>
  </div>

  <!-- Fails closed. A shop that quietly shows fake stock is worse than one that
       says it is unavailable. -->
  <div
    v-else-if="storeState.phase === 'failed'"
    class="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-3 p-6 text-center"
  >
    <h1 class="text-lg font-semibold text-dt-fg" data-testid="store-unavailable">
      This store is unavailable
    </h1>
    <p class="text-sm text-dt-fg-muted">{{ storeState.error }}</p>
    <p class="text-xs text-dt-fg-muted">
      Store <code>{{ config.storeId }}</code> via <code>{{ config.bootstrapUrl }}</code>
      <template v-if="storeState.requestId"> · request {{ storeState.requestId }}</template>
    </p>
    <p class="text-xs text-dt-fg-muted">
      Run <code>npx 1ecomm doctor</code> in this project to diagnose it.
    </p>
  </div>

  <Shell v-else>
    <RouterView />
  </Shell>
</template>
