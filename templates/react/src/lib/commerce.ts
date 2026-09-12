/**
 * The 1Ecomm headless commerce client for this storefront.
 *
 * Shapes here match what api.1ecomm.com actually returns, which is not always
 * what a reader expects: a product carries `name` (not `title`) and `price` is
 * an object, not a number.
 *
 * Two rules this file exists to enforce:
 *
 *  1. A cart token is a shopper capability. It is sent as a header, never put in
 *     a URL, never logged.
 *  2. Cart mutations are never retried. Adding an item is not replay-safe, so a
 *     timeout must surface to the shopper rather than silently double an order
 *     line. Order placement is the single exception, and only when the caller
 *     reuses one idempotency key it owns.
 */

export interface Money {
  amount: string;
  currency: string;
}

export interface Product {
  id: string;
  slug: string;
  name: string;
  description: string;
  imageUrl: string | null;
  price: Money;
  available: boolean;
}

export interface Category {
  id: string;
  slug: string;
  name: string;
  description: string;
  imageUrl: string | null;
  children: Category[];
}

export interface Variant {
  id: string;
  title: string;
  price: Money;
  /** e.g. `{ "apparel.size": "XL", "product.color": "Green" }` */
  selectedOptions: Record<string, string>;
  available: boolean;
}

export interface CartItem {
  id: string;
  productId: string;
  variantId: string | null;
  name: string;
  imageUrl: string | null;
  quantity: number;
  unitPrice: Money;
  totalPrice: Money;
}

export interface CartTotals {
  subtotal: string;
  tax: string;
  taxIsEstimate: boolean;
  shipping: string;
  discount: string;
  total: string;
}

export interface Cart {
  id: string;
  currency: string;
  items: CartItem[];
  totals: CartTotals;
  expiresAt: string;
}

export interface StoreConfig {
  storeId: string;
  apiUrl: string;
  publishableKey: string;
  apiVersion: string;
  capabilities: string[];
}

/** An API failure carrying the platform's own problem document. */
export class CommerceError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'CommerceError';
  }
}

const CART_TOKEN_KEY = '1ecomm.cartToken';

/**
 * The cart token lives in sessionStorage, not localStorage: it is a shopper
 * capability and should not outlive the browsing session on a shared machine.
 * Every access is guarded because a locked-down browser throws on the property
 * itself, not merely on read.
 */
export const cartToken = {
  read(): string | null {
    try {
      return sessionStorage.getItem(CART_TOKEN_KEY);
    } catch {
      return null;
    }
  },
  write(token: string): void {
    try {
      sessionStorage.setItem(CART_TOKEN_KEY, token);
    } catch {
      /* private mode: the cart lasts this page instead. Not worth failing over. */
    }
  },
  clear(): void {
    try {
      sessionStorage.removeItem(CART_TOKEN_KEY);
    } catch {
      /* as above */
    }
  },
};

export class CommerceClient {
  private memoryToken: string | null = null;

  constructor(private readonly config: StoreConfig) {}

  get storeId(): string {
    return this.config.storeId;
  }

  can(capability: string): boolean {
    return this.config.capabilities.includes(capability);
  }

  private get base(): string {
    return `${this.config.apiUrl}/${this.config.apiVersion}/headless`;
  }

  private token(): string | null {
    return this.memoryToken ?? cartToken.read();
  }

  private setToken(token: string): void {
    this.memoryToken = token;
    cartToken.write(token);
  }

  private async request<T>(
    path: string,
    init: RequestInit & { withCart?: boolean } = {},
  ): Promise<{ data: T; raw: Record<string, unknown> }> {
    const headers = new Headers(init.headers);
    headers.set('accept', 'application/json');
    headers.set('x-publishable-key', this.config.publishableKey);
    if (init.body) headers.set('content-type', 'application/json');
    if (init.withCart) {
      const token = this.token();
      if (token) headers.set('x-cart-token', token);
    }

    const res = await fetch(`${this.base}${path}`, { ...init, headers });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;

    if (!res.ok) {
      throw new CommerceError(
        (body['detail'] as string) ?? `Request failed with HTTP ${res.status}.`,
        res.status,
        body['code'] as string | undefined,
        (body['requestId'] as string | undefined) ?? res.headers.get('x-request-id') ?? undefined,
      );
    }

    // The cart routes return a rotated token at the envelope's top level, not
    // inside `data`. Missing this is how a shopper's second add-to-cart 401s.
    const rotated = body['cartToken'];
    if (typeof rotated === 'string' && rotated.length > 0) this.setToken(rotated);

    return { data: body['data'] as T, raw: body };
  }

  // ---- catalog -----------------------------------------------------------

  async listProducts(params: { limit?: number; cursor?: string; categoryId?: string } = {}): Promise<Product[]> {
    const q = new URLSearchParams();
    if (params.limit) q.set('limit', String(params.limit));
    if (params.cursor) q.set('cursor', params.cursor);
    if (params.categoryId) q.set('categoryId', params.categoryId);
    const suffix = q.toString() ? `?${q}` : '';
    const { data } = await this.request<Product[]>(`/products${suffix}`);
    return data ?? [];
  }

  async getProduct(id: string): Promise<Product> {
    const { data } = await this.request<Product>(`/products/${encodeURIComponent(id)}`);
    return data;
  }

  /**
   * Variants for a product.
   *
   * This call is not optional decoration. A product that HAS variants rejects
   * an add-to-cart without `variantId` with HTTP 400, so the product page must
   * resolve variants before it can offer a working button.
   */
  async listVariants(productId: string): Promise<Variant[]> {
    const { data } = await this.request<Variant[]>(`/products/${encodeURIComponent(productId)}/variants`);
    return data ?? [];
  }

  async listCategories(): Promise<Category[]> {
    const { data } = await this.request<Category[]>('/products/categories');
    return data ?? [];
  }

  // ---- cart --------------------------------------------------------------

  /** Create a cart and adopt its token. */
  async createCart(): Promise<Cart> {
    const { data } = await this.request<Cart>('/carts', { method: 'POST', body: '{}' });
    return data;
  }

  /** The current cart, or null when this browser holds no cart capability. */
  async getCart(): Promise<Cart | null> {
    if (!this.token()) return null;
    try {
      const { data } = await this.request<Cart>('/carts/current', { withCart: true });
      return data;
    } catch (error) {
      // An expired or revoked token is a normal end of life, not an error the
      // shopper should see. Drop it and let the next add create a fresh cart.
      if (error instanceof CommerceError && (error.status === 401 || error.status === 404)) {
        this.memoryToken = null;
        cartToken.clear();
        return null;
      }
      throw error;
    }
  }

  async addItem(input: { productId: string; variantId?: string; quantity?: number }): Promise<Cart> {
    if (!this.token()) await this.createCart();
    const { data } = await this.request<Cart>('/carts/current/items', {
      method: 'POST',
      withCart: true,
      body: JSON.stringify({
        productId: input.productId,
        ...(input.variantId ? { variantId: input.variantId } : {}),
        quantity: input.quantity ?? 1,
      }),
    });
    return data;
  }

  async updateItem(itemId: string, quantity: number): Promise<Cart> {
    const { data } = await this.request<Cart>(`/carts/current/items/${encodeURIComponent(itemId)}`, {
      method: 'PATCH',
      withCart: true,
      body: JSON.stringify({ quantity }),
    });
    return data;
  }

  async removeItem(itemId: string): Promise<Cart> {
    const { data } = await this.request<Cart>(`/carts/current/items/${encodeURIComponent(itemId)}`, {
      method: 'DELETE',
      withCart: true,
    });
    return data;
  }

  // ---- checkout ----------------------------------------------------------

  async getCheckout(): Promise<Record<string, unknown>> {
    const { data } = await this.request<Record<string, unknown>>('/carts/current/checkout', {
      withCart: true,
    });
    return data;
  }

  async patchCheckout(patch: Record<string, unknown>): Promise<Record<string, unknown>> {
    const { data } = await this.request<Record<string, unknown>>('/carts/current/checkout', {
      method: 'PATCH',
      withCart: true,
      body: JSON.stringify(patch),
    });
    return data;
  }

  async setShippingMethod(methodId: string): Promise<Record<string, unknown>> {
    const { data } = await this.request<Record<string, unknown>>(
      '/carts/current/checkout/shipping-method',
      { method: 'PUT', withCart: true, body: JSON.stringify({ methodId }) },
    );
    return data;
  }

  async setPaymentMethod(methodId: string): Promise<Record<string, unknown>> {
    const { data } = await this.request<Record<string, unknown>>(
      '/carts/current/checkout/payment-method',
      { method: 'PUT', withCart: true, body: JSON.stringify({ methodId }) },
    );
    return data;
  }

  /**
   * Place the order.
   *
   * `intentKey` is caller-owned and must be REUSED across retries of the same
   * shopper intent. A fresh key on retry is how one checkout becomes two orders,
   * so it is a required argument rather than something generated in here.
   */
  async placeOrder(intentKey: string): Promise<Record<string, unknown>> {
    const { data } = await this.request<Record<string, unknown>>('/carts/current/checkout/order', {
      method: 'POST',
      withCart: true,
      headers: { 'Idempotency-Key': intentKey },
      body: '{}',
    });
    cartToken.clear();
    this.memoryToken = null;
    return data;
  }

  /** Reopen a guest order. Deliberately never retried. */
  async lookupOrder(orderNumber: string, email: string): Promise<Record<string, unknown>> {
    const { data } = await this.request<Record<string, unknown>>('/orders/lookup', {
      method: 'POST',
      body: JSON.stringify({ orderNumber, email }),
    });
    return data;
  }
}

/**
 * Resolve the store's public runtime configuration from its ID.
 *
 * Everything the storefront needs — API URL, publishable key, capabilities — is
 * discovered here, which is why the only thing in headless-config.json is a
 * store ID. There is no key to copy and no secret to leak.
 */
export async function bootstrap(storeId: string, bootstrapUrl: string): Promise<StoreConfig> {
  const res = await fetch(
    `${bootstrapUrl.replace(/\/+$/, '')}/v1/headless/stores/${encodeURIComponent(storeId)}/config`,
    { headers: { accept: 'application/json' } },
  );
  if (!res.ok) {
    const problem = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    throw new CommerceError(
      (problem['detail'] as string) ?? `Could not load store configuration (HTTP ${res.status}).`,
      res.status,
      problem['code'] as string | undefined,
      problem['requestId'] as string | undefined,
    );
  }
  const body = (await res.json()) as { data: StoreConfig };
  if (body.data.storeId !== storeId) {
    throw new CommerceError('Store configuration did not match the requested store.', 409);
  }
  return body.data;
}
