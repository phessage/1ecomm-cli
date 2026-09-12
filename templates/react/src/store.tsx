/**
 * Store context: one client, one cart, shared by every route.
 *
 * The storefront bootstraps once at start-up and then fails closed. If the
 * platform cannot be reached, the shopper is told so — this deliberately never
 * falls back to sample products, because a shop that quietly shows fake stock is
 * worse than one that says it is unavailable.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { CommerceClient, CommerceError, bootstrap, type Cart, type StoreConfig } from './lib/commerce';
import config from '../headless-config.json';

interface StoreState {
  client: CommerceClient;
  store: StoreConfig;
  cart: Cart | null;
  cartCount: number;
  refreshCart: () => Promise<void>;
  addToCart: (input: { productId: string; variantId?: string; quantity?: number }) => Promise<void>;
  updateItem: (itemId: string, quantity: number) => Promise<void>;
  removeItem: (itemId: string) => Promise<void>;
}

const StoreContext = createContext<StoreState | null>(null);

export function useStore(): StoreState {
  const value = useContext(StoreContext);
  if (!value) throw new Error('useStore was called outside <StoreProvider>.');
  return value;
}

type Boot =
  | { phase: 'loading' }
  | { phase: 'ready'; client: CommerceClient; store: StoreConfig }
  | { phase: 'failed'; error: string; requestId?: string };

export function StoreProvider({ children }: { children: ReactNode }) {
  const [boot, setBoot] = useState<Boot>({ phase: 'loading' });
  const [cart, setCart] = useState<Cart | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const store = await bootstrap(config.storeId, config.bootstrapUrl);
        if (cancelled) return;
        setBoot({ phase: 'ready', client: new CommerceClient(store), store });
      } catch (error) {
        if (cancelled) return;
        const commerce = error instanceof CommerceError ? error : undefined;
        setBoot({
          phase: 'failed',
          error: commerce?.message ?? 'Could not reach the store.',
          ...(commerce?.requestId ? { requestId: commerce.requestId } : {}),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const client = boot.phase === 'ready' ? boot.client : null;

  const refreshCart = useCallback(async () => {
    if (!client) return;
    setCart(await client.getCart());
  }, [client]);

  useEffect(() => {
    void refreshCart();
  }, [refreshCart]);

  const addToCart = useCallback(
    async (input: { productId: string; variantId?: string; quantity?: number }) => {
      if (!client) return;
      setCart(await client.addItem(input));
    },
    [client],
  );

  const updateItem = useCallback(
    async (itemId: string, quantity: number) => {
      if (!client) return;
      setCart(quantity <= 0 ? await client.removeItem(itemId) : await client.updateItem(itemId, quantity));
    },
    [client],
  );

  const removeItem = useCallback(
    async (itemId: string) => {
      if (!client) return;
      setCart(await client.removeItem(itemId));
    },
    [client],
  );

  const value = useMemo<StoreState | null>(() => {
    if (boot.phase !== 'ready') return null;
    return {
      client: boot.client,
      store: boot.store,
      cart,
      cartCount: cart?.items.reduce((n, item) => n + item.quantity, 0) ?? 0,
      refreshCart,
      addToCart,
      updateItem,
      removeItem,
    };
  }, [boot, cart, refreshCart, addToCart, updateItem, removeItem]);

  if (boot.phase === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center text-dt-text-muted">
        <p data-testid="store-booting">Opening the store…</p>
      </div>
    );
  }

  if (boot.phase === 'failed') {
    return (
      <div className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-3 p-6 text-center">
        <h1 className="text-lg font-semibold text-dt-text" data-testid="store-unavailable">
          This store is unavailable
        </h1>
        <p className="text-sm text-dt-text-muted">{boot.error}</p>
        <p className="text-xs text-dt-text-muted">
          Store <code>{config.storeId}</code> via <code>{config.bootstrapUrl}</code>
          {boot.requestId ? <> · request {boot.requestId}</> : null}
        </p>
        <p className="text-xs text-dt-text-muted">
          Run <code>npx 1ecomm doctor</code> in this project to diagnose it.
        </p>
      </div>
    );
  }

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}
