/**
 * Store state: one client, one cart, shared by every route.
 *
 * The storefront bootstraps once and then fails closed. If the platform cannot
 * be reached the shopper is told so — it deliberately never falls back to
 * sample products, because a shop quietly showing fake stock is worse than one
 * that says it is unavailable.
 */
import { computed, reactive, readonly } from 'vue';
import { CommerceClient, CommerceError, bootstrap, type Cart, type StoreConfig } from './lib/commerce';
import config from '../headless-config.json';

type Phase = 'loading' | 'ready' | 'failed';

// The client is a class instance with private fields. It is deliberately NOT
// inside `reactive`: Vue would deep-wrap it, `readonly` would strip the private
// members from its type, and nothing about it needs to be reactive anyway — it
// is one stable object for the lifetime of the page.
let commerce: CommerceClient | null = null;

const state = reactive<{
  phase: Phase;
  store: StoreConfig | null;
  cart: Cart | null;
  error: string;
  requestId: string;
}>({ phase: 'loading', store: null, cart: null, error: '', requestId: '' });

export const storeState = readonly(state);
export const cartCount = computed(
  () => state.cart?.items.reduce((n, item) => n + item.quantity, 0) ?? 0,
);

/** The client, once ready. Throws if called before bootstrap resolves. */
export function client(): CommerceClient {
  if (!commerce) throw new Error('The commerce client was used before the store was ready.');
  return commerce;
}

export function can(capability: string): boolean {
  return state.store?.capabilities.includes(capability) ?? false;
}

export async function start(): Promise<void> {
  try {
    const store = await bootstrap(config.storeId, config.bootstrapUrl);
    state.store = store;
    commerce = new CommerceClient(store);
    state.phase = 'ready';
    await refreshCart();
  } catch (error) {
    const commerce = error instanceof CommerceError ? error : undefined;
    state.error = commerce?.message ?? 'Could not reach the store.';
    state.requestId = commerce?.requestId ?? '';
    state.phase = 'failed';
  }
}

export async function refreshCart(): Promise<void> {
  if (!commerce) return;
  state.cart = await commerce.getCart();
}

export async function addToCart(input: {
  productId: string;
  variantId?: string;
  quantity?: number;
}): Promise<void> {
  state.cart = await client().addItem(input);
}

export async function updateItem(itemId: string, quantity: number): Promise<void> {
  state.cart = quantity <= 0 ? await client().removeItem(itemId) : await client().updateItem(itemId, quantity);
}

export async function removeItem(itemId: string): Promise<void> {
  state.cart = await client().removeItem(itemId);
}
