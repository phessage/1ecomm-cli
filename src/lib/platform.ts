/**
 * The live 1Ecomm headless platform, as it actually answers.
 *
 * Every shape here was read off api.1ecomm.com rather than off the SSOT, because
 * the two disagree in ways that matter: the catalog returns `name`, not `title`,
 * and `price` is an object rather than a scalar. A generator that trusts the
 * prose emits a storefront rendering `undefined`.
 */

/** Capability names the bootstrap response is known to return. */
export type Capability =
  | 'catalog'
  | 'cart'
  | 'checkout-preparation'
  | 'orders'
  | 'customers'
  | 'returns';

export interface StoreConfig {
  storeId: string;
  apiUrl: string;
  publishableKey: string;
  apiVersion: string;
  capabilities: Capability[];
}

export interface ProblemDocument {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  code?: string;
  requestId?: string;
}

/** A failure that already carries a sentence worth printing to a human. */
export class PlatformError extends Error {
  constructor(
    message: string,
    readonly status: number | undefined,
    readonly problem: ProblemDocument | undefined,
    readonly hint: string | undefined,
  ) {
    super(message);
    this.name = 'PlatformError';
  }
}

export const DEFAULT_BOOTSTRAP_URL = 'https://api.1ecomm.com';

/** The header the platform authenticates a public client with. */
export const PUBLISHABLE_KEY_HEADER = 'x-publishable-key';
/** The header carrying the shopper's cart capability. */
export const CART_TOKEN_HEADER = 'x-cart-token';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function looksLikeStoreId(value: string): boolean {
  return UUID_RE.test(value.trim());
}

async function readProblem(res: Response): Promise<ProblemDocument | undefined> {
  try {
    const body = (await res.json()) as unknown;
    if (body && typeof body === 'object') return body as ProblemDocument;
  } catch {
    /* a non-JSON error body tells us nothing the status has not already */
  }
  return undefined;
}

/**
 * Turn a failed bootstrap into advice. The platform's own 404 detail reads
 * "Headless store is not configured", which is accurate and tells a developer
 * nothing about what to do next; these sentences do.
 */
function bootstrapHint(status: number | undefined): string | undefined {
  if (status === 404) {
    return (
      'No headless store is configured for that ID.\n' +
      '  - Check the ID in your 1Ecomm workspace under Applications.\n' +
      '  - A store becomes discoverable once it has one ACTIVE application.\n' +
      '  - The ID is the store, not the application, and it is not a secret.'
    );
  }
  if (status === 401 || status === 403) {
    return 'That store exists but refused a public bootstrap. Check the application is active and not suspended.';
  }
  if (status === 429) return 'Rate limited by the platform. Wait a moment and try again.';
  if (status !== undefined && status >= 500) {
    return 'The platform returned a server error. This is not your configuration; try again shortly.';
  }
  return undefined;
}

/**
 * Resolve a store ID to its public runtime configuration.
 *
 * This is the CLI's single validation gate: it runs before any other question is
 * asked, so a wrong ID costs one prompt rather than a scaffolded project that
 * installs, builds and only then fails at runtime.
 */
export async function fetchStoreConfig(
  storeId: string,
  options: { bootstrapUrl?: string; timeoutMs?: number } = {},
): Promise<StoreConfig> {
  const base = (options.bootstrapUrl ?? DEFAULT_BOOTSTRAP_URL).replace(/\/+$/, '');
  const id = storeId.trim();
  const url = `${base}/v1/headless/stores/${encodeURIComponent(id)}/config`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
    });
  } catch (cause) {
    const offline = cause instanceof Error && cause.name === 'TimeoutError'
      ? `The platform did not answer within ${(options.timeoutMs ?? 15_000) / 1000}s.`
      : 'Could not reach the platform.';
    throw new PlatformError(offline, undefined, undefined, `Tried ${url}. Check your network or --bootstrap-url.`);
  }

  if (!res.ok) {
    const problem = await readProblem(res);
    throw new PlatformError(
      problem?.detail ?? `Bootstrap failed with HTTP ${res.status}.`,
      res.status,
      problem,
      bootstrapHint(res.status),
    );
  }

  const envelope = (await res.json()) as { data?: Partial<StoreConfig> };
  const data = envelope.data;
  if (!data?.storeId || !data.apiUrl || !data.publishableKey) {
    throw new PlatformError(
      'The platform returned a bootstrap response missing storeId, apiUrl or publishableKey.',
      res.status,
      undefined,
      'This is a platform-side fault rather than a bad store ID. Report it with the request ID above.',
    );
  }

  // A bootstrap that answers for a DIFFERENT store than the one asked for would
  // silently wire the project to someone else's catalog. The SDKs reject this
  // too; the CLI must, because it writes the ID into a config file.
  if (data.storeId !== id) {
    throw new PlatformError(
      `Bootstrap returned store ${data.storeId} for requested store ${id}.`,
      res.status,
      undefined,
      'Refusing to scaffold against a mismatched store.',
    );
  }

  return {
    storeId: data.storeId,
    apiUrl: data.apiUrl.replace(/\/+$/, ''),
    publishableKey: data.publishableKey,
    apiVersion: data.apiVersion ?? 'v1',
    capabilities: (data.capabilities ?? []) as Capability[],
  };
}

export interface CapabilityReport {
  canBrowse: boolean;
  canCart: boolean;
  canCheckout: boolean;
  canOrder: boolean;
  canAccounts: boolean;
}

/**
 * What the store's capability list permits.
 *
 * `orders` is the one that bites: a catalog+cart store prepares a checkout
 * perfectly and then cannot place the order. Scaffolding a checkout button that
 * always fails is worse than scaffolding no button, so the generator reads this.
 */
export function describeCapabilities(caps: Capability[]): CapabilityReport {
  const has = (c: Capability) => caps.includes(c);
  return {
    canBrowse: has('catalog'),
    canCart: has('cart'),
    canCheckout: has('checkout-preparation'),
    canOrder: has('orders'),
    canAccounts: has('customers'),
  };
}

export interface ProbeResult {
  ok: boolean;
  status: number;
  detail?: string;
  requestId?: string;
  count?: number;
}

/** Issue one authenticated catalog read, to prove the key works end to end. */
export async function probeCatalog(config: StoreConfig, timeoutMs = 15_000): Promise<ProbeResult> {
  const url = `${config.apiUrl}/${config.apiVersion}/headless/products?limit=1`;
  try {
    const res = await fetch(url, {
      headers: { accept: 'application/json', [PUBLISHABLE_KEY_HEADER]: config.publishableKey },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const requestId = res.headers.get('x-request-id') ?? undefined;
    if (!res.ok) {
      const problem = await readProblem(res);
      return { ok: false, status: res.status, detail: problem?.detail, requestId: problem?.requestId ?? requestId };
    }
    const body = (await res.json()) as { data?: unknown[] };
    return { ok: true, status: res.status, count: Array.isArray(body.data) ? body.data.length : 0, requestId };
  } catch {
    return { ok: false, status: 0, detail: 'Request failed or timed out.' };
  }
}
